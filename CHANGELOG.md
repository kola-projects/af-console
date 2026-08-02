# Changelog — af-console (AFC)

Version của AFC đồng bộ theo version framework AF (bắt đầu gắn từ 3.8.0).
Luật release note (theo `app-factory/RELEASE.md`): chỉ THÊM mục mới, không sửa/đổi tên mục cũ.

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
