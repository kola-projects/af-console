# Handoff — Blueprint Web Viewer (cho AFC)

> **AFC = af-console** (SPA React trong `app-factory/af-console`). File này là **nguồn duy nhất** để AFC xây tính năng
> "xem blueprint trên web". Đọc xong file này là đủ để build — **KHÔNG cần đọc source AF (generator/instructions) hay
> toàn bộ codebase**. Viết cho AF **v3.3**: blueprint lưu **thẳng trong DB dạng base64** (bảng `blueprint_files`,
> migration 0005) — **KHÔNG dùng Supabase Storage/bucket**.

## 0. Nhiệm vụ
Xây trong AFC một **trình xem blueprint theo từng run**, hiển thị blueprint **y như đọc ở local**:
- **text** (`.md`) → render Markdown (kể cả **mermaid** + code block),
- **HTML mockup** (`design_previews/*.html`) → **render thành trang thật** (không xem raw source),
- **icon** (`app_icon.svg`) → hiển thị ảnh SVG,
- **ảnh mẫu** (`image_refs/*.png`) → gallery ảnh,
- **dữ liệu** (`local_data/*.json`, `api_specs/*`) → xem/JSON pretty.

## 1. Blueprint là gì & vì sao có (bối cảnh — không cần đọc AF)
Blueprint = **hồ sơ thiết kế + spec** dạng người-đọc-được của **một run** sinh/clone app (pipeline AF phase01→06 tạo ra).
Đây là phần **"product + spec"** để đội bảo trì/duyệt hiểu app **mà không lộ "why/how được sinh"** (các quyết định
`decisions`/`bugs`/`library_usages` nằm ở **bảng DB riêng**, KHÔNG ở blueprint). **Mỗi run một blueprint.**
Từ **v3.3**: blueprint **không còn đi kèm git repo của app** (đã gitignore) và **không nằm ở Storage** — nó lưu **trong
DB** (bảng `blueprint_files`), và **web (AFC) là cách con người đọc blueprint**. Đó là lý do tính năng này tồn tại.

## 2. Blueprint sống ở đâu (NGUỒN DỮ LIỆU — chỉ một bảng)
- Bảng **`blueprint_files`** (public schema, migration 0005). Cột:
  | cột | kiểu | ý nghĩa |
  |---|---|---|
  | `run_id` | bigint (FK runs.id) | run nào |
  | `run_name` | text | tên run (vd `Holy-20260721-234606`) — **lọc theo cột này** |
  | `path` | text | đường dẫn tương đối trong `blueprint/` (vd `design_previews/index.html`) |
  | `content_type` | text | `image/png` · `text/html` · `text/plain; charset=utf-8` · `application/json` · … |
  | `content_b64` | text | **base64 của bytes gốc** (mọi loại file — text lẫn nhị phân) |
  | `bytes` | int | kích thước gốc (byte) |
- Con trỏ ở bảng `runs`: **`runs.extra.blueprint_table = "blueprint_files"`** và **`runs.extra.blueprint_run = "<run_name>"`**
  nếu run đã push blueprint. Dùng để biết run nào **có** blueprint.
- Ghi bởi CLI **`af_db blueprint-push <run_name>`** ở cuối phase06 (base64 hoá từng file → insert). **Không có Storage, không bucket.**
- **RLS**: bảng đã bật RLS + policy `authenticated` (giống mọi bảng khác, migration 0002/0005) → **AFC (đăng nhập) đọc
  được ngay**, KHÔNG cần cấu hình policy Storage/bucket gì thêm.

## 3. Cấu trúc blueprint (mỗi `path` là gì · render kiểu gì)
| `path` | Loại | Nội dung | Render web |
|---|---|---|---|
| `task.md` | md | Yêu cầu app: 5 dòng config đầu + mô tả sản phẩm | Markdown |
| `implementation_spec.md` | md | `# UI` (Theme+palette, **Layout tree** từng màn), `# Core Logic`, `## Feature Flows`, `## Addendum — Library Resolution`, `## Addendum (khi code)` | Markdown (dài) |
| `design_system.md` | md | **Source of truth thiết kế** (v3.3): color tokens **light+dark**, typography/spacing/radius/elevation, **icon family**, spec component lõi | Markdown; *nice-to-have:* swatch màu từ hex |
| `navigation_map.md` | md | **Có ```mermaid flowchart** + bảng routes + hợp đồng overlay/utility | Markdown **+ mermaid** |
| `GENERATED.md` | md | Tóm tắt team-facing: run_id, version code_base/af, packageName/applicationId | Markdown |
| `design_previews/index.html` | html | Trang liên kết **mọi mockup màn** (link tương đối) | **Render trang** (iframe) |
| `design_previews/<screen>.html` | html | Mockup tĩnh từng màn | **Render trang** |
| `design_previews/app_icon.svg` | svg | Icon app | Ảnh SVG |
| `image_refs/*.png` | png | **Ảnh chụp thật** app gốc/tham chiếu | Gallery ảnh |
| `local_data/*.json` | json | Dữ liệu bundle (**có thể ~1MB → base64 ~1.5MB/row**) | JSON pretty / lazy |
| `api_specs/*` | text/json | API spec (nếu có) | Text/JSON |

Ưu tiên: `task.md`, `implementation_spec.md`, `design_system.md`, `navigation_map.md`, `design_previews/`, `image_refs/`.
`local_data`/`api_specs` phụ.

## 4. Cái người dùng cần khi xem trên web (yêu cầu sản phẩm)
- **Đọc y như local**: markdown render (mermaid, code, bảng); **HTML mockup render thành trang thật**; ảnh screenshot
  xem được; SVG icon hiển thị; JSON đọc được. **Không** bắt người dùng đọc raw base64/source.
- **Điều hướng theo run**: ở `runs/:id` thêm tab **"Blueprint"** → cây/list `path` bên trái, nội dung render bên phải
  (hoặc nhóm Docs + gallery Mockups + gallery Screenshots + Data). Chỉ hiện tab khi run có `extra.blueprint_run`
  (không có → empty state "Run này chưa push blueprint").

## 5. Tích hợp vào AFC (điểm cắm chính xác)
- Stack: Vite+React+TS · `@supabase/supabase-js` (`src/lib/supabase.ts`) · react-query (`src/lib/queries.ts`) ·
  react-router (`src/App.tsx`). Auth: Supabase Auth; **publishable key**; quyền do **RLS**.
- **Nơi thêm UI**: `src/routes/RunDetail.tsx` (route `runs/:id`) — tab **Blueprint**. Query helper mới ở `src/lib/queries.ts`.
- **Truy cập dữ liệu (chỉ query bảng, KHÔNG Storage):**
  - Cây file (nhẹ, KHÔNG kéo content): `supabase.from('blueprint_files').select('path,content_type,bytes').eq('run_name', runName).order('path')`.
  - Nội dung 1 file (khi click, **lazy**): `supabase.from('blueprint_files').select('content_b64,content_type').eq('run_name', runName).eq('path', path).single()`.
  - **Đừng** select `content_b64` cho cả danh sách (mỗi ảnh/JSON tới ~1.5MB base64) — chỉ fetch content khi mở file đó.
- Không cần thêm migration/policy nào ở AFC: RLS `authenticated` đã có (0005).

## 6. Decode & rendering (GOTCHAS — đọc kỹ)
1. **Decode base64 đúng cho cả text lẫn binary:**
   - Bytes: `const bytes = Uint8Array.from(atob(content_b64), c => c.charCodeAt(0))`.
   - **Text (UTF-8, kể cả Ả-Rập/RTL):** `new TextDecoder('utf-8').decode(bytes)` — **KHÔNG** dùng `atob()` trực tiếp làm chuỗi (atob trả Latin-1 → hỏng UTF-8).
   - **Ảnh / mọi binary:** tạo `Blob([bytes], {type: content_type})` → `URL.createObjectURL(blob)` cho `<img src>` / `<iframe src>` (hoặc data URL `data:${content_type};base64,${content_b64}`).
2. **Mermaid**: `navigation_map.md` (và có thể `implementation_spec.md`) chứa ```mermaid → render bằng lib mermaid.
3. **HTML mockup link tương đối**: `design_previews/index.html` trỏ **tương đối** tới `<screen>.html` và `app_icon.svg`.
   Vì mỗi file là 1 row (không có server tĩnh), phải: (a) build **map `path` → objectURL/dataURL** cho toàn bộ
   `design_previews/*`, (b) trong HTML của `index.html`, **thay mọi `href`/`src` tương đối** bằng URL tương ứng trong map,
   rồi (c) nạp qua `iframe srcdoc` có `sandbox`. Tương tự khi mở từng `<screen>.html`.
4. **Kích thước**: một số row (JSON ~1MB, ảnh onboarding ~1.3MB) → base64 ~1.5MB. Lazy-load per-file; JSON viewer collapsible.
5. **Loại render**: quyết định **theo đuôi `path`** (hoặc `content_type`): `.md`→markdown; `.html`→iframe; `.svg`/`.png/.jpg/.webp`→ảnh; `.json`→pretty; còn lại→text.
6. **Sandbox** iframe khi render mockup (HTML tĩnh của pipeline, vẫn nên `sandbox`).

## 7. "Done" là gì
- Ở `runs/:id` → tab **Blueprint**: cây/list file; click → render **đúng loại** (md rendered + mermaid · html mockup
  render thành trang · svg/png ảnh · json pretty); có **gallery ảnh screenshot** và **gallery mockup**. Không xem raw base64.
- Chỉ run có `extra.blueprint_run` mới bật tab (còn lại: empty state). Không cần đọc thêm tài liệu AF nào khác.

## 8. Tham chiếu nhanh (KHÔNG bắt buộc đọc)
- Schema: `db/migrations/0005_blueprint.sql` (bảng `blueprint_files` + RLS).
- Cách push: `tools/af_db.sh` hàm `cmd_blueprint_push` (base64 từng file → insert, ghi `runs.extra.blueprint_table`/`blueprint_run`).
- Bước đóng run gọi push: `instructions/workflow/phase06_verify_build.md` (§ Ghi-sau + ĐÓNG RUN).
