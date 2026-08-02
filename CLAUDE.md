# CLAUDE.md — af-console (AFC)

Web dashboard của App-Factory (Vite/React/TS + Supabase). Repo độc lập, nằm trong thư mục
`af-console/` của repo AF (gitignored từ phía AF). Luật chung (identity git, tiếng Việt,
release note chỉ-thêm-không-sửa) kế thừa từ `app-factory/CLAUDE.md`.

## Versioning
- Version AFC **đồng bộ theo version framework AF** (từ mốc 3.8.0). Đuôi patch là của riêng AFC.
- Mỗi lần đổi version: **thêm mục mới vào `CHANGELOG.md` trong CÙNG commit** — không sửa/đổi tên mục cũ.

## 🚀 "push and release" — quy trình chuẩn (khi được bảo "push và release" là làm đúng thế này)
1. **Commit hết thay đổi** trên `main` (message tiếng Việt + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`),
   kèm mục CHANGELOG cho version sắp phát hành. Tree phải sạch, không chậm so với `origin/main`.
2. **Chọn một trong hai nhánh:**
   - **Bump thường** (mặc định khi không nói gì thêm → `patch`):
     ```bash
     npm run release:patch   # hoặc release:minor / release:major
     ```
     Script `scripts/release.mjs` tự: `pnpm version <bump>` (sửa package.json + commit `release: vX.Y.Z`
     + annotated tag) → `git push origin main --follow-tags`.
   - **Nhảy mốc đồng bộ AF** (vd 3.8.0 → 3.17.0 — semver bump không với tới): đặt tay `version`
     trong `package.json`, commit cùng CHANGELOG, rồi làm phần việc còn lại của script:
     ```bash
     git tag -a vX.Y.0 -m "release: vX.Y.0"
     git push origin main --follow-tags
     ```
3. **Deploy tự động**: push tag `v*.*.*` → GitHub Action **"Deploy tag"** (`.github/workflows/deploy-tag.yml`)
   build trên Vercel (env `VITE_*` lấy từ dashboard Vercel) → Production.
4. **Verify — bắt buộc, không bỏ**:
   ```bash
   gh run watch $(gh run list --repo kola-projects/af-console --limit 1 --json databaseId -q '.[0].databaseId') --repo kola-projects/af-console --exit-status
   ```
   rồi mở https://af-console.vercel.app/ — màn login phải hiện `Version: X.Y.Z · ✓ Đang dùng phiên bản mới nhất`
   (badge so version với package.json trên GitHub, nên push xong mới xanh).

Ghi chú: script chặn sẵn các lỗi thường gặp (không ở `main`, tree bẩn, chậm remote) — gặp lỗi
của script thì sửa nguyên nhân, đừng lách bằng tag tay.

## Chạy local
`npm run dev --prefix af-console` từ repo AF (launch.json cổng 5273), env ở `.env.local`.
Build check: `npm run build` (tsc + vite) · lint: `npm run lint` (oxlint).
