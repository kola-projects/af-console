// [3.51.0] ua-report-sync — job đồng bộ dữ liệu cho trang "UA activity report".
//
// Được gọi bởi public.cron_fire() (pg_cron hằng ngày, hoặc nút "Chạy ngay" trên trang Cron jobs)
// qua pg_net, kèm header x-cron-secret (đối chiếu với Vault). Body: { run_id, job_key }.
// Trả 202 ngay rồi chạy nền (EdgeRuntime.waitUntil); tiến độ + input/output/lỗi ghi vào cron_runs
// qua RPC cron_run_update để trang Cron jobs xem và debug.
//
// Ba bước, độc lập nhau (một bước lỗi không chặn bước khác; có bước lỗi thì cả lần chạy = error):
//   1. zk.list_action_log  — nhật ký thao tác UA (mọi cấp), phân trang 200 dòng → ua_ingest_actions
//                            (PK = id của zk ⇒ chạy lại không trùng, không sửa dòng cũ)
//   2. bdash.get_portfolio_metrics (summary=false, break_by=app) — tiền theo ngày × app × account
//                            → ua_ingest_money (chỉ thêm bản chụp cho khoá đổi giá trị)
//   3. bdash.list_apps     — danh mục app: tên, tags (gồm tag người), icon, platform → ua_upsert_apps
//
// zk và bdash chỉ có cổng MCP ⇒ gọi JSON-RPC tools/call trực tiếp (không cần phiên).
// Token nằm trong Supabase Vault (afc_vault_get), không nằm trong env hay git.
//
// Input (cron_runs.input — mặc định lấy từ cron_jobs.params, "Chạy ngay" có thể ghi đè):
//   action_lookback_days (2)   — lấy thao tác từ hôm nay lùi N ngày (mọi lần chạy)
//   recent_days          (2)   — số ngày "còn có thể đổi" ngay trước hôm nay (D-1 … D-N)
//   recent_every_hours   (3)   — bao lâu lấy lại các ngày đó một lần
//   sweep_every_days     (30)  — bao lâu rà lại toàn bộ ngày cũ một lần
//   sweep_lookback_days  (62)  — mỗi lần rà lùi bao nhiêu ngày (bdash cho tối đa 93)
//   date_from / date_to        — ghi đè mọi khoảng trên (dùng để backfill), YYYY-MM-DD theo GMT+7
//
// BA TẦNG lấy tiền, theo đúng nhịp thay đổi của số bdash (job chạy mỗi giờ):
//   d0     — MỖI lần chạy: chỉ hôm nay (D0 đổi liên tục)
//   recent — vài giờ một lần: D0 … D-recent_days (D-1, D-2 còn được cập nhật)
//   sweep  — mỗi tháng một lần: D0 … D-sweep_lookback_days (từ D-3 coi như ổn định, rà lại xem có đổi không)
// Tầng nào "đến hạn" đọc từ lịch sử cron_runs (lần chạy THÀNH CÔNG gần nhất của tầng đó), không dựa vào
// giờ đồng hồ — lần chạy bị lỗi thì lần kế tiếp tự làm thay, không cần ai nhớ.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const UA = "afc-ua-report-sync/1.0";
const TZ_OFFSET_MS = 7 * 3600 * 1000; // GMT+7
const PAGE = 200;
const MAX_PAGES = 100;

type Step = { name: string; status: "ok" | "error"; ms: number; note: string };
type Json = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Ngày theo GMT+7, lùi `back` ngày, dạng YYYY-MM-DD. */
function dayVN(back = 0): string {
  const d = new Date(Date.now() + TZ_OFFSET_MS - back * 86400000);
  return d.toISOString().slice(0, 10);
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vault(admin: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await admin.rpc("afc_vault_get", { p_name: name });
  if (error) throw new Error(`Vault ${name}: ${error.message}`);
  if (!data) throw new Error(`Vault thiếu secret ${name}`);
  return data as string;
}

/** Gọi một tool MCP bằng JSON-RPC thuần; trả JSON bên trong content[0].text. Thử lại 3 lần. */
async function mcpCall(url: string, token: string, tool: string, args: Json): Promise<Json> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "User-Agent": UA,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
      let rpc: Json | null = null;
      if ((r.headers.get("content-type") ?? "").includes("event-stream")) {
        for (const line of text.split("\n")) {
          if (line.startsWith("data:")) {
            try {
              rpc = JSON.parse(line.slice(5).trim());
            } catch { /* dòng SSE không phải JSON — bỏ qua */ }
          }
        }
      } else {
        rpc = JSON.parse(text);
      }
      if (!rpc) throw new Error("phản hồi MCP rỗng");
      if (rpc.error) throw new Error(`MCP error ${JSON.stringify(rpc.error).slice(0, 300)}`);
      const result = rpc.result as { content?: { text?: string }[]; isError?: boolean } | undefined;
      const inner = result?.content?.[0]?.text ?? "";
      if (result?.isError) throw new Error(`tool báo lỗi: ${inner.slice(0, 300)}`);
      return JSON.parse(inner) as Json;
    } catch (e) {
      last = e;
      if (attempt < 3) await sleep(attempt * 1500);
    }
  }
  throw new Error(`${tool}: ${last instanceof Error ? last.message : String(last)} (đã thử 3 lần)`);
}

// ---------------------------------------------------------------- bước 1: zk action log
async function stepActions(admin: SupabaseClient, runId: number, from: string, to: string) {
  const [url, token] = await Promise.all([vault(admin, "zk_mcp_url"), vault(admin, "zk_mcp_token")]);
  let offset = 0, fetched = 0, inserted = 0, pages = 0, total = 0;
  for (; pages < MAX_PAGES; pages++) {
    const page = await mcpCall(url, token, "list_action_log", { date_from: from, date_to: to, limit: PAGE, offset });
    const items = (page.items as Json[]) ?? [];
    total = num(page.total);
    if (items.length) {
      const rows = items.map((it) => ({
        id: it.id, occurred_at: it.occurred_at, platform: it.platform, account_id: it.account_id,
        level: it.level, entity_id: it.entity_id, entity_name: it.entity_name, campaign_id: it.campaign_id,
        action_type: it.action_type, source: it.source, outcome: it.outcome,
        user_email: it.user_email, user_name: it.user_name, changes: it.changes ?? null,
      }));
      const { data, error } = await admin.rpc("ua_ingest_actions", { p_run_id: runId, p_rows: rows });
      if (error) throw new Error(`ua_ingest_actions: ${error.message}`);
      fetched += items.length;
      inserted += num(data);
    }
    if (!page.has_more || !items.length) { pages++; break; }
    offset = num(page.next_offset) || offset + items.length;
  }
  return { from, to, zk_total: total, fetched, inserted, pages };
}

// ---------------------------------------------------------------- bước 2: bdash tiền theo ngày × app
async function stepMoney(admin: SupabaseClient, runId: number, from: string, to: string) {
  const [url, token] = await Promise.all([vault(admin, "bdash_mcp_url"), vault(admin, "bdash_mcp_token")]);
  const d = await mcpCall(url, token, "get_portfolio_metrics", {
    start_date: from, end_date: to, mediations: "admob,max", break_by: "app", summary: false,
  });

  const names = new Map<string, string>();
  const noteName = (id: unknown, name: unknown) => {
    if (typeof id !== "string" || !id || id === "UNKNOWN") return;
    if (typeof name === "string" && name && !names.has(id)) names.set(id, name);
  };

  // chi ads: ngày × app × network × account (gộp phòng khi bdash trả trùng khoá)
  const spend = new Map<string, Json>();
  for (const r of (d.network_spends as Json[]) ?? []) {
    if (!isDay(r.date)) continue;
    const app = String(r.app_id ?? "UNKNOWN"), net = String(r.network ?? ""), acc = String(r.account_id ?? "");
    noteName(app, r.app_name);
    const k = `${r.date}|${app}|${net}|${acc}`;
    const cur = spend.get(k) ?? { day: r.date, app_id: app, network: net, account_id: acc, cost: 0, installs: 0, impressions: 0, clicks: 0 };
    cur.cost = num(cur.cost) + num(r.cost);
    cur.installs = num(cur.installs) + num(r.installs);
    cur.impressions = num(cur.impressions) + num(r.impressions);
    cur.clicks = num(cur.clicks) + num(r.clicks);
    spend.set(k, cur);
  }

  // tiền: ngày × app
  const money = new Map<string, Json>();
  const row = (day: string, app: string) => {
    const k = `${day}|${app}`;
    let cur = money.get(k);
    if (!cur) {
      cur = { day, app_id: app, mediation_revenue: 0, inapp_revenue: 0, manual_revenue: 0, cost: 0, installs: 0,
        iap_cost: 0, adjust_cost: 0, admob_cost: 0, topup_cost: 0, manual_cost: 0 };
      money.set(k, cur);
    }
    return cur;
  };
  for (const s of spend.values()) {
    const m = row(s.day as string, s.app_id as string);
    m.cost = num(m.cost) + num(s.cost);
    m.installs = num(m.installs) + num(s.installs);
  }
  for (const r of (d.mediation_revenue as Json[]) ?? []) {
    if (!isDay(r.date)) continue;
    const app = String(r.app_id ?? "UNKNOWN");
    noteName(app, r.app_name);
    const m = row(r.date, app);
    m.mediation_revenue = num(m.mediation_revenue) + num(r.revenue);
  }
  for (const r of (d.inapp_purchase_revenue as Json[]) ?? []) {
    if (!isDay(r.date)) continue;
    const app = String(r.app_id ?? "UNKNOWN");
    const m = row(r.date, app);
    m.inapp_revenue = num(m.inapp_revenue) + num(r.revenue);
  }
  for (const [app, list] of Object.entries((d.cost_breakdown_by_app as Record<string, Json[]>) ?? {})) {
    for (const r of list ?? []) {
      if (!isDay(r.date)) continue;
      const m = row(r.date, app);
      m.iap_cost = num(m.iap_cost) + num(r.iap_cost);
      m.adjust_cost = num(m.adjust_cost) + num(r.adjust_cost);
      m.admob_cost = num(m.admob_cost) + num(r.admob_cost);
      m.topup_cost = num(m.topup_cost) + num(r.topup_cost);
    }
  }
  for (const r of (d.manual_cost_group_by_app as Json[]) ?? []) {
    if (!isDay(r.date)) continue;
    const m = row(r.date, String(r.app_id ?? "UNKNOWN"));
    m.manual_revenue = num(m.manual_revenue) + num(r.revenue);
    m.manual_cost = num(m.manual_cost) + num(r.ads_cost) + num(r.fee);
  }

  const moneyRows = [...money.values()];
  if (!moneyRows.length) throw new Error("bdash không trả dòng tiền nào cho khoảng ngày này — không nạp.");

  // đối soát với tổng của chính bdash trước khi ghi
  const sum = (f: (m: Json) => number) => moneyRows.reduce((a, m) => a + f(m), 0);
  const revenue = sum((m) => num(m.mediation_revenue) + num(m.inapp_revenue) + num(m.manual_revenue));
  const cost = sum((m) => num(m.cost));
  const fees = sum((m) => num(m.iap_cost) + num(m.adjust_cost) + num(m.admob_cost) + num(m.topup_cost) + num(m.manual_cost));
  const check = {
    revenue: +revenue.toFixed(2), bdash_all_in_revenue: +num(d.all_in_revenue).toFixed(2),
    cost: +cost.toFixed(2), bdash_network_cost: +num(d.network_cost).toFixed(2),
    profit: +(revenue - cost - fees).toFixed(2), bdash_profit: +num(d.profit).toFixed(2),
  };
  const off = (a: number, b: number) => Math.abs(a - b) > Math.max(1, Math.abs(b) * 0.005);
  const mismatch = off(check.revenue, check.bdash_all_in_revenue) || off(check.cost, check.bdash_network_cost);

  const apps = [...new Set(moneyRows.map((m) => m.app_id as string))].map((id) => ({
    app_id: id, app_name: id === "UNKNOWN" ? "Không rõ app (UNKNOWN)" : names.get(id) ?? null,
  }));
  const up = await admin.rpc("ua_upsert_apps", { p_apps: apps, p_set_tags: false });
  if (up.error) throw new Error(`ua_upsert_apps: ${up.error.message}`);

  const { data, error } = await admin.rpc("ua_ingest_money", {
    p_run_id: runId, p_from: from, p_to: to, p_spend: [...spend.values()], p_money: moneyRows,
  });
  if (error) throw new Error(`ua_ingest_money: ${error.message}`);
  return { from, to, spend_rows: spend.size, money_rows: moneyRows.length, apps: apps.length, ...(data as Json), check, mismatch };
}

// ---------------------------------------------------------------- bước 3: bdash danh mục app
// list_apps trả MỌI app (kể cả đã tắt) kèm tên, tags (gồm tag người), icon_url, platform — một lệnh là đủ.
// Vì danh sách đầy đủ nên đặt lại tags theo đúng payload: app bị gỡ hết tag sẽ về mảng rỗng.
async function stepApps(admin: SupabaseClient) {
  const [url, token] = await Promise.all([vault(admin, "bdash_mcp_url"), vault(admin, "bdash_mcp_token")]);
  const d = await mcpCall(url, token, "list_apps", {});
  const apps = ((d.data as Json[]) ?? [])
    .filter((a) => typeof a.app_id === "string" && a.app_id)
    .map((a) => ({
      app_id: a.app_id as string,
      app_name: (a.app_name as string) || null,
      icon_url: (a.icon_url as string) || null,
      platform: (a.platform as string) || null,
      tags: ((a.tags as { name?: string }[]) ?? []).map((t) => String(t?.name ?? "").toLowerCase()).filter(Boolean),
    }));
  if (!apps.length) throw new Error("bdash list_apps không trả app nào — giữ nguyên danh mục cũ.");
  const { data, error } = await admin.rpc("ua_upsert_apps", { p_apps: apps, p_set_tags: true });
  if (error) throw new Error(`ua_upsert_apps(list_apps): ${error.message}`);
  return {
    apps: apps.length, with_icon: apps.filter((a) => a.icon_url).length,
    with_tags: apps.filter((a) => a.tags.length).length, upserted: num(data),
  };
}

// ---------------------------------------------------------------- điều phối
type Tier = "d0" | "recent" | "sweep";

/** Từ `sinceMs` tới giờ đã có lần chạy THÀNH CÔNG nào thuộc một trong các tầng này chưa?
 *  Không đọc được thì coi như đã có (thà trễ một nhịp còn hơn rà sâu mỗi giờ khi truy vấn lỗi). */
async function tierDone(admin: SupabaseClient, jobKey: string, tiers: Tier[], sinceMs: number): Promise<boolean> {
  const { data, error } = await admin.from("cron_runs").select("id")
    .eq("job_key", jobKey).eq("status", "success").in("output->window->>tier", tiers)
    .gte("started_at", new Date(sinceMs).toISOString()).limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}

/** Chọn tầng cho lần chạy này. Trừ hao 10 phút để lịch "mỗi 3 giờ" không trượt thành mỗi 4 giờ. */
async function pickTier(admin: SupabaseClient, jobKey: string, input: Json): Promise<Tier> {
  const slack = 10 * 60 * 1000;
  const sweepEvery = Math.max(1, num(input.sweep_every_days ?? 30)) * 86400000;
  if (!(await tierDone(admin, jobKey, ["sweep"], Date.now() - sweepEvery + slack))) return "sweep";
  const recentEvery = Math.max(1, num(input.recent_every_hours ?? 3)) * 3600000;
  if (!(await tierDone(admin, jobKey, ["recent", "sweep"], Date.now() - recentEvery + slack))) return "recent";
  return "d0";
}

async function execute(admin: SupabaseClient, runId: number, jobKey: string, input: Json) {
  const steps: Step[] = [];
  const output: Json = {};
  const report = async (status: string, error: string | null = null, final = false) => {
    const { error: e } = await admin.rpc("cron_run_update", {
      p_run_id: runId, p_status: status, p_steps: steps, p_output: final ? output : null, p_error: error,
    });
    if (e) console.error("cron_run_update:", e.message);
  };
  const run = async (name: string, key: string, fn: () => Promise<Json>) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      output[key] = out;
      steps.push({ name, status: "ok", ms: Date.now() - t0, note: JSON.stringify(out).slice(0, 400) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      output[key] = { error: msg };
      steps.push({ name, status: "error", ms: Date.now() - t0, note: msg.slice(0, 600) });
    }
    await report("running");
  };

  try {
    const to = isDay(input.date_to) ? input.date_to : dayVN(0);
    const explicitFrom = isDay(input.date_from) ? input.date_from : null;
    const actFrom = explicitFrom ?? dayVN(Math.max(0, num(input.action_lookback_days ?? 2)));
    // Khoảng ngày chỉ định tay (backfill) không thuộc tầng nào ⇒ không làm lệch lịch của ba tầng.
    const tier: Tier | "manual" = explicitFrom ? "manual" : await pickTier(admin, jobKey, input);
    const monBack = tier === "sweep" ? num(input.sweep_lookback_days ?? 62) : tier === "recent" ? num(input.recent_days ?? 2) : 0;
    const monFrom = explicitFrom ?? dayVN(Math.max(0, Math.min(90, monBack))); // bdash cho tối đa 93 ngày/lần
    if (actFrom > to || monFrom > to) throw new Error(`Khoảng ngày sai: from sau to (${actFrom}/${monFrom} → ${to}).`);
    output.window = { tier, actions: [actFrom, to], money: [monFrom, to] };
    await report("running");

    await run("zk.list_action_log", "actions", () => stepActions(admin, runId, actFrom, to));
    await run("bdash.get_portfolio_metrics", "money", () => stepMoney(admin, runId, monFrom, to));
    await run("bdash.list_apps", "apps", () => stepApps(admin));

    const failed = steps.filter((s) => s.status === "error");
    if (failed.length) {
      output.failed_steps = failed.map((s) => s.name);
      await report("error", failed.map((s) => `${s.name}: ${s.note}`).join(" · "), true);
    } else {
      await report("success", null, true);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await report("error", msg, true);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Chỉ nhận POST" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  let expected: string;
  try {
    expected = await vault(admin, "afc_cron_secret");
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
  if ((req.headers.get("x-cron-secret") ?? "") !== expected) return json({ error: "Sai cron secret" }, 401);

  const body = await req.json().catch(() => ({})) as { run_id?: number };
  const runId = Number(body.run_id);
  if (!runId) return json({ error: "Thiếu run_id" }, 400);

  const { data: run, error } = await admin.from("cron_runs").select("id, job_key, status, input").eq("id", runId).maybeSingle();
  if (error || !run) return json({ error: `Không thấy cron_runs #${runId}` }, 404);
  if (run.status !== "queued") return json({ error: `Lần chạy #${runId} đang ở trạng thái ${run.status}` }, 409);

  // Trả ngay, chạy nền — pg_net không phải chờ, và job không chết khi kết nối đóng.
  EdgeRuntime.waitUntil(execute(admin, runId, run.job_key as string, (run.input ?? {}) as Json));
  return json({ ok: true, run_id: runId }, 202);
});
