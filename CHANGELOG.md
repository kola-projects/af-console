# Changelog — af-console (AFC)

Version của AFC đồng bộ theo version framework AF (bắt đầu gắn từ 3.8.0).
Luật release note (theo `app-factory/RELEASE.md`): chỉ THÊM mục mới, không sửa/đổi tên mục cũ.

## 3.28.0 — 2026-08-29 (đi cùng AF v5.19.0 / migration 0034)

**Trang quản lý Store `/stores` — CRUD đầy đủ.** Trước đây phải sửa DB tay để tạo/gán store.
- Route mới `/stores` (admin) + mục nav **Stores**. Bảng liệt kê store: mã (aNNN), tên/brand, slug, GitHub org, trạng
  thái PAT, số app, enabled.
- **Tạo / sửa / xoá store** (RLS authenticated): name, slug, `store_code` (nút **Cấp mã** gọi RPC `alloc_store_code`),
  display_name (brand), support_email, GitHub org (extra.github_org, dùng cho legal repo-per-app), github_repo (site
  Pages legacy), website/Play Console URL, enabled. Xoá chặn nếu store còn app liên kết.
- **GitHub PAT** (modal): set/clear qua RPC `set_/clear_store_github_credential` (mã hoá server-side, không đọc lại
  được). Ghi rõ PAT chỉ cần khi máy chạy legal/ASO KHÔNG có `gh` owner của org.
- Đọc từ view an toàn `v_stores` (không lộ ciphertext). `src/routes/Stores.tsx`, `src/lib/queries.ts` (+store CRUD).
- Yêu cầu **AF migration 0034** (grant `store_code` + RPC `alloc_store_code`).
- Dọn dead-code `AdZonesView.tsx` (hàm `cap` không dùng sau refactor) để build xanh.

## 3.27.2 — 2026-08-28

**AdZones editor: về tương tác zone-inline (theo ý người dùng) + Back touchable.**
- **Sơ đồ zone tương tác là MẶC ĐỊNH** lại (zone inline theo luồng màn, click-to-add hoặc kéo-thả) — thay vì ảnh-thật-với-drop-cards. Ảnh màn thật chuyển thành **nút toggle "🖼 xem ảnh màn thật"** (chỉ xem, tham khảo).
- **Danh sách Touchables luôn hiện** + thêm mục **synthetic "⬅ Back (thoát màn)"** cho mọi màn → gate được interstitial khi back (mẫu ad phổ biến). `AdZonesView.tsx`.

## 3.27.1 — 2026-08-28

**AdZones image-mode: sạch, không che ảnh.** 3.27.0 phủ bar zone full-width lên ảnh ở vị trí đoán → che nội dung, xấu
(manifest không có toạ-độ pixel nên không overlay chính xác được). Sửa: **ảnh màn thật để NGUYÊN VẸN**, chỉ có **pin nhỏ ở
mép trái** gợi ý vị trí dọc theo archetype (không che), và **zone drop-cards** liệt kê gọn bên dưới ảnh để kéo/thả. `AdZonesView.tsx`.

## 3.27.0 — 2026-08-28 (đi cùng AF v5.14.0)

**AdZones editor: render ẢNH MÀN THẬT thay mockup cứng.** Trước đây mọi màn hiện chung một mockup Home (Settings vẫn
ra balance card + feed → sai). Giờ editor đọc `manifest.screenshot` (adzones.py khớp ảnh trong blueprint:
design_previews/screens → clone_shots → image_refs; home theo layout classic/midnight/paper) và **render đúng ảnh màn
đó** (qua `blueprintFile`→data-URL), **phủ zone** lên theo archetype (below-header/content-flow/in-feed/scaffold-dock —
neo dọc gần đúng). Màn chưa có ảnh → fallback mockup cũ. `AdScreenEditor` nhận thêm `runName` để tải ảnh.

## 3.26.1 — 2026-08-28

**AdZones editor: mục "Touchables" tường minh.** Trước đây touchable chỉ hiện dạng tile trong phone → khó thấy/thiếu.
Thêm section **"Touchables · bấm để gắn adsEvent"** dưới phone, liệt kê MỌI touchable của màn (chip rõ ràng, badge
INT/RW, empty-state khi matcher chưa dò được). Đi cùng AF v5.13.1 (adzones.py: màn không-đổi-theo-layout gán
`layout=default` → hiện ở mọi layout; dò touchable mạnh hơn — bắt cả `onClick={}`). `AdZonesView.tsx`.

## 3.26.0 — 2026-08-28 (đi cùng AF v5.13.0)

**Ads Builder — menu riêng, wizard soạn ad-contract đầy đủ.** Không chỉ editor trong tab blueprint nữa.

- Menu trái mới **"Ads Builder"** (admin) · route `/ads-builder` · `AdsBuilder.tsx`.
- Landing = **list plan đã lưu** (bảng `ad_plans`, migration 0033) — mở/sửa/xoá.
- Wizard **5 bước**: App → template funnel BF (seed `bfTemplates.ts`) → style/layout → ads Home-onward
  (editor phone-in-context per màn) → Lưu (nháp | sẵn-sàng) + xem trước JSON.
- `AdZonesView`: tách **`AdScreenEditor`** (controlled) để wizard dùng lại chung editor một màn.
- queries `adPlans/adPlan/saveAdPlan/deleteAdPlan` + type `AdPlan/AdPlanBody`. RLS admin-only.

## 3.25.1 — 2026-08-28

**AdZones editor: phone-in-context.** Thay danh sách zone phẳng bằng **phone mockup thật** — zone chèn đúng vị trí
ngữ cảnh (below-header dưới tiêu đề · content-flow trước feed · in-feed giữa các dòng giao dịch · scaffold-dock trên
nav-bar), thẻ balance gradient + tiles (touchables) + nav-bar trang trí. Kéo-thả/gắn event/kiểm policy giữ nguyên;
chỉ nâng diện mạo cho khớp bản PoC (không còn "đơn điệu"). `AdZonesView.tsx`.

## 3.25.0 — 2026-08-28 (đi cùng AF v5.12.0)

**AdZones — editor kéo-thả ads trong tab Blueprint.** Đọc artifact mới `blueprint/adzones/` (schema `adzone/1`, do
`tools/adzones.py` sinh lúc build) và render editor thay cho JSON thô.

- Group blueprint mới **`adzones/`** ("Ad zones") ở `src/lib/blueprint.ts` (`groupOf`/`GROUP_LABEL`/`GROUP_ORDER`);
  admin-only (không vào `PRODUCT_GROUPS` → không cần nới RLS).
- Viewer mới `src/routes/blueprint/AdZonesView.tsx`: **bước 1** bắt chọn **style + layout** (zone bám layout, không phục
  vụ mọi biến thể trong một canvas) → **bước 2** canvas kéo-thả native/banner vào zone hữu hạn + gắn adsEvent
  Interstitial/Rewarded lên touchable, **kiểm policy tại chỗ** (inter trên micro-interaction → chặn; rewarded thiếu
  value-gate → chặn; cap<15s → cảnh báo; tên trùng → chặn), xuất `ad-plan` JSON + validation tổng.
- `BlueprintTab.tsx`: route file `adzones/*` → `AdZonesView` (tự đọc cả thư mục qua `blueprintDir`).
- Chỉ đọc + soạn plan client-side (chưa persist plan / chưa sinh code). Xem `instructions/adzones.md`.

## 3.24.10 — 2026-08-26 (đi cùng AF v5.10.0)

**Design preview → STORYBOARD đồng bộ.** Trang chi tiết app (`/apps/:id`) nâng section "Design preview":
- **Màn hình (storyboard)**: ảnh THẬT từ `design_previews/screens/*` xếp theo THỨ TỰ (prefix số), tỉ lệ phone,
  **click phóng to** (lightbox) — PM xem toàn bộ thiết kế app đã build, khỏi cài.
- **Design assets** (icon/ornament) tách lưới riêng; nút "Xem mockup đầy đủ" (`index.html`) giữ nguyên.
- Không đổi DB/query — đọc `designImages` sẵn có, tách theo path `/screens/`. Ăn cho MỌI app đã `blueprint-push`
  (gồm 29 app cũ vừa backfill + clone source-modify).

## 3.24.9 — 2026-08-26

**Đơn Ads integration: BẮT BUỘC đính kèm link ads script (Google Sheet ad-contract).**
- Form `add_ads` thêm field **Link ads script** (bắt buộc) + **thông báo** phải đặt “Anyone with the link · Viewer”.
- Chặn gửi (stop) nếu: thiếu link · link không phải Google Sheet/Drive.
- Kiểm quyền xem THẬT ở lúc chạy: ads.sh tải CSV export của sheet — link private ⇒ không tải được ⇒ đơn **dừng**
  (AF v5.8.0). AFC chỉ chặn định dạng + thông báo (trình duyệt không tự kiểm chứng quyền xem do CORS).
- Payload đơn thêm `ads_script`. PATCH, không đổi DB (payload là jsonb tự do).

## 3.24.8 — 2026-08-24 (đi cùng AF v5.4.1)

**Click cả HÀNG mở trang chi tiết app** (đỡ phải tìm trong AFC) — cho mọi user (admin lẫn non-admin):
- `/apps`: click hàng → `/apps/:id` (trang danh mục sản phẩm của app).
- `/manage-apps` (admin): click hàng → `/manage-apps/:id`; control con (ô chọn Team, nút Ẩn/Hiện) `stopPropagation` để không điều hướng nhầm.
- `/requests` (Yêu cầu — cả "Đơn của tôi" lẫn admin): click hàng đơn hàng → trang chi tiết app tương ứng
  (`/apps/:id`), map `target_app_code`/`result.app_code` → app id qua danh mục app (`app_code` + `app_codes[]` cũ);
  đơn chưa có app thì hàng không click. Nút Huỷ/Hành động `stopPropagation`.
- `ui.Row` thêm prop `onClick`/`className` (cursor-pointer + role=link + phím Enter/Space) — tương thích ngược.
- PATCH, không đổi API/DB.

## 3.24.7 — 2026-08-21 (đi cùng AF v5.3.4 · DB schema_version=28)

**Mã request 4 ký tự** (AF migration 0028): mã đơn giờ `<m|a|s>+3 base36` (vd `m003`) thay cho `rNNNNN`.
AFC hiển thị mã do RPC trả về (không cần đổi logic); chỉ sửa chú thích. Tin Discord kèm dòng
`Chạy trên AF: ./order.sh <mã>`.

## 3.24.6 — 2026-08-21 (đi cùng AF v5.3.3 · DB schema_version=27)

**Team app** (AF migration 0027 `apps.team`): 
- `/manage-apps`: cột **Team** với ô chọn (admin gán Auto/Titan/—) + bộ lọc theo team.
- `/apps` (danh mục sản phẩm): cột Team (badge, read-only) + bộ lọc theo team.
- Chỉ là nhãn thống kê — KHÔNG đụng GitHub (AF lo cấp quyền GitHub team lúc auto-push; xem AF v5.3.3).

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
