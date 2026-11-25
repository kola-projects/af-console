// [3.53.0] ua-creative-pipeline — số "Kho creative" của ZooKeeper cho trang UA activity report.
//
// Vì sao có lớp đệm: zk tính Kho creative chậm theo độ dài khoảng ngày (đo 2026-11-25: 1 ngày ≈ 6 s,
// 7 ngày ≈ 23 s, 31 ngày ≈ 71 s), và cộng số từng ngày KHÔNG ra số của cả khoảng (zk tính lại người
// "suy ra" theo từng khoảng). Nên function này hỏi zk đúng khoảng ngày được yêu cầu, lưu NGUYÊN kết quả
// vào bảng ua_creative_cache, và trả bản đã lưu cho các lần hỏi sau.
//
// HAI CÁCH GỌI
//  1. Trang web / MCP (Authorization: Bearer <JWT người dùng> hoặc service role):
//       POST { from, to, person_key?, items?, wait? }
//     → { status: "ready", data, fetched_at, stale, refreshing }   có sẵn (stale = đã cũ, đang lấy lại nền)
//     → { status: "pending", eta_s, since }                         chưa có, đang lấy nền — hỏi lại sau vài giây
//     → { status: "error", error }
//     Chỉ role ua_manager + admin. person_key + items=true ⇒ danh sách creative mới của một người
//     (tối đa 100, mới nhất trước). wait=true ⇒ chờ lấy xong rồi mới trả (MCP dùng).
//  2. Cron job ua-creative-sync (header x-cron-secret, body { run_id }): lấy sẵn các khoảng ngày hay xem
//     — 7 ngày gần nhất + hôm nay mỗi lần chạy; D-1, D-2, tháng này vài giờ một lần; D-3…D-6 mỗi ngày
//     một lần. Tiến độ ghi vào cron_runs như mọi job khác.
//
// Mỗi lần lấy số cả đội cho khoảng ≥ 7 ngày còn cập nhật ua_creative_uploads_daily (creative lên theo
// ngày × người) — nguồn của Workload và biểu đồ lịch. CHỈ ĐỌC ZooKeeper.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "afc-ua-creative-pipeline/1.0";
const TZ_OFFSET_MS = 7 * 3600 * 1000; // GMT+7
const MAX_DAYS = 31; // giới hạn của zk
const ITEMS_LIMIT = 100;

type Json = Record<string, unknown>;
type Step = { name: string; status: "ok" | "error"; ms: number; note: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function dayVN(back = 0): string {
  return new Date(Date.now() + TZ_OFFSET_MS - back * 86400000).toISOString().slice(0, 10);
}
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
const cacheKey = (from: string, to: string, person: string | null, items: boolean) => `${from}|${to}|${person ?? "*"}|${items ? 1 : 0}`;
/** Bản lưu còn "mới" trong bao lâu: khoảng chạm D0…D-2 còn đổi ⇒ 1 giờ; cũ hơn ⇒ 1 ngày. */
const ttlMs = (to: string) => (to >= dayVN(2) ? 3600e3 : 24 * 3600e3);
/** Ước lượng thời gian zk trả lời (giây) để trang web hiện cho người xem. */
const etaSeconds = (from: string, to: string) => Math.round(4 + 2.4 * dayCount(from, to));

async function vault(admin: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await admin.rpc("afc_vault_get", { p_name: name });
  if (error) throw new Error(`Vault ${name}: ${error.message}`);
  if (!data) throw new Error(`Vault thiếu secret ${name}`);
  return data as string;
}

/** Gọi một tool MCP bằng JSON-RPC thuần. Thử lại 3 lần; gặp 429 thì chờ theo Retry-After (tối đa 20 s). */
async function mcpCall(url: string, token: string, tool: string, args: Json): Promise<Json> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let wait = attempt * 1500;
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
      if (r.status === 429) {
        wait = Math.min(20000, Math.max(2000, num(r.headers.get("retry-after")) * 1000));
        throw new Error("HTTP 429 — ZooKeeper đang giới hạn tần suất");
      }
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
      if (attempt < 3) await sleep(wait);
    }
  }
  throw new Error(`${tool}: ${last instanceof Error ? last.message : String(last)} (đã thử 3 lần)`);
}

// ---------------------------------------------------------------- map người + app
type Person = { person_key: string; display_name: string; zk_emails: string[] };
type Ctx = {
  people: Person[];
  personOfEmail: Map<string, Person>;
  resolveApp: (name: unknown) => string | null;
};

/** Tên app của zk (không có package) → app_id trong ua_apps. Chỉ nhận khi khớp ĐÚNG MỘT app; mơ hồ ⇒ null
 *  (vd "GBA Emulator" khớp nhiều app — thà không gắn icon còn hơn gắn nhầm). */
function makeAppResolver(apps: { app_id: string; app_name: string | null }[]) {
  const nz = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const head = (s: string) => nz(s.split(/[:\-–|]/)[0]);
  const add = (m: Map<string, string[]>, k: string, id: string) => {
    if (!k) return;
    const cur = m.get(k);
    if (cur) cur.push(id);
    else m.set(k, [id]);
  };
  const byId = new Map<string, string>(), byName = new Map<string, string[]>(), byHead = new Map<string, string[]>(), byTail = new Map<string, string[]>();
  for (const a of apps) {
    byId.set(a.app_id.toLowerCase(), a.app_id);
    if (a.app_name) {
      add(byName, nz(a.app_name), a.app_id);
      add(byHead, head(a.app_name), a.app_id);
    }
    add(byTail, nz(a.app_id.split(".").pop() ?? ""), a.app_id);
  }
  const one = (list: string[] | undefined) => (list && list.length === 1 ? list[0] : null);
  return (name: unknown): string | null => {
    if (typeof name !== "string" || !name.trim()) return null;
    const l = name.trim().toLowerCase();
    if (byId.has(l)) return byId.get(l)!;
    if (/^\d{6,}$/.test(l) && byId.has(`id${l}`)) return byId.get(`id${l}`)!;
    const h = head(name);
    return one(byName.get(nz(name))) ?? (h.length >= 5 ? one(byHead.get(h)) : null) ?? (nz(name).length >= 5 ? one(byTail.get(nz(name))) : null);
  };
}

async function loadCtx(admin: SupabaseClient): Promise<Ctx> {
  const [p, a] = await Promise.all([
    admin.from("ua_people").select("person_key, display_name, zk_emails"),
    admin.from("ua_apps").select("app_id, app_name").limit(5000),
  ]);
  if (p.error) throw new Error(`ua_people: ${p.error.message}`);
  if (a.error) throw new Error(`ua_apps: ${a.error.message}`);
  const people = (p.data ?? []) as Person[];
  const personOfEmail = new Map<string, Person>();
  for (const x of people) for (const e of x.zk_emails ?? []) personOfEmail.set(e.toLowerCase(), x);
  return { people, personOfEmail, resolveApp: makeAppResolver((a.data ?? []) as { app_id: string; app_name: string | null }[]) };
}

// ---------------------------------------------------------------- đổi kết quả zk → payload của AFC
const AGG = ["creatives", "new", "live", "no_spend", "testing", "tested", "win", "not_ok", "inferred", "spend", "revenue"] as const;
type Agg = Record<(typeof AGG)[number], number>;
const zeroAgg = (): Agg => ({ creatives: 0, new: 0, live: 0, no_spend: 0, testing: 0, tested: 0, win: 0, not_ok: 0, inferred: 0, spend: 0, revenue: 0 });
function addAgg(t: Agg, s: Json) {
  for (const k of AGG) t[k] += num(s[k]);
}
const roundAgg = (a: Agg): Agg => ({ ...a, spend: r2(a.spend), revenue: r2(a.revenue) });

type ZkUser = Json & { email?: string | null; name?: string | null; user_id?: string | null; apps?: Json[]; uploads_by_day?: Record<string, number> };

function transformTeam(raw: Json, ctx: Ctx, from: string, to: string) {
  const users = ((raw.users as ZkUser[]) ?? []);
  const people = new Map<string, { person_key: string; name: string; mapped: boolean; agg: Agg; apps: Map<string, { app: string; app_id: string | null; agg: Agg }> }>();
  for (const u of users) {
    const email = typeof u.email === "string" ? u.email.toLowerCase() : "";
    const p = email ? ctx.personOfEmail.get(email) : undefined;
    const key = p?.person_key ?? (email ? email.split("@")[0] : "_unknown");
    const name = p?.display_name ?? (email ? (u.name as string) || email : "Chưa rõ người");
    let row = people.get(key);
    if (!row) {
      row = { person_key: key, name, mapped: !!p, agg: zeroAgg(), apps: new Map() };
      people.set(key, row);
    }
    addAgg(row.agg, u);
    for (const a of u.apps ?? []) {
      const app = typeof a.app === "string" && a.app ? a.app : "(chưa rõ app)";
      let ar = row.apps.get(app);
      if (!ar) {
        ar = { app, app_id: ctx.resolveApp(a.app), agg: zeroAgg() };
        row.apps.set(app, ar);
      }
      addAgg(ar.agg, a);
    }
  }
  const t = (raw.totals ?? {}) as Json;
  const totals = zeroAgg();
  addAgg(totals, t);
  const th = (raw.thresholds ?? {}) as Json;
  return {
    from, to,
    generated_at: raw.generated_at ?? null,
    min_spend: num(th.min_spend) || 10,
    roas_threshold: num(th.roas_threshold) || 1,
    revenue_available: raw.revenue_available !== false,
    totals: roundAgg(totals),
    people: [...people.values()]
      .map((p) => ({
        person_key: p.person_key, name: p.name, mapped: p.mapped, ...roundAgg(p.agg),
        apps: [...p.apps.values()]
          .map((a) => ({ app: a.app, app_id: a.app_id, ...roundAgg(a.agg) }))
          .sort((x, y) => y.new - x.new || y.spend - x.spend || y.creatives - x.creatives),
      }))
      .sort((x, y) => Number(x.person_key === "_unknown") - Number(y.person_key === "_unknown") || y.new - x.new || y.spend - x.spend),
  };
}

function transformItem(it: Json, ctx: Ctx) {
  const owner = it.owner_inferred ? "inferred" : it.owner_from_app_assignment ? "app" : it.owner_from_history ? "history" : it.owner ? "recorded" : "none";
  return {
    key: it.content_key, platform: it.platform ?? null, app: it.app ?? null, app_id: ctx.resolveApp(it.app),
    file_name: it.file_name ?? null, media_type: it.media_type ?? null,
    status: it.status ?? null, live: !!it.live, owner,
    spend: r2(num(it.spend)), revenue: r2(num(it.adjust_revenue)),
    uploaded_at: it.first_uploaded_at ?? it.launched_at ?? null,
    ad_count: num(it.ad_count),
  };
}

// ---------------------------------------------------------------- lấy số từ zk
type Zk = { url: string; token: string };

async function fetchTeam(admin: SupabaseClient, zk: Zk, from: string, to: string) {
  const [raw, ctx] = await Promise.all([
    mcpCall(zk.url, zk.token, "get_creative_pipeline", { date_from: from, date_to: to }),
    loadCtx(admin),
  ]);
  const users = (raw.users as ZkUser[]) ?? [];

  const zkUsers = users.filter((u) => u.email && u.user_id).map((u) => ({ email: u.email, user_id: u.user_id, name: u.name ?? null }));
  if (zkUsers.length) {
    const { error } = await admin.rpc("ua_upsert_zk_users", { p_rows: zkUsers });
    if (error) console.error("ua_upsert_zk_users:", error.message);
  }
  // Creative lên theo ngày × người: chỉ nạp từ khoảng ≥ 7 ngày (người "suy ra" của khoảng ngắn dao động hơn).
  if (dayCount(from, to) >= 7) {
    const rows: Json[] = [];
    for (const u of users) {
      for (const [day, n] of Object.entries(u.uploads_by_day ?? {})) {
        if (isDay(day) && num(n) > 0) rows.push({ day, owner_email: u.email ?? "", owner_name: u.email ? u.name ?? null : null, uploads: num(n) });
      }
    }
    const { error } = await admin.rpc("ua_ingest_creative_uploads", { p_from: from, p_to: to, p_rows: rows });
    if (error) throw new Error(`ua_ingest_creative_uploads: ${error.message}`);
  }
  return transformTeam(raw, ctx, from, to);
}

/** Creative mới của MỘT người trong khoảng ngày (mới nhất trước, tối đa 100) kèm chi / doanh thu / trạng thái. */
async function fetchPersonItems(admin: SupabaseClient, zk: Zk, from: string, to: string, personKey: string) {
  const ctx = await loadCtx(admin);
  let ids: string[] = [];
  if (personKey === "_unknown") {
    ids = ["unknown"];
  } else {
    const emails = ctx.people.find((p) => p.person_key === personKey)?.zk_emails ?? [];
    const q = emails.length
      ? admin.from("ua_zk_users").select("email, user_id").in("email", emails.map((e) => e.toLowerCase()))
      : admin.from("ua_zk_users").select("email, user_id").like("email", `${personKey.replace(/[%_]/g, "")}@%`);
    const { data, error } = await q;
    if (error) throw new Error(`ua_zk_users: ${error.message}`);
    ids = [...new Set((data ?? []).map((r) => r.user_id as string))];
  }
  const items: ReturnType<typeof transformItem>[] = [];
  let total = 0;
  for (let i = 0; i < ids.length; i++) {
    if (i) await sleep(800);
    const raw = await mcpCall(zk.url, zk.token, "get_creative_pipeline", {
      date_from: from, date_to: to, user_id: ids[i], include_items: true, new_only: true, sort: "newest", items_limit: ITEMS_LIMIT,
    });
    total += num(raw.items_total);
    for (const it of (raw.items as Json[]) ?? []) items.push(transformItem(it, ctx));
  }
  items.sort((a, b) => String(b.uploaded_at ?? "").localeCompare(String(a.uploaded_at ?? "")));
  return { from, to, person_key: personKey, zk_accounts: ids.length, items_total: total, items: items.slice(0, ITEMS_LIMIT) };
}

/** Lấy mới một khoá cache và ghi kết quả (hoặc lỗi) vào bảng. Người gọi phải đã giành được quyền (claim). */
async function refresh(admin: SupabaseClient, key: string, from: string, to: string, person: string | null, items: boolean) {
  const t0 = Date.now();
  try {
    const zk: Zk = { url: await vault(admin, "zk_mcp_url"), token: await vault(admin, "zk_mcp_token") };
    const payload = person && items ? await fetchPersonItems(admin, zk, from, to, person) : await fetchTeam(admin, zk, from, to);
    const { error } = await admin.from("ua_creative_cache").update({
      payload, fetched_at: new Date().toISOString(), fetch_ms: Date.now() - t0, refreshing_at: null, error: null, error_at: null,
    }).eq("cache_key", key);
    if (error) throw new Error(`ghi cache: ${error.message}`);
    return { ok: true as const, payload, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("ua_creative_cache").update({ refreshing_at: null, error: msg.slice(0, 600), error_at: new Date().toISOString() }).eq("cache_key", key);
    return { ok: false as const, error: msg, ms: Date.now() - t0 };
  }
}

type CacheRow = { payload: Json | null; fetched_at: string | null; refreshing_at: string | null; error: string | null; error_at: string | null };
async function readCache(admin: SupabaseClient, key: string): Promise<CacheRow | null> {
  const { data, error } = await admin.from("ua_creative_cache").select("payload, fetched_at, refreshing_at, error, error_at").eq("cache_key", key).maybeSingle();
  if (error) throw new Error(`đọc cache: ${error.message}`);
  return data as CacheRow | null;
}
async function claim(admin: SupabaseClient, key: string, from: string, to: string, person: string | null, items: boolean): Promise<boolean> {
  const { data, error } = await admin.rpc("ua_creative_cache_claim", { p_key: key, p_from: from, p_to: to, p_person: person, p_items: items });
  if (error) throw new Error(`ua_creative_cache_claim: ${error.message}`);
  return data === true;
}

// ---------------------------------------------------------------- cách gọi 1: trang web / MCP
async function serve(admin: SupabaseClient, body: Json) {
  const from = body.from, to = body.to;
  if (!isDay(from) || !isDay(to)) return json({ status: "error", error: "Cần from và to dạng YYYY-MM-DD." }, 400);
  if (from > to) return json({ status: "error", error: "Ngày bắt đầu phải không sau ngày kết thúc." }, 400);
  if (to > dayVN(-1)) return json({ status: "error", error: "Khoảng ngày nằm trong tương lai." }, 400);
  if (dayCount(from, to) > MAX_DAYS) {
    return json({ status: "error", code: "range_too_long", error: `ZooKeeper chỉ cho xem Kho creative tối đa ${MAX_DAYS} ngày một lần — thu hẹp khoảng ngày.` });
  }
  const items = body.items === true;
  const person = typeof body.person_key === "string" && /^[a-z0-9._@-]{1,80}$/i.test(body.person_key) ? body.person_key : null;
  if (items && !person) return json({ status: "error", error: "Danh sách creative cần person_key." }, 400);
  const key = cacheKey(from, to, items ? person : null, items);

  let row = await readCache(admin, key);
  const age = row?.fetched_at ? Date.now() - Date.parse(row.fetched_at) : Infinity;
  const ready = (r: CacheRow, stale: boolean, refreshing: boolean) =>
    json({ status: "ready", data: r.payload, fetched_at: r.fetched_at, stale, refreshing });
  if (row?.payload && age < ttlMs(to)) return ready(row, false, false);
  // Vừa lỗi dưới 1 phút trước và chưa từng có số ⇒ báo lỗi luôn, không dội zk liên tục.
  const errAge = row?.error && row.error_at ? Date.now() - Date.parse(row.error_at) : Infinity;
  if (!row?.payload && errAge < 60000) return json({ status: "error", error: row!.error });
  // Có số cũ mà zk vừa lỗi trong 5 phút qua ⇒ trả số cũ, chưa thử lại vội.
  if (row?.payload && errAge < 5 * 60000) return ready(row, true, false);

  const got = await claim(admin, key, from, to, items ? person : null, items);
  if (got) {
    const job = refresh(admin, key, from, to, items ? person : null, items);
    if (body.wait === true) {
      const out = await job;
      if (!out.ok && !row?.payload) return json({ status: "error", error: out.error });
      row = await readCache(admin, key);
      if (row?.payload) return ready(row, !out.ok, false);
    } else {
      EdgeRuntime.waitUntil(job);
    }
  }
  if (row?.payload) return ready(row, true, true);
  return json({ status: "pending", eta_s: etaSeconds(from, to), since: row?.refreshing_at ?? new Date().toISOString() });
}

// ---------------------------------------------------------------- cách gọi 2: cron job
async function cronRun(admin: SupabaseClient, runId: number, input: Json) {
  const steps: Step[] = [];
  const output: Json = {};
  const report = async (status: string, error: string | null = null, final = false) => {
    const { error: e } = await admin.rpc("cron_run_update", {
      p_run_id: runId, p_status: status, p_steps: steps, p_output: final ? output : null, p_error: error,
    });
    if (e) console.error("cron_run_update:", e.message);
  };
  const t0 = Date.now();
  try {
    const today = dayVN(0);
    const recentH = Math.max(1, num(input.recent_every_hours ?? 3));
    const oldH = Math.max(1, num(input.old_every_hours ?? 24));
    const budgetMs = Math.max(20, num(input.budget_seconds ?? 100)) * 1000;
    // maxAgeH = 0 ⇒ lấy lại ở MỌI lần chạy. Thứ tự = thứ tự ưu tiên khi hết quỹ thời gian.
    const targets: { name: string; from: string; to: string; maxAgeH: number }[] = [
      { name: "7 ngày gần nhất", from: dayVN(6), to: today, maxAgeH: 0 },
      { name: "D0", from: today, to: today, maxAgeH: 0 },
      { name: "D-1", from: dayVN(1), to: dayVN(1), maxAgeH: recentH },
      { name: "D-2", from: dayVN(2), to: dayVN(2), maxAgeH: recentH },
      { name: "tháng này", from: `${today.slice(0, 8)}01`, to: today, maxAgeH: recentH },
      ...[3, 4, 5, 6].map((n) => ({ name: `D-${n}`, from: dayVN(n), to: dayVN(n), maxAgeH: oldH })),
    ];
    if (isDay(input.date_from) && isDay(input.date_to)) {
      // Chỉ định tay (backfill): chia thành các khoảng tối đa 31 ngày.
      targets.length = 0;
      let a = input.date_from as string;
      while (a <= (input.date_to as string)) {
        const end = new Date(Date.parse(a) + (MAX_DAYS - 1) * 86400000).toISOString().slice(0, 10);
        const b = end < (input.date_to as string) ? end : (input.date_to as string);
        targets.push({ name: `${a} → ${b}`, from: a, to: b, maxAgeH: 0 });
        a = new Date(Date.parse(b) + 86400000).toISOString().slice(0, 10);
      }
    }
    const seen = new Set<string>(), fresh: string[] = [], skipped: string[] = [];
    output.window = { today, targets: targets.map((t) => `${t.name}: ${t.from}→${t.to}`) };
    await report("running");

    for (const t of targets) {
      const key = cacheKey(t.from, t.to, null, false);
      if (seen.has(key)) continue;
      seen.add(key);
      if (Date.now() - t0 > budgetMs) { skipped.push(t.name); continue; }
      if (t.maxAgeH > 0) {
        const row = await readCache(admin, key);
        const age = row?.payload && row.fetched_at ? Date.now() - Date.parse(row.fetched_at) : Infinity;
        if (age < t.maxAgeH * 3600e3 - 10 * 60e3) { fresh.push(t.name); continue; } // trừ hao 10 phút
      }
      if (!(await claim(admin, key, t.from, t.to, null, false))) { skipped.push(`${t.name} (đang có lượt khác lấy)`); continue; }
      const out = await refresh(admin, key, t.from, t.to, null, false);
      const name = `zk Kho creative · ${t.name}`;
      if (out.ok) {
        const tt = (out.payload as { totals: Agg }).totals;
        steps.push({ name, status: "ok", ms: out.ms, note: `${t.from}→${t.to}: ${tt.creatives} creative, ${tt.new} mới, ${tt.win} win / ${tt.tested} đủ chi, chi $${tt.spend}` });
      } else {
        steps.push({ name, status: "error", ms: out.ms, note: out.error.slice(0, 600) });
      }
      await report("running");
      await sleep(800);
    }

    // Dọn bản lưu không ai hỏi tới trong 14 ngày.
    const { error: delErr, count } = await admin.from("ua_creative_cache")
      .delete({ count: "exact" }).lt("last_hit_at", new Date(Date.now() - 14 * 86400000).toISOString());
    output.fresh = fresh;
    output.skipped = skipped;
    output.cleaned = delErr ? `lỗi dọn: ${delErr.message}` : count ?? 0;
    output.seconds = Math.round((Date.now() - t0) / 1000);

    const failed = steps.filter((s) => s.status === "error");
    if (failed.length) {
      output.failed_steps = failed.map((s) => s.name);
      await report("error", failed.map((s) => `${s.name}: ${s.note}`).join(" · "), true);
    } else {
      await report("success", null, true);
    }
  } catch (e) {
    await report("error", e instanceof Error ? e.message : String(e), true);
  }
}

// ---------------------------------------------------------------- điểm vào
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Chỉ nhận POST" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as Json;

  // Cron job: cron_fire() gửi kèm x-cron-secret.
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== null) {
    let expected: string;
    try {
      expected = await vault(admin, "afc_cron_secret");
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
    if (cronSecret !== expected) return json({ error: "Sai cron secret" }, 401);
    const runId = Number(body.run_id);
    if (!runId) return json({ error: "Thiếu run_id" }, 400);
    const { data: run, error } = await admin.from("cron_runs").select("id, status, input").eq("id", runId).maybeSingle();
    if (error || !run) return json({ error: `Không thấy cron_runs #${runId}` }, 404);
    if (run.status !== "queued") return json({ error: `Lần chạy #${runId} đang ở trạng thái ${run.status}` }, 409);
    EdgeRuntime.waitUntil(cronRun(admin, runId, (run.input ?? {}) as Json));
    return json({ ok: true, run_id: runId }, 202);
  }

  // Trang web / MCP: JWT của người dùng (role ua_manager hoặc admin), hoặc service role (afc-mcp gọi nội bộ).
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json({ status: "error", error: "Thiếu Authorization." }, 401);
  if (token !== serviceKey) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json({ status: "error", error: "Phiên đăng nhập không hợp lệ — đăng nhập lại." }, 401);
    const prof = await admin.from("app_users").select("role, is_active").eq("id", data.user.id).maybeSingle();
    if (prof.error || !prof.data?.is_active || !["ua_manager", "admin"].includes(prof.data.role as string)) {
      return json({ status: "error", error: "Chỉ UA Manager và admin được xem UA activity report." }, 403);
    }
  }
  try {
    return await serve(admin, body);
  } catch (e) {
    return json({ status: "error", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
