import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appIcon, appIconStorageUrl, detectPackageName } from '../lib/queries'
import { b64ToDataURL, mimeOf } from '../lib/blueprint'
import type { AppRow } from '../lib/types'
import { Mono } from './ui'

/** Helpers + component nhận diện app (icon, package) dùng chung Apps/AppDetail.
 *  Tách khỏi routes để tránh cảnh báo fast-refresh khi route export thêm hàm. */

/** Org GitHub của app (segment sau github.com/), null nếu không có git. */
export function appGitOrg(a: AppRow): string | null {
  const g = a.integration?.github
  if (typeof g !== 'string') return null
  const m = g.match(/github\.com[/:]([^/]+)\//)
  return m ? m[1] : null
}

/** App có repo nhưng KHÔNG thuộc org af-products → import ngoài pipeline, cần đánh dấu. */
export function isForeignRepo(a: AppRow): boolean {
  const org = appGitOrg(a)
  return !!org && org !== 'af-products'
}

/** Tên hiển thị gọn: app import từ git có apps.name = 'org/repo' → chỉ hiện phần repo
 *  (sau dấu '/' cuối). App qua pipeline đã có appName sạch nên giữ nguyên. */
export function appDisplayName(a: AppRow): string {
  const n = (a.name || '').trim()
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

/** Nhãn tên app: dấu '*' đỏ phía trước nếu repo không thuộc af-products (import ngoài),
 *  rồi tới tên hiển thị gọn. Tooltip nêu org thật + tên đầy đủ. */
export function AppNameLabel({ app }: { app: AppRow }) {
  const foreign = isForeignRepo(app)
  const org = appGitOrg(app)
  return (
    <span title={foreign ? `Repo ngoài af-products (org: ${org}) — ${app.name}` : app.name}>
      {foreign && (
        <span className="mr-0.5 font-bold text-red-500" aria-label={`repo ngoài af-products: ${org}`}>
          *
        </span>
      )}
      {appDisplayName(app)}
    </span>
  )
}

/** "Last update" của app KHÔNG có cột riêng trong DB — nó là thời điểm hoạt động
 *  gần nhất: max(started_at/finished_at) trên mọi run; app chưa run nào → created_at. */
export function appLastUpdate(a: AppRow): string {
  let max = a.created_at
  for (const r of a.runs) {
    if (r.started_at > max) max = r.started_at
    if (r.finished_at && r.finished_at > max) max = r.finished_at
  }
  return max
}

export const blueprintRuns = (a: AppRow) =>
  a.runs.filter((r) => typeof r.extra?.blueprint_run === 'string')

/** run_name blueprint MỚI NHẤT của app (runs đã order desc từ query) —
 *  nguồn cho icon lẫn package detect: bản gần nhất là bản đại diện. */
export function latestBlueprintRun(a: AppRow): string | null {
  const r = blueprintRuns(a)[0]
  return r ? String(r.extra!.blueprint_run) : null
}

/** run_name có ADZONES mới nhất. adzones CHỈ sinh ở run generate/clone — các run
 *  ads/aso/adsx/legal cũng set extra.blueprint_run nhưng KHÔNG có adzones (sẽ làm
 *  latestBlueprintRun trỏ vào run rỗng → Ads Builder trống). Dùng hàm này cho adzones. */
export function latestAdzonesRun(a: AppRow): string | null {
  const r = blueprintRuns(a).find((x) => x.job_kind === 'generate' || x.job_kind === 'clone')
  return r ? String(r.extra!.blueprint_run) : null
}

/** run_name của run GENERATE/CLONE — nơi build app + `design_previews/` (gồm navigation_map +
 *  screens). Dùng cho design preview / design.zip: aso/legal chạy SAU generate làm
 *  `latestBlueprintRun` trỏ vào snapshot của chúng (thiếu screens), nên đọc design từ run này. */
export const generateBlueprintRun = latestAdzonesRun

/** Icon app theo ƯU TIÊN: (1) icon golive từ Play (extra.icon_url — CDN công khai, hiện
 *  thẳng); (2) blueprint của run mới nhất (Storage); (3) icon trích từ code
 *  (extra.icon_storage_key — signed URL bucket private, chỉ admin); (4) ô chữ cái đầu.
 *  Blueprint lazy + cache vĩnh viễn theo run_name (bất biến sau khi push). */
export function AppIcon({ app, size = 32 }: { app: AppRow; size?: number }) {
  const storeIcon = app.extra?.icon_url || null
  const codeKey = app.extra?.icon_storage_key || null
  const [storeErr, setStoreErr] = useState(false)
  const useStore = !!storeIcon && !storeErr
  const runName = latestBlueprintRun(app)
  const q = useQuery({
    queryKey: ['app-icon', runName],
    queryFn: () => appIcon(runName!),
    enabled: !!runName && !useStore,
    staleTime: Infinity,
  })
  const useCode = !useStore && !q.data && !!codeKey
  const cq = useQuery({
    queryKey: ['app-icon-code', codeKey],
    queryFn: () => appIconStorageUrl(codeKey!),
    enabled: useCode,
    staleTime: 30 * 60 * 1000,
  })
  const imgCls = 'rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-800'
  if (useStore) {
    return (
      <img
        src={storeIcon!}
        width={size}
        height={size}
        alt=""
        title="Icon từ Play (golive)"
        referrerPolicy="no-referrer"
        onError={() => setStoreErr(true)}
        className={imgCls}
        style={{ width: size, height: size }}
      />
    )
  }
  if (q.data) {
    return (
      <img
        src={b64ToDataURL(q.data.content_b64, mimeOf(q.data.path, q.data.content_type))}
        width={size}
        height={size}
        alt=""
        className={imgCls}
        style={{ width: size, height: size }}
      />
    )
  }
  if (cq.data) {
    return (
      <img
        src={cq.data}
        width={size}
        height={size}
        alt=""
        title="Icon trích từ code repo"
        className={imgCls}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="flex flex-none items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {appDisplayName(app).charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Package name: cột apps.package_name nếu có; trống thì DETECT từ order.md (cũ: task.md) của
 *  blueprint mới nhất (chấm vàng = giá trị detect, không phải sổ cái). */
export function PackageName({ app }: { app: AppRow }) {
  const runName = latestBlueprintRun(app)
  const q = useQuery({
    queryKey: ['pkg-detect', runName],
    queryFn: () => detectPackageName(runName!),
    enabled: !app.package_name && !!runName,
    staleTime: Infinity,
  })
  if (app.package_name) return <Mono className="text-neutral-500">{app.package_name}</Mono>
  if (q.data)
    return (
      <span title="Detect từ order.md/task.md trong blueprint — apps.package_name đang trống">
        <Mono className="text-neutral-500">{q.data}</Mono>
        <span className="ml-1 align-middle text-[10px] text-amber-600 dark:text-amber-400">●</span>
      </span>
    )
  return <Mono className="text-neutral-400">—</Mono>
}
