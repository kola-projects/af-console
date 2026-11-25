// [3.51.0] afc-mcp — MCP server (Streamable HTTP, không phiên) để Claude client truy vấn af-console.
//
// Cấu hình phía client:
//   { "type": "http", "url": "https://<project>.supabase.co/functions/v1/afc-mcp",
//     "headers": { "Authorization": "Bearer afc_…" } }
// Token do admin cấp bằng RPC mcp_token_create (DB chỉ lưu sha256). Mỗi token mang một role:
//   ua          — chỉ afc_list_apps
//   ua_manager  — thêm các tool ua_* (UA activity report) và cron_* (xem cron job)
//   admin       — như ua_manager
// CHỈ ĐỌC: không tool nào ghi dữ liệu. Đọc bằng service role, quyền do role của token quyết định.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SERVER = { name: "afc", version: "3.53.0" };
const PROTOCOL = "2025-03-26";
const INSTRUCTIONS =
  "af-console (AFC) của App-Factory, chỉ đọc. UA activity report: ua_scorecard (bảng điểm theo người), " +
  "ua_activity (đếm thao tác theo chiều tuỳ chọn), ua_money (tiền theo chủ app / app / ngày), ua_action_log " +
  "(nhật ký thô), ua_people (mapping người), ua_sync_status; ua_workload (creative lên + thao tác theo ngày của từng người), " +
  "ua_creatives (số Kho creative của ZooKeeper theo người hoặc app: creative mới, đủ chi, win, chi, ROAS quảng cáo = doanh thu " +
  "Adjust / chi của creative — KHÁC ROAS của khung tiền), ua_creative_items (creative mới của một người). Số Kho creative tối đa " +
  "31 ngày một lần; khoảng chưa có sẵn phải chờ ZooKeeper tính (tới ~70 giây). Hai khung gán khác nhau: THAO TÁC gán theo người " +
  "đã thao tác trên ZooKeeper; TIỀN gán theo chủ sở hữu app (gán tay trên AFC, chưa gán tay thì theo tag bdash). " +
  "Tiền là USD; doanh thu = AdMob + MAX + IAP + nhập tay; lãi = doanh thu − chi ads − phí; ROAS = doanh thu / " +
  "(chi ads + phí), roas_pct = null khi chi ads dưới $1 (app không chạy ads). Ngày theo GMT+7. " +
  "Số của mấy ngày gần nhất còn nhích theo bdash. afc_list_apps tra app của AF. Tool ua_* và cron_* cần token role ua_manager hoặc admin.";

type Json = Record<string, unknown>;
type Role = "ua" | "ua_manager" | "admin";
type Tool = {
  name: string;
  description: string;
  /** true = chỉ token role ua_manager hoặc admin gọi được. */
  manager?: boolean;
  inputSchema: Json;
  run: (db: SupabaseClient, a: Json) => Promise<unknown>;
};

const DAY = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD (GMT+7)" };
const LEVEL = {
  type: "string", enum: ["campaign", "adset", "adgroup", "ad", "all"], default: "campaign",
  description: "Cấp đối tượng bị thao tác. Mặc định campaign.",
};
const RANGE = { date_from: DAY, date_to: DAY };

const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function range(a: Json): [string, string] {
  if (!isDay(a.date_from) || !isDay(a.date_to)) throw new Error("Cần date_from và date_to dạng YYYY-MM-DD.");
  if (a.date_from > a.date_to) throw new Error("date_from phải không sau date_to.");
  return [a.date_from, a.date_to];
}

type Summary = {
  actions: { day: string; person_key: string; person_name: string; app_id: string | null; platform: string; bucket: string; n: number }[];
  money: { day: string; app_id: string; revenue: number; cost: number; fees: number; installs: number }[];
  apps: { app_id: string; app_name: string | null; tags: string[]; owner_key: string | null; owner_source: "manual" | "tag" | null; app_code: string | null }[];
  people: { person_key: string; display_name: string; zk_emails: string[]; bdash_tags: string[] }[];
  data_from: string | null; data_to: string | null; sync: Json | null;
};

async function summary(db: SupabaseClient, a: Json): Promise<Summary> {
  const [from, to] = range(a);
  const { data, error } = await db.rpc("ua_report_summary", { p_from: from, p_to: to, p_level: str(a.level) ?? "campaign" });
  if (error) throw new Error(error.message);
  return data as Summary;
}

function moneyRow(m: { revenue: number; cost: number; fees: number; installs: number }) {
  const profit = m.revenue - m.cost - m.fees;
  const spent = m.cost + m.fees;
  return {
    revenue: r2(m.revenue), cost: r2(m.cost), fees: r2(m.fees), profit: r2(profit),
    // Chi ads dưới $1 = app không chạy ads: tỉ lệ ra hàng nghìn % và không nói gì về hiệu quả ads (khớp web 3.52.0).
    roas_pct: m.cost >= 1 ? r2((m.revenue / spent) * 100) : null, installs: m.installs,
  };
}

function scorecard(s: Summary) {
  const appOf = new Map(s.apps.map((x) => [x.app_id, x]));
  const nameOf = new Map(s.people.map((p) => [p.person_key, p.display_name]));
  const rows = new Map<string, { person_key: string; person: string; create: number; update: number; revenue: number; cost: number; fees: number; installs: number; owned: boolean }>();
  const get = (k: string, label: string) => {
    let r = rows.get(k);
    if (!r) { r = { person_key: k, person: label, create: 0, update: 0, revenue: 0, cost: 0, fees: 0, installs: 0, owned: false }; rows.set(k, r); }
    return r;
  };
  for (const x of s.actions) {
    const r = get(x.person_key, nameOf.get(x.person_key) ?? x.person_name);
    if (x.bucket === "create") r.create += num(x.n); else r.update += num(x.n);
  }
  for (const m of s.money) {
    const owner = appOf.get(m.app_id)?.owner_key ?? null;
    const r = owner ? get(owner, nameOf.get(owner) ?? owner) : get("_unassigned", "Chưa gán người (app chưa có chủ)");
    r.revenue += num(m.revenue); r.cost += num(m.cost); r.fees += num(m.fees); r.installs += num(m.installs); r.owned = true;
  }
  const out = [...rows.values()].map((r) => {
    const actions = r.create + r.update;
    const money = r.owned ? moneyRow(r) : null;
    return {
      person_key: r.person_key, person: r.person, create: r.create, update: r.update, actions,
      owned_apps_money: money,
      profit_per_action: money && actions > 0 ? r2(money.profit / actions) : null,
    };
  }).sort((a, b) => b.actions - a.actions || (b.owned_apps_money?.revenue ?? 0) - (a.owned_apps_money?.revenue ?? 0));
  const tot = s.money.reduce((t, m) => ({ revenue: t.revenue + num(m.revenue), cost: t.cost + num(m.cost), fees: t.fees + num(m.fees), installs: t.installs + num(m.installs) }),
    { revenue: 0, cost: 0, fees: 0, installs: 0 });
  return {
    totals: {
      create: out.reduce((t, r) => t + r.create, 0), update: out.reduce((t, r) => t + r.update, 0),
      actions: out.reduce((t, r) => t + r.actions, 0), money: moneyRow(tot),
    },
    people: out,
    note: "actions = người đã thao tác; owned_apps_money = tiền của các app người đó SỞ HỮU (gán tay trên AFC, chưa gán tay thì theo tag bdash). Hai khung khác nhau.",
    data_range_in_db: [s.data_from, s.data_to], sync: s.sync,
  };
}

/** Gọi nội bộ edge function ua-creative-pipeline (chờ tới khi có số). */
async function pipeline(body: Json): Promise<{ data: Json; fetched_at: string; stale: boolean }> {
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ua-creative-pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, wait: true }),
  });
  const j = await r.json().catch(() => null) as Json | null;
  if (!j) throw new Error(`ua-creative-pipeline: HTTP ${r.status}`);
  if (j.status === "error") throw new Error(String(j.error));
  if (j.status === "pending") throw new Error(`ZooKeeper đang tính số cho khoảng ngày này — gọi lại sau khoảng ${j.eta_s} giây.`);
  return j as { data: Json; fetched_at: string; stale: boolean };
}
const roasPct = (a: Json) => (num(a.spend) >= 1 ? r2((num(a.revenue) / num(a.spend)) * 100) : null);
const creativeRow = (a: Json) => ({
  running: num(a.creatives), new: num(a.new), tested: num(a.tested), win: num(a.win), below_threshold: num(a.not_ok),
  testing: num(a.testing), owner_inferred_by_zk: num(a.inferred), spend: r2(num(a.spend)), adjust_revenue: r2(num(a.revenue)), ad_roas_pct: roasPct(a),
});

const TOOLS: Tool[] = [
  {
    name: "ua_scorecard",
    manager: true,
    description: "Bảng điểm UA theo người trong một khoảng ngày: số thao tác thêm/update, tiền của app họ sở hữu (doanh thu, chi, phí, lãi, ROAS), lãi trên mỗi thao tác, kèm tổng toàn team.",
    inputSchema: { type: "object", properties: { ...RANGE, level: LEVEL }, required: ["date_from", "date_to"] },
    run: async (db, a) => scorecard(await summary(db, a)),
  },
  {
    name: "ua_activity",
    manager: true,
    description: "Đếm thao tác UA (create / update) gom theo 1–3 chiều: person, app, day, platform. Lọc được theo người hoặc app.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANGE, level: LEVEL,
        group_by: { type: "array", items: { type: "string", enum: ["person", "app", "day", "platform"] }, minItems: 1, maxItems: 3, default: ["person"] },
        person: { type: "string", description: "Lọc: person_key hoặc một phần tên người." },
        app: { type: "string", description: "Lọc: app_id (package) hoặc một phần tên app." },
      },
      required: ["date_from", "date_to"],
    },
    run: async (db, a) => {
      const s = await summary(db, a);
      const appOf = new Map(s.apps.map((x) => [x.app_id, x]));
      const dims = (Array.isArray(a.group_by) && a.group_by.length ? a.group_by : ["person"]) as string[];
      const fp = str(a.person)?.toLowerCase(), fa = str(a.app)?.toLowerCase();
      const agg = new Map<string, Json>();
      for (const x of s.actions) {
        const appName = x.app_id ? appOf.get(x.app_id)?.app_name ?? x.app_id : "(chưa suy ra app)";
        if (fp && !(x.person_key.toLowerCase() === fp || x.person_name.toLowerCase().includes(fp))) continue;
        if (fa && !((x.app_id ?? "").toLowerCase() === fa || appName.toLowerCase().includes(fa))) continue;
        const key: Json = {};
        for (const d of dims) {
          if (d === "person") { key.person_key = x.person_key; key.person = x.person_name; }
          else if (d === "app") { key.app_id = x.app_id; key.app = appName; }
          else if (d === "day") key.day = x.day;
          else if (d === "platform") key.platform = x.platform;
        }
        const k = JSON.stringify(key);
        const cur = agg.get(k) ?? { ...key, create: 0, update: 0, actions: 0 };
        if (x.bucket === "create") cur.create = num(cur.create) + num(x.n); else cur.update = num(cur.update) + num(x.n);
        cur.actions = num(cur.actions) + num(x.n);
        agg.set(k, cur);
      }
      const rows = [...agg.values()].sort((x, y) => num(y.actions) - num(x.actions));
      return { group_by: dims, rows: rows.slice(0, 500), truncated: rows.length > 500 };
    },
  },
  {
    name: "ua_money",
    manager: true,
    description: "Tiền (USD) trong một khoảng ngày, gom theo owner (chủ sở hữu app), app hoặc day: doanh thu, chi ads, phí, lãi, ROAS, installs. Khớp cách tính của BBL Dashboard. group_by=app trả thêm owner_source: manual = gán tay trên AFC, tag = theo tag bdash, null = chưa có chủ.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANGE,
        group_by: { type: "string", enum: ["owner", "app", "day"], default: "owner" },
        owner: { type: "string", description: "Lọc: person_key của chủ app, hoặc 'none' cho app chưa gán người." },
        app: { type: "string", description: "Lọc: app_id (package) hoặc một phần tên app." },
      },
      required: ["date_from", "date_to"],
    },
    run: async (db, a) => {
      const s = await summary(db, { ...a, level: "campaign" });
      const appOf = new Map(s.apps.map((x) => [x.app_id, x]));
      const nameOf = new Map(s.people.map((p) => [p.person_key, p.display_name]));
      const by = str(a.group_by) ?? "owner";
      const fo = str(a.owner)?.toLowerCase(), fa = str(a.app)?.toLowerCase();
      const agg = new Map<string, { key: Json; revenue: number; cost: number; fees: number; installs: number }>();
      for (const m of s.money) {
        const ap = appOf.get(m.app_id);
        const owner = ap?.owner_key ?? null;
        const appName = ap?.app_name ?? m.app_id;
        if (fo && (fo === "none" ? owner !== null : owner !== fo)) continue;
        if (fa && !(m.app_id.toLowerCase() === fa || appName.toLowerCase().includes(fa))) continue;
        const key: Json = by === "app"
          ? { app_id: m.app_id, app: appName, owner: owner ? nameOf.get(owner) ?? owner : null, owner_source: ap?.owner_source ?? null, afc_app_code: ap?.app_code ?? null }
          : by === "day" ? { day: m.day }
          : { owner_key: owner, owner: owner ? nameOf.get(owner) ?? owner : "Chưa gán người" };
        const k = JSON.stringify(key);
        const cur = agg.get(k) ?? { key, revenue: 0, cost: 0, fees: 0, installs: 0 };
        cur.revenue += num(m.revenue); cur.cost += num(m.cost); cur.fees += num(m.fees); cur.installs += num(m.installs);
        agg.set(k, cur);
      }
      const rows = [...agg.values()].map((r) => ({ ...r.key, ...moneyRow(r) }));
      rows.sort((x, y) => by === "day" ? String((x as Json).day).localeCompare(String((y as Json).day)) : y.revenue - x.revenue);
      return { group_by: by, currency: "USD", rows: rows.slice(0, 500), truncated: rows.length > 500 };
    },
  },
  {
    name: "ua_action_log",
    manager: true,
    description: "Nhật ký thô từng thao tác UA (mới nhất trước): thời điểm, người, app suy ra, nền tảng, cấp, loại thao tác, nguồn (dashboard / launcher / rule / api), tên đối tượng, thay đổi trước–sau.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANGE,
        level: LEVEL,
        person: { type: "string", description: "person_key chính xác (xem ua_people)." },
        app_id: { type: "string", description: "app_id (package) chính xác." },
        action_type: { type: "string", description: "create | status_change | budget_change | bid_change | rename | update | delete" },
        source: { type: "string", enum: ["dashboard", "launcher", "rule", "api"] },
        search: { type: "string", description: "Một phần tên campaign/ad." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
      required: ["date_from", "date_to"],
    },
    run: async (db, a) => {
      const [from, to] = range(a);
      const limit = Math.min(200, Math.max(1, num(a.limit) || 50)), offset = Math.max(0, num(a.offset));
      let q = db.from("v_ua_actions")
        .select("occurred_at, person_key, person_name, app_id, app_name, platform, level, action_type, source, outcome, entity_name, account_id, changes", { count: "exact" })
        .gte("day", from).lte("day", to).order("occurred_at", { ascending: false }).range(offset, offset + limit - 1);
      const level = str(a.level) ?? "campaign";
      if (level !== "all") q = q.eq("level", level);
      if (str(a.person)) q = q.eq("person_key", str(a.person)!);
      if (str(a.app_id)) q = q.eq("app_id", str(a.app_id)!);
      if (str(a.action_type)) q = q.eq("action_type", str(a.action_type)!);
      if (str(a.source)) q = q.eq("source", str(a.source)!);
      if (str(a.search)) q = q.ilike("entity_name", `%${str(a.search)!.replace(/[%_]/g, "")}%`);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { total: count, offset, limit, has_more: (count ?? 0) > offset + (data?.length ?? 0), items: data };
    },
  },
  {
    name: "ua_workload",
    manager: true,
    description: "Workload theo ngày của từng người UA: số creative đưa lên chạy (ZooKeeper) và số thao tác trên campaign/ad, mỗi ngày một dòng. Dữ liệu có từ tháng 8/2026. Chỉ phản ánh việc đi qua ZooKeeper.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANGE,
        level: { ...LEVEL, default: "all", description: "Cấp đối tượng của thao tác. Mặc định all." },
        person: { type: "string", description: "Lọc: person_key hoặc một phần tên người." },
      },
      required: ["date_from", "date_to"],
    },
    run: async (db, a) => {
      const [from, to] = range(a);
      const { data, error } = await db.rpc("ua_activity_calendar", { p_from: from, p_to: to, p_level: str(a.level) ?? "all" });
      if (error) throw new Error(error.message);
      const fp = str(a.person)?.toLowerCase();
      const people = new Map<string, { person_key: string; person: string; uploads: number; actions: number; active_days: number; days: Json[] }>();
      for (const r of ((data as Json).rows as Json[]) ?? []) {
        const key = String(r.person_key), name = String(r.person_name);
        if (fp && !(key.toLowerCase() === fp || name.toLowerCase().includes(fp))) continue;
        let p = people.get(key);
        if (!p) { p = { person_key: key, person: name, uploads: 0, actions: 0, active_days: 0, days: [] }; people.set(key, p); }
        p.uploads += num(r.uploads); p.actions += num(r.actions); p.active_days += 1;
        p.days.push({ day: r.day, creatives_uploaded: num(r.uploads), actions: num(r.actions) });
      }
      const rows = [...people.values()].sort((x, y) => y.uploads + y.actions - (x.uploads + x.actions));
      for (const p of rows) p.days.sort((x, y) => String(x.day).localeCompare(String(y.day)));
      return { date_from: from, date_to: to, data_from: (data as Json).data_from, people: rows, note: "Ngày không có trong days = không có hoạt động ghi nhận qua ZooKeeper (không tính sửa thẳng trong Ads Manager / Google Ads)." };
    },
  },
  {
    name: "ua_creatives",
    manager: true,
    description: "Số Kho creative của ZooKeeper trong một khoảng ngày (tối đa 31 ngày), gom theo person (người lên creative) hoặc app: creative đang chạy, creative mới, đủ chi (chi từ ngưỡng, mặc định $10), win (đủ chi và ROAS Adjust ≥ ngưỡng), chi, doanh thu Adjust, ROAS quảng cáo. Khớp màn Kho creative của ZooKeeper cho cùng khoảng ngày.",
    inputSchema: {
      type: "object",
      properties: {
        ...RANGE,
        group_by: { type: "string", enum: ["person", "app"], default: "person" },
        person: { type: "string", description: "Lọc: person_key hoặc một phần tên người." },
        app: { type: "string", description: "Lọc: một phần tên app (tên theo ZooKeeper) hoặc app_id." },
      },
      required: ["date_from", "date_to"],
    },
    run: async (_db, a) => {
      const [from, to] = range(a);
      const out = await pipeline({ from, to });
      const d = out.data as { totals: Json; min_spend: number; roas_threshold: number; people: (Json & { person_key: string; name: string; apps: (Json & { app: string; app_id: string | null })[] })[] };
      const fp = str(a.person)?.toLowerCase(), fa = str(a.app)?.toLowerCase();
      const people = d.people.filter((p) => !fp || p.person_key.toLowerCase() === fp || p.name.toLowerCase().includes(fp));
      const appOk = (x: { app: string; app_id: string | null }) => !fa || x.app.toLowerCase().includes(fa) || (x.app_id ?? "").toLowerCase() === fa;
      const head = { date_from: from, date_to: to, fetched_at: out.fetched_at, stale: out.stale, min_spend_usd: d.min_spend, win_roas_threshold_pct: d.roas_threshold * 100 };
      if ((str(a.group_by) ?? "person") === "app") {
        const apps = new Map<string, { app: string; app_id: string | null; agg: Json; people: { person: string; new: number; running: number }[] }>();
        for (const p of people) for (const x of p.apps.filter(appOk)) {
          let r = apps.get(x.app);
          if (!r) { r = { app: x.app, app_id: x.app_id, agg: {}, people: [] }; apps.set(x.app, r); }
          for (const k of ["creatives", "new", "tested", "win", "not_ok", "testing", "inferred", "spend", "revenue"]) r.agg[k] = num(r.agg[k]) + num(x[k]);
          if (p.person_key !== "_unknown") r.people.push({ person: p.name, new: num(x.new), running: num(x.creatives) });
        }
        const rows = [...apps.values()].map((r) => ({ app: r.app, app_id: r.app_id, ...creativeRow(r.agg), people: r.people.sort((x, y) => y.new - x.new || y.running - x.running) }))
          .sort((x, y) => y.spend - x.spend);
        return { ...head, group_by: "app", rows: rows.slice(0, 300), truncated: rows.length > 300 };
      }
      return {
        ...head, group_by: "person",
        team_totals: fp || fa ? undefined : creativeRow(d.totals),
        rows: people.map((p) => ({
          person_key: p.person_key, person: p.name, ...creativeRow(fa ? p.apps.filter(appOk).reduce<Json>((t, x) => { for (const k of ["creatives", "new", "tested", "win", "not_ok", "testing", "inferred", "spend", "revenue"]) t[k] = num(t[k]) + num(x[k]); return t; }, {}) : p),
          apps: p.apps.filter(appOk).slice(0, 8).map((x) => ({ app: x.app, app_id: x.app_id, ...creativeRow(x) })),
        })),
        note: "team_totals đếm mỗi creative một lần. owner_inferred_by_zk = creative không ghi nhận được người lên, ZooKeeper gán cho người chạy app đó nhiều nhất. ad_roas_pct = doanh thu Adjust / chi của creative, null khi chi dưới $1.",
      };
    },
  },
  {
    name: "ua_creative_items",
    manager: true,
    description: "Danh sách creative MỚI của một người UA trong khoảng ngày (tối đa 31 ngày, 100 creative mới nhất): tên file, app, nền tảng, lúc lên, chi, doanh thu Adjust, ROAS, trạng thái (untested / testing / win / not_ok).",
    inputSchema: { type: "object", properties: { ...RANGE, person: { type: "string", description: "person_key chính xác (xem ua_people)." } }, required: ["date_from", "date_to", "person"] },
    run: async (_db, a) => {
      const [from, to] = range(a);
      if (!str(a.person)) throw new Error("Cần person (person_key).");
      const out = await pipeline({ from, to, person_key: str(a.person), items: true });
      return { fetched_at: out.fetched_at, ...out.data };
    },
  },
  {
    name: "ua_people",
    manager: true,
    description: "Mapping người UA: person_key, tên, email ZooKeeper, tag bdash (chủ app theo tag khi app chưa được gán tay trên AFC).",
    inputSchema: { type: "object", properties: {} },
    run: async (db) => {
      const { data, error } = await db.from("ua_people").select("person_key, display_name, zk_emails, bdash_tags, note").order("display_name");
      if (error) throw new Error(error.message);
      return { people: data };
    },
  },
  {
    name: "ua_sync_status",
    manager: true,
    description: "Tình trạng đồng bộ dữ liệu UA report: khoảng ngày đang có trong DB và 5 lần chạy gần nhất của job ua-report-sync.",
    inputSchema: { type: "object", properties: {} },
    run: async (db) => {
      const [runs, lo, hi] = await Promise.all([
        db.from("cron_runs").select("id, trigger, status, started_at, finished_at, error").eq("job_key", "ua-report-sync").order("started_at", { ascending: false }).limit(5),
        db.from("ua_actions").select("day").order("day", { ascending: true }).limit(1),
        db.from("ua_actions").select("day").order("day", { ascending: false }).limit(1),
      ]);
      if (runs.error) throw new Error(runs.error.message);
      return { data_from: lo.data?.[0]?.day ?? null, data_to: hi.data?.[0]?.day ?? null, recent_runs: runs.data };
    },
  },
  {
    name: "afc_list_apps",
    description: "Tra app của App-Factory trên af-console: mã app (app_code), tên, package, nền tảng, team, đã live chưa. Tìm theo mã, tên hoặc package.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Một phần mã app, tên hoặc package." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
    run: async (db, a) => {
      let q = db.from("apps").select("app_code, name, package_name, platform, team, go_live, go_live_at", { count: "exact" })
        .eq("is_hidden", false).order("app_code", { ascending: false }).limit(Math.min(200, Math.max(1, num(a.limit) || 50)));
      const s = str(a.search)?.replace(/[%_,()]/g, "");
      if (s) q = q.or(`app_code.ilike.%${s}%,name.ilike.%${s}%,package_name.ilike.%${s}%`);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { total: count, apps: data };
    },
  },
  {
    name: "cron_list_jobs",
    manager: true,
    description: "Danh sách cron job của af-console: lịch (cron UTC), tham số, đang bật hay tắt.",
    inputSchema: { type: "object", properties: {} },
    run: async (db) => {
      const { data, error } = await db.from("cron_jobs").select("job_key, name, description, function_name, schedule, params, enabled, updated_at");
      if (error) throw new Error(error.message);
      return { jobs: data };
    },
  },
  {
    name: "cron_list_runs",
    manager: true,
    description: "Lịch sử chạy cron job (mới nhất trước): trạng thái, nguồn kích hoạt, thời gian, lỗi.",
    inputSchema: {
      type: "object",
      properties: {
        job_key: { type: "string" }, status: { type: "string", enum: ["queued", "running", "success", "error"] },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
    run: async (db, a) => {
      let q = db.from("cron_runs").select("id, job_key, trigger, status, started_at, finished_at, error")
        .order("started_at", { ascending: false }).limit(Math.min(100, Math.max(1, num(a.limit) || 20)));
      if (str(a.job_key)) q = q.eq("job_key", str(a.job_key)!);
      if (str(a.status)) q = q.eq("status", str(a.status)!);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { runs: data };
    },
  },
  {
    name: "cron_get_run",
    manager: true,
    description: "Chi tiết một lần chạy cron job để debug: input, từng bước kèm thời gian, output, lỗi.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    run: async (db, a) => {
      const { data, error } = await db.from("cron_runs").select("*").eq("id", num(a.id)).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`Không có lần chạy #${a.id}.`);
      return data;
    },
  },
];

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(db: SupabaseClient, role: Role, msg: Json): Promise<Json | null> {
  const id = msg.id;
  const method = String(msg.method ?? "");
  if (method.startsWith("notifications/")) return null;
  if (method === "initialize") {
    const want = (msg.params as Json | undefined)?.protocolVersion;
    return ok(id, {
      protocolVersion: typeof want === "string" ? want : PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER,
      instructions: INSTRUCTIONS,
    });
  }
  if (method === "ping") return ok(id, {});
  const visible = TOOLS.filter((t) => !t.manager || role === "ua_manager" || role === "admin");
  if (method === "tools/list") {
    return ok(id, { tools: visible.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === "tools/call") {
    const p = (msg.params ?? {}) as { name?: string; arguments?: Json };
    const tool = visible.find((t) => t.name === p.name);
    if (!tool) return fail(id, -32602, `Không có tool ${p.name} (hoặc token không đủ quyền).`);
    try {
      const out = await tool.run(db, p.arguments ?? {});
      return ok(id, { content: [{ type: "text", text: JSON.stringify(out) }], isError: false });
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
    }
  }
  if (id === undefined) return null;
  return fail(id, -32601, `Method không hỗ trợ: ${method}`);
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

  if (req.method !== "POST") return json(fail(null, -32600, "MCP endpoint chỉ nhận POST."), 405, { Allow: "POST" });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("afc_")) return json(fail(null, -32001, "Thiếu hoặc sai token (Authorization: Bearer afc_…)."), 401, { "WWW-Authenticate": "Bearer" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const chk = await db.rpc("mcp_token_check", { p_hash: await sha256Hex(token) });
  if (chk.error) return json(fail(null, -32603, "Không kiểm được token."), 500);
  if (chk.data !== "ua" && chk.data !== "ua_manager" && chk.data !== "admin") return json(fail(null, -32001, "Token không hợp lệ hoặc đã bị thu hồi."), 401, { "WWW-Authenticate": "Bearer" });
  const role = chk.data as Role;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(fail(null, -32700, "Body không phải JSON."), 400);
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(db, role, m as Json)))).filter((x) => x !== null);
    return out.length ? json(out) : json(null, 202);
  }
  const out = await handle(db, role, body as Json);
  return out === null ? json(null, 202) : json(out);
});
