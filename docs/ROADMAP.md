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
0018  RBAC foundation + RLS retrofit ............ ⏳ NEXT (phase nặng nhất)
──    drop content_b64 + VACUUM ................. ⏳ sau khi AFC đọc-Storage chạy ổn (user chốt thời điểm)
0019+ Requests queue ........................... ⏳ sau RBAC
```
Ràng buộc: RBAC (0018) phải xong **trước khi mở tài khoản non-admin thật** (nếu không họ toàn quyền CRUD).

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
