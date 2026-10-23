// [3.49.0] app-sync — ĐỒNG BỘ metadata app từ nguồn ngoài, gọi từ nút "Đồng bộ" trên trang quản lý app.
// Mỗi app: package (cột apps.package_name, hoặc suy từ extra.store_url) → Play Store existence-check
// (200 = live, 404 = chưa) → icon og:image + tên listing → link store → dashboard link theo công thức
// https://dashboard.stemlabs.site/apps/<package>. Ghi: apps.package_name, go_live(+go_live_at),
// integration.go_live, extra.{store_url, icon_url, dashboard_url, play_title, sync}.
// Chỉ admin (RPC is_admin theo JWT người gọi); ghi bằng service role. Cùng quy ước với
// tools/golive_scan.py + tools/resolve_store_icons.py của AF (chạy từ máy) — đây là bản chạy từ web.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const DASHBOARD = "https://dashboard.stemlabs.site/apps/";

type AppRow = {
  id: number;
  app_code: string | null;
  name: string;
  package_name: string | null;
  platform: string | null;
  go_live: boolean | null;
  go_live_at: string | null;
  integration: Record<string, unknown> | null;
  extra: Record<string, unknown> | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function pkgFromStoreUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const m = u.match(/[?&]id=([\w.]+)/);
  return m ? m[1] : null;
}

async function playCheck(pkg: string) {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en&gl=US`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
    const http = r.status;
    let icon: string | null = null;
    let title: string | null = null;
    if (http === 200) {
      const html = await r.text();
      const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ??
        html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);
      icon = og ? og[1].replace(/&amp;/g, "&") : null;
      const t = html.match(/<title[^>]*>([^<]*)<\/title>/);
      title = t ? t[1].replace(/\s*-\s*Apps on Google Play\s*$/i, "").trim() : null;
    }
    return { http, icon, title, url };
  } catch (e) {
    return { http: 0, icon: null, title: null, url, error: String(e) };
  }
}

async function syncOne(admin: ReturnType<typeof createClient>, a: AppRow, today: string) {
  const extra = { ...(a.extra ?? {}) } as Record<string, unknown>;
  const integ = { ...(a.integration ?? {}) } as Record<string, unknown>;
  const pkg = a.package_name || pkgFromStoreUrl(extra.store_url);
  const out: Record<string, unknown> = { id: a.id, app_code: a.app_code, name: a.name, package: pkg };
  if (!pkg) {
    out.skipped = "không có package (cột package_name trống, extra.store_url không có id=)";
    return out;
  }
  const body: Record<string, unknown> = {};
  if (!a.package_name) body.package_name = pkg;
  const play = await playCheck(pkg);
  out.http = play.http;
  if (play.http === 200) {
    body.go_live = true;
    if (!a.go_live_at) body.go_live_at = new Date().toISOString();
    extra.store_url = play.url.replace("&hl=en&gl=US", "");
    if (play.icon) extra.icon_url = play.icon;
    if (play.title) extra.play_title = play.title;
    out.live = true;
    out.icon = !!play.icon;
  } else if (play.http === 404) {
    body.go_live = false;
    out.live = false;
  } else {
    out.live = "unknown";
  }
  if (!extra.dashboard_url) extra.dashboard_url = DASHBOARD + pkg;
  out.dashboard = extra.dashboard_url;
  integ.go_live = { source: "play-store", http: play.http, checked_at: today, via: "app-sync" };
  extra.sync = { at: new Date().toISOString(), play_http: play.http };
  body.extra = extra;
  body.integration = integ;
  const { error } = await admin.from("apps").update(body).eq("id", a.id);
  if (error) out.error = error.message;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: isAdmin, error: adminErr } = await user.rpc("is_admin");
  if (adminErr || !isAdmin) return json({ error: "Chỉ admin mới được đồng bộ." }, 403);

  let ids: number[] = [];
  try {
    const b = await req.json();
    ids = Array.isArray(b?.ids) ? b.ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n)) : [];
  } catch { /* body rỗng */ }
  if (!ids.length) return json({ error: "Thiếu ids (mảng id app, tối đa 60 mỗi lần)." }, 400);
  ids = ids.slice(0, 60);

  const admin = createClient(url, service);
  const { data, error } = await admin
    .from("apps")
    .select("id,app_code,name,package_name,platform,go_live,go_live_at,integration,extra")
    .in("id", ids);
  if (error) return json({ error: error.message }, 500);
  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []) as AppRow[];
  const results: Record<string, unknown>[] = [];
  // 3 app một lượt — tránh Play rate-limit
  for (let i = 0; i < rows.length; i += 3) {
    const chunk = rows.slice(i, i + 3);
    const part = await Promise.all(chunk.map((a) => syncOne(admin, a, today)));
    results.push(...part);
  }
  const live = results.filter((r) => r.live === true).length;
  return json({ ok: true, count: results.length, live, results });
});
