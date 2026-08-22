# Changelog — af-console (AFC)

Version của AFC đồng bộ theo version framework AF (bắt đầu gắn từ 3.8.0).
Luật release note (theo `app-factory/RELEASE.md`): chỉ THÊM mục mới, không sửa/đổi tên mục cũ.

## 3.24.5 — 2026-08-21 (đi cùng AF v5.3.2 · DB schema_version=26)

- **Admin đổi mật khẩu user:** trang Users thêm nút "Đổi MK" cho user khác → modal đặt mật khẩu mới (RPC
  `admin_set_user_password`, SECURITY DEFINER + pgcrypto — AF migration 0025; không cần service_role).
- **Make app — bỏ 2 mode** `changeColorSystemAuto`/`changeStyleAuto` (không còn dùng); còn `changeLayoutAuto` +
  `changeFeatureExtremeAuto`.
- **Make app — tự nhận diện nguồn từ link:** bỏ dropdown src; nhập link → hiện nguồn (Google Play / App Store /
  GitHub / Figma). changeFeatureExtremeAuto chặn nếu link không phải Play/App Store.
- **Discord** (AF migration 0026): tin báo order mới kèm **full payload** (jsonb_pretty, cắt <2000).

## 3.24.4 — 2026-08-21 (đi cùng AF v5.3.1 · DB schema_version=24)

**Fix deploy:** cập nhật `pnpm-lock.yaml` cho `fflate` (thêm ở 3.24.3 bằng npm nên pnpm-lock lệch → Vercel
`pnpm install` fail, 3.24.3 KHÔNG lên production). 3.24.4 = 3.24.3 (nút Tải aso.zip) + lockfile khớp.

## 3.24.3 — 2026-08-21 (đi cùng AF v5.3.1 · DB schema_version=24)

**Tải aso.zip:** trang app detail `/apps/:id` thêm nút **📦 Tải aso.zip** — gói toàn bộ `blueprint/aso/`
(icon 512, feature graphic, screenshots, title/short/full description, release notes, policy…) thành zip client-side
(fflate) để nhân sự ASO submit lên store. Non-admin ASO tải được (aso/ trong whitelist RLS). Zip bỏ tiền tố `aso/`,
tên file `<appCode>-aso.zip`.

## 3.24.2 — 2026-08-21 (đi cùng AF v5.3.1 · DB schema_version=24)

**Fix:** trang Danh mục sản phẩm `/apps` giờ **lọc bỏ app đã ẩn cho MỌI người** (kể cả admin). Trước đó admin
vẫn thấy app ẩn ở `/apps` vì RLS cho admin đọc hết — nay lọc client-side. App ẩn chỉ còn ở `/manage-apps` (có
badge "ẩn" + nút Hiện). (Non-admin vốn đã không thấy do RLS.)

## 3.24.1 — 2026-08-21 (đi cùng AF v5.4.0 · DB schema_version=24)

**Align legal + whitelist appearance (AF migration 0024).**
- Trang sản phẩm đọc legal đúng shape thật: URL Privacy/Terms từ `legal/URLS.json` (`pages.privacy`/`pages.terms`),
  verdict từ `aso/legal_urls.json`.
- Form ASO đọc `blueprint/appearance/variants.json` (manifest biến thể AF v5.4.0) để dựng picker Layout×Style;
  RLS 0024 mở `appearance/` cho non-admin nên picker chạy cho cả role dev/ua/aso.

## 3.24.0 — 2026-08-21 (đi cùng AF v5.4.0 · DB schema_version=23)

**Cổng nhiều người dùng: tạo user + hàng đợi yêu cầu + phạm vi non-admin.** (AF migrations 0020–0023.)

- **Tạo người dùng (admin):** trang Users thêm form tạo user trực tiếp (email+mật khẩu+role) không cần
  service_role — qua `pending_invites` + client tạm `signUp` (không văng session admin). Role mới
  `dev`/`ua`/`aso` (ngoài admin); v1 mọi role non-admin quyền giống nhau (đọc + đặt yêu cầu). Ô chọn 4 role
  thay nút gạt, giữ chốt "không hạ/khoá admin cuối".
- **Đặt yêu cầu (`/requests`, mọi role):** 3 loại — Make app / Ads integration / ASO. Chọn bản AF (admin
  lock/unlock qua bảng `af_versions`, default = bản mở mới nhất). Make app: mode (bỏ generate), `-v`=3,
  changeFeature ép store/appstore, Team (Auto/Titan), **ASO bắt buộc**, **google-services.json bắt buộc**,
  upload ảnh/file tự do (bucket `request-uploads`). Ads: appCode + funnel/ads. ASO: appCode → picker Layout×Style
  độc lập (đọc `appearance/variants.json` nếu có, không thì nhập tay) + store/appVersion/releaseNote/onPhoneName.
  Mã đơn `rNNNNN` (AF chạy theo mã). User xem/huỷ (khi chưa in_progress); admin xem tất cả + đổi trạng thái + reject;
  make_app done → trả `appCode`.
- **Báo Discord order mới:** trigger DB `pg_net` → Discord, webhook trong Supabase Vault (không lộ browser).
- **RBAC coarse:** non-admin chỉ ĐỌC business tables + đặt đơn; ghi = admin. Bảng nội bộ (runs/lessons/bugs/
  libraries/tags/ads) khoá đọc về admin; view nội bộ `security_invoker`.
- **Tách 2 trang App:** `/apps` = **danh mục sản phẩm** (mọi user) với trang detail **thân thiện** (hero+feature
  graphic+icon, screenshots, mô tả, "có gì mới", design preview, legal, chỗ dành sẵn Tải APK) — chỉ đọc blueprint
  whitelisted (`aso/`+`design_previews/`+`legal/`). `/manage-apps` = **quản lý** (admin) với detail file-browser
  blueprint đầy đủ + **ẩn/hiện app** (`apps.is_hidden`). Nav non-admin chỉ Apps + Yêu cầu.

## 3.23.1 — 2026-08-17 (đi cùng AF v4.7.0 · DB schema_version=17)

**Blueprint đọc từ Storage (AF v4.7.0):** bytes blueprint đã dời sang Supabase Storage (bucket `blueprints`),
`blueprint_files` chỉ còn metadata. `queries.resolveContent()` chuẩn hoá mọi row về shape `{path,content_type,
content_b64}` — content_b64 lấy từ DB (row cũ) hoặc **tải Storage qua signed URL** (`createSignedUrl` 120s) rồi
encode base64 (`blueprint.bytesToB64`). Mọi viewer (BlueprintTab/HtmlMockup/appIcon/detectPackageName) KHÔNG đổi.

**App code trên UI (AF v4.6.0):** trang Apps + AppDetail hiện **mã app 3 ký tự** (`appCodeOf`) — badge cạnh tên,
tìm kiếm + sắp xếp theo `code`.

**Docs:** thêm `docs/ROADMAP.md` — bản thiết kế bền cho nâng cấp AFC đa người dùng (RBAC + Storage + Requests).

## 3.22.0 — 2026-08-02 (đi cùng AF v3.22 · DB schema_version=13)

**Ads scenario definition:** catalog lưu `definition` jsonb (scenario.json đầy đủ). Trang
`/ads/scenarios/:id/:version` và `/ads/apps/:app` render screens/slots/flow/placements/gates/verify —
không còn chỉ counts. Usage history query lọc server-side theo app/scenario.

## 3.21.0 — 2026-08-02 (đi cùng AF v3.21 · DB schema_version=12)

**Tab Ads** (`/ads`, `/ads/apps/:app`, `/ads/scenarios/:id/:version`):
- Danh sách app đã gắn kịch bản (view `v_ads_scenario_by_app`) — scenario/profile/lib/outcome mới nhất.
- Lịch sử usage theo app (`v_ads_scenario_usage_history`) kèm pin AF / code_base / lib / content_sha,
  snapshot summary lúc ghi, so catalog hiện tại, deltas/notes.
- Catalog scenario@version (`ads_scenario_versions`) + profile matrix (`v_ads_profile_matrix`).
- `Run.job_kind` bổ sung `legal` | `ads`.

Chi tiết phía framework: `app-factory/RELEASE.md` § v3.21.

## 3.17.0 — 2026-08-01 (console-only; AF 3.9→3.17 không có thay đổi AFC nên nhảy thẳng từ 3.8.0)

**Trang "Apps" (`/apps`)** — lối vào theo APP thay vì theo run (một app sinh nhiều lần thì tìm
blueprint qua danh sách run rất khó):
- Danh sách mọi app với ô tìm kiếm (tên/package) + sắp xếp theo **last update** (mặc định) /
  **thời điểm tạo** / **tên**. "Last update" suy từ run gần nhất (không có cột riêng trong DB).
- Cột Blueprints = số run đã push blueprint (con trỏ `runs.extra.blueprint_run` sẵn có).
- **Chi tiết app (`/apps/:id`)**: mọi run (link sang `/runs/:id`), danh sách blueprint (link mở
  thẳng tab Blueprint), **lessons quá khứ đã áp vào app** (gom `v_run_learning` cross-run, một
  lesson bơm vào N run hiện MỘT dòng với N phán quyết) và **lessons app sinh ra mới**
  (observation `first_seen`).
- `RunDetail` nhận `?tab=blueprint|learning` để deep-link từ trang Apps.
- **KHÔNG cần migration** — toàn bộ đọc từ bảng/view sẵn có (`apps`, `runs` embed,
  `v_run_learning` 0006, `lesson_observations`, `blueprint_files` qua tab run).

## 3.8.0 — 2026-07-26 (đi cùng AF v3.8 · Learning Loop v0 · DB schema_version=6)

**Tab "Learning" trong RunDetail** (`/runs/:id`) — hậu kiểm vòng học của từng run:
- Bảng lessons đã bơm vào run (đọc view **`v_run_learning`**, migration 0006) với badge disposition:
  `applied` (xanh) / `contradicted` (đỏ) / `not relevant` (xám) / **`MISSING` (vàng — run chưa qua được
  `run-finish`)**, kèm banner cảnh báo khi còn lesson chưa định đoạt.
- Section "Lesson mới sinh từ run này" (observation `first_seen`, embed lessons).
- Console CHỈ hiển thị — disposition là việc của agent qua CLI (`af_db insert lesson_observations`),
  cùng nguyên tắc phân quyền với graduate (web quyết định, CLI thực thi).

Kèm theo (không cần sửa code — tự sáng đèn khi pipeline v3.8 ghi dữ liệu):
- 4 ô KPI học tập ở Dashboard (`retrievals`/`lesson_observations`) hết cảnh "toàn số 0".
- `v_lesson_dead` (Lessons → tab dead) bắt đầu có ý nghĩa khi retrievals tích luỹ.

Chi tiết cơ chế phía framework: `app-factory/RELEASE.md` § v3.8.

## 1.0.0 → 1.0.3 — 2026-07 (dòng version trước khi đồng bộ AF)

Đã phát hành qua release script (`scripts/release.mjs`, tag `vX.Y.Z` → GitHub Action deploy Vercel):
hạ tầng versioning + deploy Vercel (v1.0.0/v1.0.1), version-check UI ở Login/Shell, đổi mật khẩu
user (Users tab), MIME/base64 cho blueprint viewer, pnpm workflow (v1.0.2), fix env Vercel (v1.0.3).
**3.8.0 nhảy semver từ 1.0.3 là CHỦ ĐÍCH** — từ mốc này version AFC đồng bộ theo version AF.

## Trước 1.0.0

Các mốc chính nằm trong lịch sử git: dựng SPA (Vite/React/TS + supabase-js, RLS + publishable key),
trang Lessons với cổng duyệt graduate, Runs/RunDetail (Timeline), Bugs/Libraries/Tags/Users,
Blueprint web viewer (bảng `blueprint_files`).

## Ghi chú xoá tag (luật release note: xoá tag phải ghi lại)

- **`v3.8` (AFC) — ĐÃ XOÁ 2026-07-26**: tag đẩy nhầm trong lần push bị reject (trỏ commit tiền-rebase
  mồ côi `81ebde3`, thiếu các fix 1.0.x). Bản thay thế chính thức: **`v3.8.0` @ `a634b66`**.
