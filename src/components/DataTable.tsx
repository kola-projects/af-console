// [3.51.0] DataTable — bảng dùng chung có sắp xếp + chọn cột, cùng kiểu với Daily Widget của BBL Dashboard:
//   • bấm tiêu đề cột để sắp xếp (bấm lần nữa đảo chiều); giá trị trống luôn nằm cuối
//   • nút "Cột (n/m)": ẩn/hiện từng cột, đẩy cột lên/xuống để đổi thứ tự, "Mặc định" để trả về như ban đầu
//   • nút "Tải CSV": xuất đúng các cột đang hiện, đúng thứ tự đang xem
// Lựa chọn (cột ẩn, thứ tự, cột đang sắp) lưu ở localStorage theo `tableId` — mỗi người một kiểu xem riêng,
// mở lại trang vẫn còn. Bảng phân trang phía server thì truyền `sort` + `onSortChange` để server sắp xếp
// (sắp ở client trên một trang sẽ cho thứ tự sai).
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, SlidersHorizontal } from 'lucide-react'

export type SortDir = 'asc' | 'desc'
export type SortState = { id: string; dir: SortDir } | null
type Value = number | string | null | undefined

export type Column<T> = {
  id: string
  header: string
  align?: 'left' | 'right'
  cell: (row: T) => ReactNode
  /** Giá trị để sắp xếp. Bỏ trống = cột không sắp xếp được. */
  sortValue?: (row: T) => Value
  /** Giá trị xuất CSV; mặc định dùng sortValue. */
  csvValue?: (row: T) => Value
  /** Ẩn lúc đầu — người xem tự bật trong "Cột". */
  defaultHidden?: boolean
  /** Cột định danh: luôn hiện, không cho ẩn. */
  locked?: boolean
  className?: string
}

type Prefs = { order: string[]; hidden: string[]; sort: SortState }

function loadPrefs(tableId: string): Partial<Prefs> {
  try {
    const raw = window.localStorage.getItem(`afc.table.${tableId}`)
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {}
  } catch {
    return {}
  }
}

function savePrefs(tableId: string, p: Prefs) {
  try {
    window.localStorage.setItem(`afc.table.${tableId}`, JSON.stringify(p))
  } catch {
    /* localStorage bị chặn (chế độ riêng tư) — vẫn dùng được, chỉ không nhớ lựa chọn */
  }
}

function compare(a: Value, b: Value, dir: SortDir): number {
  const ea = a === null || a === undefined || a === ''
  const eb = b === null || b === undefined || b === ''
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1 // trống luôn nằm cuối, bất kể chiều
  const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'vi', { numeric: true })
  return dir === 'asc' ? r : -r
}

function toCsv(lines: Value[][]): string {
  const esc = (v: Value) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return lines.map((l) => l.map(esc).join(',')).join('\n')
}

export default function DataTable<T>({
  tableId,
  columns,
  rows,
  rowKey,
  defaultSort = null,
  sort: controlledSort,
  onSortChange,
  pinBottom,
  renderExpanded,
  canExpand,
  toolbar,
  csvName,
}: {
  /** Khoá lưu lựa chọn cột/sắp xếp — mỗi bảng một khoá riêng. */
  tableId: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  defaultSort?: SortState
  /** Sắp xếp phía server: truyền cặp này thì bảng không tự sắp, chỉ báo cột + chiều ra ngoài. */
  sort?: SortState
  onSortChange?: (s: SortState) => void
  /** Dòng tổng hợp (vd "chưa gán") luôn nằm cuối, không tham gia sắp xếp. */
  pinBottom?: (row: T) => boolean
  /** Bấm dòng để mở phần chi tiết ngay bên dưới. */
  renderExpanded?: (row: T) => ReactNode
  canExpand?: (row: T) => boolean
  /** Phần bên trái thanh công cụ (ô tìm kiếm, bộ lọc). */
  toolbar?: ReactNode
  /** Có tên file thì hiện nút "Tải CSV". */
  csvName?: string
}) {
  const manual = !!onSortChange
  const defaultOrder = useMemo(() => columns.map((c) => c.id), [columns])
  const defaultHidden = useMemo(() => columns.filter((c) => c.defaultHidden && !c.locked).map((c) => c.id), [columns])

  const [order, setOrder] = useState<string[]>(() => loadPrefs(tableId).order ?? defaultOrder)
  const [hidden, setHidden] = useState<string[]>(() => loadPrefs(tableId).hidden ?? defaultHidden)
  const [ownSort, setOwnSort] = useState<SortState>(() => {
    const s = loadPrefs(tableId).sort
    return s === undefined ? defaultSort : s
  })
  const [menu, setMenu] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const sort = manual ? controlledSort ?? null : ownSort
  useEffect(() => {
    savePrefs(tableId, { order, hidden, sort: manual ? null : ownSort })
  }, [tableId, order, hidden, ownSort, manual])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  // Thứ tự đã lưu + cột mới thêm sau này (chèn vào cuối); cột đã bỏ khỏi code thì tự rơi.
  const ordered = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]))
    const ids = [...order.filter((id) => byId.has(id)), ...defaultOrder.filter((id) => !order.includes(id))]
    return ids.map((id) => byId.get(id)!)
  }, [columns, order, defaultOrder])
  const visible = ordered.filter((c) => c.locked || !hidden.includes(c.id))

  const sorted = useMemo(() => {
    if (manual || !sort) return rows
    const col = columns.find((c) => c.id === sort.id)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    const pinned = pinBottom ? rows.filter(pinBottom) : []
    const free = pinBottom ? rows.filter((r) => !pinBottom(r)) : [...rows]
    free.sort((a, b) => compare(get(a), get(b), sort.dir))
    return [...free, ...pinned]
  }, [rows, columns, sort, manual, pinBottom])

  const clickHeader = (c: Column<T>) => {
    if (!c.sortValue) return
    const next: SortState =
      sort?.id === c.id ? { id: c.id, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { id: c.id, dir: c.align === 'right' ? 'desc' : 'asc' }
    if (manual) onSortChange!(next)
    else setOwnSort(next)
  }
  const toggle = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]))
  const move = (id: string, by: -1 | 1) => {
    const ids = ordered.map((c) => c.id)
    const i = ids.indexOf(id)
    const j = i + by
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setOrder(ids)
  }
  const reset = () => {
    setOrder(defaultOrder)
    setHidden(defaultHidden)
    if (manual) onSortChange!(defaultSort)
    else setOwnSort(defaultSort)
  }
  const download = () => {
    const lines: Value[][] = [visible.map((c) => c.header)]
    for (const r of sorted) lines.push(visible.map((c) => (c.csvValue ?? c.sortValue)?.(r)))
    const url = URL.createObjectURL(new Blob([`﻿${toCsv(lines)}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${csvName}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const tool =
    'inline-flex items-center gap-1.5 rounded border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900'
  const hideable = ordered.filter((c) => !c.locked).length
  const shown = visible.filter((c) => !c.locked).length

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="relative ml-auto" ref={menuRef}>
          <button className={tool} onClick={() => setMenu(!menu)} aria-expanded={menu}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Cột ({shown}/{hideable})
          </button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-950">
              <div className="mb-1 flex items-center px-1 text-xs text-neutral-500">
                <span className="mr-auto">Hiển thị cột</span>
                <button className="underline" onClick={() => setHidden([])}>Tất cả</button>
                <button className="ml-3 underline" onClick={reset}>Mặc định</button>
              </div>
              <ul className="max-h-80 overflow-y-auto">
                {ordered.map((c, i) => (
                  <li key={c.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900">
                    <input
                      type="checkbox"
                      id={`${tableId}-col-${c.id}`}
                      checked={c.locked || !hidden.includes(c.id)}
                      disabled={c.locked}
                      onChange={() => toggle(c.id)}
                    />
                    <label htmlFor={`${tableId}-col-${c.id}`} className={`min-w-0 flex-1 truncate ${c.locked ? 'text-neutral-500' : ''}`}>
                      {c.header || '(thao tác)'}
                    </label>
                    <button className="px-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 dark:hover:text-neutral-100" disabled={i === 0} onClick={() => move(c.id, -1)} aria-label={`Đưa cột ${c.header} lên`}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button className="px-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 dark:hover:text-neutral-100" disabled={i === ordered.length - 1} onClick={() => move(c.id, 1)} aria-label={`Đưa cột ${c.header} xuống`}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {csvName && (
          <button className={tool} onClick={download}>
            <Download className="h-3.5 w-3.5" />
            Tải CSV
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {/* Header có nền riêng + chữ đậm để tách khỏi phần dữ liệu; cột đang sắp xếp tô màu chủ đạo. */}
            <tr className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-100">
              {visible.map((c) => {
                const active = sort?.id === c.id
                const Icon = !active ? ArrowUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={c.id}
                    className={`whitespace-nowrap py-2.5 pr-4 font-medium first:rounded-l-md first:pl-3 last:rounded-r-md ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.sortValue ? (
                      <button
                        onClick={() => clickHeader(c)}
                        className={`inline-flex items-center gap-1 font-medium hover:text-primary-700 dark:hover:text-primary-300 ${
                          active ? 'text-primary-700 dark:text-primary-300' : ''
                        }`}
                      >
                        {c.header}
                        <Icon className={`h-3 w-3 ${active ? '' : 'opacity-50'}`} />
                      </button>
                    ) : (
                      <span>{c.header}</span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const key = rowKey(r)
              const expandable = !!renderExpanded && (canExpand ? canExpand(r) : true)
              return (
                <Fragment key={key}>
                  <tr
                    className={`border-b border-neutral-100 align-top hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 ${expandable ? 'cursor-pointer' : ''}`}
                    onClick={expandable ? () => setOpen(open === key ? null : key) : undefined}
                    tabIndex={expandable ? 0 : undefined}
                    onKeyDown={
                      expandable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setOpen(open === key ? null : key)
                            }
                          }
                        : undefined
                    }
                  >
                    {visible.map((c) => (
                      <td key={c.id} className={`py-2 pr-4 first:pl-3 ${c.align === 'right' ? 'whitespace-nowrap text-right tabular-nums' : ''} ${c.className ?? ''}`}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                  {expandable && open === key && (
                    <tr>
                      <td colSpan={visible.length} className="pb-3">{renderExpanded!(r)}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
