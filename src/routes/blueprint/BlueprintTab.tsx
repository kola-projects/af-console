import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { blueprintFile, blueprintFiles } from '../../lib/queries'
import {
  GROUP_LABEL,
  GROUP_ORDER,
  b64ToText,
  baseName,
  groupOf,
  renderKindOf,
  sortInGroup,
  type Group,
} from '../../lib/blueprint'
import type { BlueprintFileMeta } from '../../lib/types'
import { Empty, ErrorBox, Loading } from '../../components/ui'
import MarkdownView from './MarkdownView'
import HtmlMockupView from './HtmlMockupView'
import AdZonesView from './AdZonesView'
import { ImageView, JsonView, TextView } from './viewers'

/** Tab Blueprint: sidebar nhóm theo loại (Docs/Mockups/Screenshots/Data) + pane render.
 *  Danh sách file nhẹ; content chỉ tải khi mở từng file (lazy). */
export default function BlueprintTab({
  runName,
  allowGroups,
}: {
  runName: string
  /** Giới hạn nhóm hiển thị (vd trang sản phẩm: chỉ aso/mockups/legal). Bỏ trống = tất cả.
   *  Đây chỉ là dọn giao diện; chặn THẬT do RLS 0023 (non-admin không đọc được nhóm khác). */
  allowGroups?: Group[]
}) {
  const files = useQuery({
    queryKey: ['blueprint', runName],
    queryFn: () => blueprintFiles(runName),
  })
  const [selected, setSelected] = useState<string | null>(null)
  const order = useMemo(
    () => (allowGroups ? GROUP_ORDER.filter((g) => allowGroups.includes(g)) : GROUP_ORDER),
    [allowGroups],
  )

  // Nhóm + sắp xếp một lần khi có danh sách.
  const groups = useMemo(() => {
    const map: Record<Group, BlueprintFileMeta[]> = { docs: [], aso: [], mockups: [], adzones: [], legal: [], screenshots: [], data: [] }
    for (const f of files.data ?? []) {
      const g = groupOf(f.path)
      if (!allowGroups || allowGroups.includes(g)) map[g].push(f)
    }
    for (const g of order) {
      const s = sortInGroup(map[g].map((f) => f.path), g)
      map[g].sort((a, b) => s.indexOf(a.path) - s.indexOf(b.path))
    }
    return map
  }, [files.data, allowGroups, order])

  // Mặc định mở file đầu tiên khi vào tab.
  useEffect(() => {
    if (!selected && files.data?.length) {
      const first = order.flatMap((g) => groups[g])[0]
      if (first) setSelected(first.path)
    }
  }, [files.data, groups, order, selected])

  if (files.isLoading) return <Loading />
  if (files.error) return <ErrorBox error={files.error} />
  if (!files.data?.length) return <Empty>Run này chưa push blueprint (bảng blueprint_files trống).</Empty>

  return (
    // Hai cột cao cố định theo viewport, mỗi cột tự cuộn — sidebar luôn thấy khi đọc doc dài.
    <div className="flex h-[calc(100dvh-11rem)] gap-5">
      <aside className="w-60 flex-none overflow-y-auto pr-1">
        {order.map((g) =>
          groups[g].length ? (
            <div key={g} className="mb-4">
              <div className="mb-1 px-1 text-[11px] tracking-wide text-neutral-400 uppercase">
                {GROUP_LABEL[g]}
              </div>
              {groups[g].map((f) => (
                <button
                  key={f.path}
                  onClick={() => setSelected(f.path)}
                  title={f.path}
                  className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-xs ${
                    selected === f.path
                      ? 'bg-primary-600 hover:bg-primary-700 text-white'
                      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                  }`}
                >
                  {baseName(f.path)}
                </button>
              ))}
            </div>
          ) : null,
        )}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto pr-1">
        {selected ? (
          <FileView runName={runName} path={selected} />
        ) : (
          <Empty>Chọn một file bên trái để xem.</Empty>
        )}
      </section>
    </div>
  )
}

/** Render một file theo loại. HTML tự fetch (cần cả thư mục design_previews để dựng link);
 *  loại khác fetch content lazy rồi đưa vào viewer tương ứng. */
function FileView({ runName, path }: { runName: string; path: string }) {
  const kind = renderKindOf(path)

  // adzones/* → editor kéo-thả (tự đọc cả thư mục adzones/); bỏ qua file JSON cụ thể được click.
  if (path.startsWith('adzones/')) return <AdZonesView runName={runName} />

  // HtmlMockupView tự lo query thư mục — không fetch single file ở đây.
  if (kind === 'html') return <HtmlMockupView runName={runName} path={path} />

  return <NonHtmlFile runName={runName} path={path} />
}

function NonHtmlFile({ runName, path }: { runName: string; path: string }) {
  const kind = renderKindOf(path)
  const file = useQuery({
    queryKey: ['blueprint-file', runName, path],
    queryFn: () => blueprintFile(runName, path),
  })

  if (file.isLoading) return <Loading />
  if (file.error) return <ErrorBox error={file.error} />
  if (!file.data) return <Empty>Không đọc được file.</Empty>

  const { content_b64, content_type } = file.data
  switch (kind) {
    case 'md':
      return <MarkdownView text={b64ToText(content_b64)} />
    case 'image':
    case 'svg':
      return <ImageView b64={content_b64} contentType={content_type} alt={path} />
    case 'json':
      return <JsonView b64={content_b64} />
    default:
      return <TextView b64={content_b64} />
  }
}
