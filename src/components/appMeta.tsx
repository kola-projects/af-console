import { useQuery } from '@tanstack/react-query'
import { appIcon, detectPackageName } from '../lib/queries'
import { b64ToDataURL, mimeOf } from '../lib/blueprint'
import type { AppRow } from '../lib/types'
import { Mono } from './ui'

/** Helpers + component nhận diện app (icon, package) dùng chung Apps/AppDetail.
 *  Tách khỏi routes để tránh cảnh báo fast-refresh khi route export thêm hàm. */

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

/** Icon app từ blueprint của run mới nhất; app chưa có blueprint → ô chữ cái đầu.
 *  Lazy + cache vĩnh viễn theo run_name (blueprint bất biến sau khi push). */
export function AppIcon({ app, size = 32 }: { app: AppRow; size?: number }) {
  const runName = latestBlueprintRun(app)
  const q = useQuery({
    queryKey: ['app-icon', runName],
    queryFn: () => appIcon(runName!),
    enabled: !!runName,
    staleTime: Infinity,
  })
  if (q.data) {
    return (
      <img
        src={b64ToDataURL(q.data.content_b64, mimeOf(q.data.path, q.data.content_type))}
        width={size}
        height={size}
        alt=""
        className="rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-800"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="flex flex-none items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {app.name.trim().charAt(0).toUpperCase() || '?'}
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
