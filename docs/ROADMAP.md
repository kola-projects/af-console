# ROADMAP — AFC nâng cấp đa người dùng (RBAC + Storage + Requests)

> Nguồn sự thật cho task lớn nhiều-session. **Đọc file này TRƯỚC khi bàn lại** — mọi quyết định đã chốt
> nằm đây, đừng thảo luận lại từ đầu. Cập nhật khi có quyết định mới. (Chi tiết vận hành/evidence: DB;
> file này là bản thiết kế bền trong git theo nguyên tắc PORTABILITY.)

Khởi thảo 2026-08-17. Trạng thái tổng: **đang triển khai từng phase**.

## Mục tiêu
Nâng AFC từ "công cụ nội bộ 1 admin" → **cổng nhiều người dùng phân quyền theo tính năng** + **đưa blueprint
ra Storage** + **cơ chế đặt yêu cầu cho admin**. Ba mặt phẳng + một mặt phẳng ẩn:

| Plane | Việc | Bản chất |
|---|---|---|
| Identity & Access | user + phân quyền theo tính năng | RBAC trên Supabase Auth, enforce bằng RLS |
| Data | blueprint → Storage | tách blob khỏi index; DB gầy lại |
| Control/Workflow | cơ chế đặt yêu cầu | hàng đợi lệnh người-xử-lý, cầu nối cloud↔máy admin |
| (ẩn) Security retrofit | — | AFC dùng anon key ⇒ **RLS là hàng rào DUY NHẤT**; thêm user non-admin = soi lại RLS mọi bảng |

## Nguyên tắc chi phối (BẤT BIẾN)
1. **UI ẩn/hiện nút ≠ bảo mật.** AFC gọi thẳng Supabase bằng publishable key ⇒ **mọi phân quyền thật ở RLS**.
2. **Model capability, không role-cứng.** "Phân quyền theo tính năng" = permission; role chỉ là gói permission.
3. **`af_db.sh` dùng service_role (bypass RLS)** ⇒ pipeline local KHÔNG bị RBAC đụng. RBAC chỉ áp cho browser.
4. Giá trị bền của DB = **lesson learned**; blueprint sinh lại được (đó là lý do dời ra Storage).

## Trình tự phase (migration)
```
0017  blueprint → Storage ...................... ✅ XONG (v4.7.0, 2026-08-17)
0020  role mở rộng + af_versions + requests ..... ✅ XONG (2026-08-20) — xem "Đã triển khai" bên dưới
0021  bucket request-uploads (đính kèm) ......... ✅ XONG (2026-08-20)
0022  Discord notify order mới (pg_net+Vault) ... ✅ XONG (2026-08-20) — KHÔNG cần Edge Function
──    RBAC per-capability (permissions N-N) ..... ⏳ sau — v1 dùng RBAC COARSE (đọc/admin-ghi)
──    drop content_b64 + VACUUM ................. ⏳ sau khi AFC đọc-Storage chạy ổn (user chốt thời điểm)
──    worker chạy đơn theo request_code ......... ⏳ chưa (AF map payload→CLI)
```
Ràng buộc gốc "không mở non-admin trước khi siết RLS" đã được GIẢI QUYẾT ở 0020 bằng **RBAC coarse**:
non-admin (dev/ua/aso) chỉ ĐỌC business tables + đặt đơn; GHI = admin + service_role (CLI).

## Đã triển khai — session 2026-08-20 (migration 0020 + 0021, af-console)
**Quyết định chốt cùng user (không bàn lại):**
- Admin **tạo user trực tiếp** (email+mật khẩu+role) qua `pending_invites` + client tạm signUp (không cần
  service_role, không văng session admin). Role v1: `dev`/`ua`/`aso`/`admin`, **mọi non-admin quyền GIỐNG NHAU**
  (đọc + đặt đơn). RBAC per-capability để phase sau.
- **RBAC coarse** (0020 §5): business tables đổi `is_active_user (for all)` → `select=is_active_user` +
  `write=is_admin`. CLI service_role bypass nên pipeline không đổi.
- **af_versions** (admin lock/unlock; default = bản mở khoá mới nhất). Seed v5.3.0 (mở), v5.1.1/v5.1.0/v5.0.0 (khoá).
- **requests + request_events** + RPC `create_request`/`cancel_request`/`set_request_status` (SECURITY DEFINER).
  Mã `request_code = rNNNNN` tuần tự (AF chạy theo mã). State: submitted→accepted→in_progress→done|rejected|failed;
  user huỷ (→cancelled) khi chưa in_progress; admin đổi trạng thái + reject.
- **3 form đặt đơn** (af-console `/requests`, mọi role):
  - **Make app**: mode (bỏ `generate`; changeFeatureExtremeAuto ép src store/appstore) · `-v` default 3 · src ·
    link tham khảo · appName · **Team (Auto/Titan, tuỳ chọn — lọc app sau)** · **ASO BẮT BUỘC** (store+package+appName,
    biến thể Layout1×Style1 auto) · **google-services.json BẮT BUỘC** · **KHÔNG ads, KHÔNG mockup** (luôn --ads=false).
  - **Ads integration**: appCode · ads full/off · variant · pages · survey.
  - **ASO**: appCode → picker Layout×Style độc lập (load từ blueprint, không có thì nhập tay) · store · appName ·
    onPhoneName (default appName) · packageName · appVersion (1.0.0) · releaseNote · Legal chạy trước.
  - Mọi form: **upload ảnh/file tự do** (bucket `request-uploads`, path `<uid>/<draftId>/<file>`).
- **Trang Users**: khối "Tạo người dùng" (admin) + ô chọn 4 role thay nút gạt; giữ chốt "không hạ/khoá admin cuối".

**Contract cho AF nâng cấp sau — `blueprint/appearance/variants.json`** (AFC chỉ LOAD, không có thì nhập tay):
```json
{ "schema": 1, "design_variants": 3,
  "layouts": [{ "ordinal": 0, "id": "ORIGINAL", "label": "Original", "preview": "appearance/layout_0.png" }],
  "styles":  [{ "ordinal": 0, "id": "CLASSIC_ORANGE", "label": "Classic Orange", "preview": "appearance/style_0.png" }] }
```
Lý do (khảo sát 2026-08-20): dev mode render preview LIVE trong app, blueprint KHÔNG có ảnh preview per-variant
chuẩn hoá và KHÔNG có manifest. AFC hiện suy N từ `task.md: design_variants`, hoặc cho nhập tay. Khi AF sinh
manifest trên vào blueprint (kèm ảnh `appearance/*.png`), AFC tự render picker có preview — KHÔNG cần đổi AFC.

**Phạm vi non-admin + tách trang App (0023) — ĐÃ LÀM:**
- Non-admin blueprint CHỈ `aso/`+`design_previews/`+`legal/` (RLS bảng + Storage bucket). Bảng nội bộ
  (runs/lessons/bugs/libraries/tags/ads) khoá đọc về admin; view nội bộ `security_invoker=on`; view an toàn
  `v_app_blueprints` cho non-admin lấy blueprint run mà không mở bảng runs (đã lọc app ẩn).
- `apps.is_hidden` + admin ẩn/hiện. Non-admin không thấy app ẩn (RLS).
- **2 trang App tách biệt:** `/apps` = DANH MỤC SẢN PHẨM (mọi user) — trang detail THÂN THIỆN kiểu listing
  (hero+feature graphic+icon, screenshots, mô tả ngắn/đầy đủ, có gì mới, design preview, legal, chỗ dành sẵn
  Tải APK); `/manage-apps` = QUẢN LÝ (admin) — list đầy đủ + ẩn/hiện + detail file-browser blueprint như cũ.
- Nav non-admin chỉ Apps + Yêu cầu; route nội bộ có `RequireAdmin` đá về /apps.
- **make_app done → trả appCode:** admin bấm Done nhập appCode → `requests.result.app_code`; user thấy ở "Yêu
  cầu của tôi", admin thấy `→ code`.

**Discord notify (0022) — ĐÃ LÀM, thay Edge Function bằng pg_net+Vault:** trigger AFTER INSERT trên `requests`
→ `net.http_post` (pg_net) → Discord. Webhook URL trong **Supabase Vault** (secret `discord_requests_webhook`),
nạp OUT-OF-BAND (không trong migration, không commit, không lộ browser). Function đọc secret lúc chạy; chưa cấu
hình → bỏ qua êm. Portable: logic+secret ở DB dùng chung, mọi máy như nhau. **Đổi/nạp webhook trên máy khác:**
`select vault.create_secret('<url>','discord_requests_webhook')` (hoặc `vault.update_secret(id,…)` nếu đã có) —
KHÔNG viết URL vào git. Đã verify: net response status 204.

**Còn để phase sau:** RBAC per-capability (JWT hook + authz.has) · worker map request_code→CLI ·
đọc/duyệt chi tiết payload+file đính kèm phía AF · timeline request_events trên UI.

## Phase ✅ — blueprint → Storage (v4.7.0)
Bytes blueprint sống ở bucket private `blueprints` (key `<run_name>/<path>`); `blueprint_files` chỉ giữ
metadata (`storage_key`+`sha256`). af_db push→Storage-only, pull Storage+fallback base64, lệnh
`blueprint-migrate-storage`. AFC đọc qua signed URL (`queries.resolveContent`). Backfill 2283 file verify sạch.
**Còn lại:** drop `content_b64` (chờ deploy AFC + user chốt) → reclaim ~500MB.

## Phase ⏳ — RBAC (0018)
**Hiện trạng cần biết:** auth ĐÃ CÓ (`app_users` role admin/member, first-user→admin, Supabase Auth email/pass).
RLS mọi bảng nghiệp vụ đang `using(is_active_user())` = **mọi user active toàn quyền CRUD tất cả**; chỉ
app_users/app_settings admin-only; secrets (`stores`,`store_crypto_config`) khoá service_role. ⇒ retrofit RLS
per-capability là **60–70% khối lượng** của cả dự án.

**Model:**
```
app_users(id=auth.uid, ...)  roles  permissions  role_permissions(N-N)  user_roles(N-N, đa role/user)
```
- Permission = chuỗi capability: `blueprint.read`, `product_code.read`, `ads_script.edit`, `request.create.<type>`,
  `request.approve`, `user.manage`, `stores.read`…
- Enforce: **custom access-token hook** nhét `permissions` vào JWT → RLS đọc claim trực tiếp; helper
  `authz.has(perm)` để policy viết ngắn `using(authz.has('blueprint.read'))`.
- **Khuôn bảo mật để nhân rộng** (đã có sẵn): `stores` = REVOKE cột nhạy cảm + SECURITY DEFINER RPC + view an
  toàn; `store_crypto_config` deny-all. Mọi thứ nhạy cảm copy khuôn này.
- Retrofit: **đọc** gate theo capability; **ghi** phần lớn bảng vận hành → admin+service_role; vài bảng mở ghi
  cho role tương ứng (vd `ads_scenario_*` cho monet). *(Nhẹ đi vì v1 con người chủ yếu ĐỌC + đặt đơn — xem dưới.)*
- Siết RLS Storage bucket `blueprints` từ `authenticated` → `authz.has('blueprint.read')`.

Map role→permission (v1, ví dụ): `aso`→blueprint.read + request.create.update_aso · `dev`→product_code.read +
request.create.add_ads · `monet`→ads_script.read/edit · `admin`→tất cả + request.approve + user.manage + stores.read.

## Phase ⏳ — Requests queue
**Kiến trúc "khung MỘT lần, type NHIỀU lần":**
- **Khung bất biến** (làm 1 lần): `requests(id,type,requester,payload jsonb,status,target_app_code,run_id,result,...)`
  + `request_events` (append-only, timeline) + state machine + notify + RLS (insert-own/read-own; admin-all).
- **Mỗi type định nghĩa 5 seam:** `create-permission` · **input JSON-schema** (→ form) · validator · **exec-runbook**
  (map thẳng → lệnh CLI: add_ads↔ads.sh, clone_app↔clone.sh, update_aso↔aso) · result-contract (user thấy gì).
- **Payload phản chiếu flags CLI** ⇒ sau này thay worker-người bằng automation KHÔNG đổi schema.

**Semantics đã chốt:**
- State: `submitted → accepted → in_progress → done | rejected | failed`.
- User **KHÔNG sửa được đơn**; **xem được trạng thái**; **huỷ được khi CHƯA `in_progress`** (còn submitted/accepted).
- Thông báo admin đơn mới: **Discord** (Database Webhook INSERT → Edge Function → Discord webhook; webhook URL để ở
  Edge Function secret, KHÔNG vào DB). Báo end-user: trạng thái trong AFC.
- **Fork form:** type đầu dựng form tay → rút renderer chung → type sau thuần schema (vì sẽ nhiều type).

**V1 scope (đã chốt):** nhận đơn + **đọc cơ bản** (aso xem blueprint, dev xem product code). Monet sửa ads script
trực tiếp = phase sau. End-user = **NỘI BỘ invite-only** (khớp model admin bật/tắt signup sẵn có).

## Quyết định đã chốt (không bàn lại)
- End-user nội bộ, invite-only · thông báo Discord · blueprint ACL = Storage policy trực tiếp (signed URL).
- Requests: no-edit / status-visible / cancel-khi-chưa-in_progress · state machine 6 trạng thái · payload bám flags CLI.
- V1 = nhận đơn + đọc cơ bản; monet-edit sau.

## Còn phải bàn (decision backlog)
- Role tĩnh (seed) vs admin tự tạo role trong UI · scope đọc-tất-cả vs per-app cho ghi.
- Ma trận permission×role chính xác (là thứ 0018 enforce — chốt trước khi viết policy).
- Requests: idempotency chống trùng đơn · type nào làm ĐẦU TIÊN (reference impl) · quan hệ 1 request↔N run.
- Storage signed-URL: TTL, versioning blueprint khi re-push (hiện upsert, file cũ bị xoá khỏi blueprint vẫn linger).
- Audit log chung (ngoài request_events) · cách test RLS không tự khoá mình · phối hợp release repo af-console riêng.

## Con trỏ
Ground-truth khảo sát repo + tiến độ chi tiết: memory `project_afc_rbac_upgrade` (máy Claude) + RELEASE.md AF (v4.7.0).
