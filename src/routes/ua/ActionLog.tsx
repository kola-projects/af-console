// [3.51.0] Nhật ký thao tác thô (ZooKeeper action log) — bảng phân trang, server sắp xếp.
// [3.53.0] Tách khỏi UaReport.tsx để trang từng UA dùng lại: `fixedPerson` khoá bộ lọc người,
// `from`/`to` cho phép xem một khoảng khác khoảng của trang (vd đúng một ngày trên biểu đồ lịch).
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UA_LOG_SORT_COLUMNS, int, uaActionLog, type UaActionLogRow, type UaLevel, type UaLogSortColumn, type UaSummary } from '../../lib/uaReport'
import DataTable, { type Column, type SortState } from '../../components/DataTable'
import { Badge, Empty, ErrorBox, Loading, Mono, localTime } from '../../components/ui'
import { AppIconImg, BTN, INPUT } from './shared'

// ----------------------------------------------------------------------------- Nhật ký
const PAGE_SIZE = 50
const ACTION_TYPES = ['create', 'status_change', 'budget_change', 'bid_change', 'rename', 'update', 'delete']
const SOURCES = ['dashboard', 'launcher', 'rule', 'api']
const LOG_DEFAULT_SORT: SortState = { id: 'occurred_at', dir: 'desc' }

/** zk ghi thay đổi dạng { field: { before, after } } — đổi thành "field: trước → sau" cho dễ đọc. */
function changeText(c: Record<string, unknown> | null): string {
  if (!c) return ''
  const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'string' ? v : JSON.stringify(v))
  const parts: string[] = []
  for (const [field, v] of Object.entries(c)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('before' in v || 'after' in v)) {
      const d = v as { before?: unknown; after?: unknown }
      parts.push(`${field}: ${show(d.before)} → ${show(d.after)}`)
    }
  }
  if (parts.length) return parts.join(' · ')
  const s = JSON.stringify(c)
  return s.length > 90 ? `${s.slice(0, 90)}…` : s
}

// id cột = tên cột của view v_ua_actions, vì bảng này phân trang nên SERVER sắp xếp.
const LOG_COLUMNS: Column<UaActionLogRow>[] = [
  { id: 'occurred_at', header: 'Thời điểm', locked: true, sortValue: (r) => r.occurred_at, csvValue: (r) => localTime(r.occurred_at), className: 'whitespace-nowrap', cell: (r) => <Mono>{localTime(r.occurred_at)}</Mono> },
  { id: 'person_name', header: 'Người', sortValue: (r) => r.person_name, className: 'whitespace-nowrap', cell: (r) => r.person_name },
  {
    id: 'app_name', header: 'App', sortValue: (r) => r.app_name ?? r.app_id, className: 'min-w-52',
    cell: (r) =>
      r.app_id ? (
        <div className="flex items-center gap-2">
          <AppIconImg url={r.app_icon_url} name={r.app_name ?? r.app_id} size={22} />
          <span>{r.app_name ?? r.app_id}</span>
        </div>
      ) : (
        <span className="text-neutral-400">chưa suy ra</span>
      ),
  },
  { id: 'platform', header: 'Nền tảng', sortValue: (r) => r.platform, cell: (r) => r.platform },
  { id: 'level', header: 'Cấp', sortValue: (r) => r.level, cell: (r) => r.level },
  { id: 'action_type', header: 'Thao tác', sortValue: (r) => r.action_type, cell: (r) => <Badge tone={r.action_type === 'create' ? 'good' : r.outcome === 'failed' ? 'bad' : 'neutral'}>{r.action_type}</Badge> },
  { id: 'source', header: 'Nguồn', sortValue: (r) => r.source, cell: (r) => r.source },
  {
    id: 'entity_name', header: 'Đối tượng', sortValue: (r) => r.entity_name,
    csvValue: (r) => [r.entity_name, r.action_type !== 'create' ? changeText(r.changes) : ''].filter(Boolean).join(' | '),
    cell: (r) => (
      <>
        <div>{r.entity_name}</div>
        {r.action_type !== 'create' && changeText(r.changes) && <Mono className="text-[11px] text-neutral-500">{changeText(r.changes)}</Mono>}
      </>
    ),
  },
  { id: 'outcome', header: 'Kết quả', defaultHidden: true, sortValue: (r) => r.outcome, cell: (r) => r.outcome },
  { id: 'account_id', header: 'Ad account', defaultHidden: true, sortValue: (r) => r.account_id, cell: (r) => <Mono className="text-[11px]">{r.account_id}</Mono> },
]

export default function ActionLog({ s, level, fixedPerson, from, to, tableId = 'ua-action-log', pageSize = PAGE_SIZE }: {
  s: UaSummary; level: UaLevel; fixedPerson?: string; from?: string; to?: string; tableId?: string; pageSize?: number
}) {
  const [ownPerson, setPerson] = useState('')
  const person = fixedPerson ?? ownPerson
  const [actionType, setActionType] = useState('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState>(LOG_DEFAULT_SORT)
  const [page, setPage] = useState(0)
  const sortBy = (UA_LOG_SORT_COLUMNS as readonly string[]).includes(sort?.id ?? '') ? (sort!.id as UaLogSortColumn) : 'occurred_at'
  const filter = { from: from ?? s.from, to: to ?? s.to, level, person, actionType, source, search, sortBy, ascending: sort?.dir === 'asc', page, pageSize }
  const log = useQuery({ queryKey: ['ua-log', filter], queryFn: () => uaActionLog(filter), placeholderData: (prev) => prev })
  const actors = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of s.actions) m.set(a.person_key, a.person_name)
    for (const p of s.people) if (m.has(p.person_key)) m.set(p.person_key, p.display_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [s])
  const set = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0) }
  const total = log.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      {log.error && <div className="mb-2"><ErrorBox error={log.error} /></div>}
      <DataTable
        tableId={tableId}
        columns={LOG_COLUMNS}
        rows={log.data?.rows ?? []}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={(v) => { setSort(v ?? LOG_DEFAULT_SORT); setPage(0) }}
        csvName={`ua-nhat-ky_${filter.from}_${filter.to}_trang-${page + 1}`}
        toolbar={
          <>
            {fixedPerson === undefined && (
              <select className={INPUT} value={person} onChange={(e) => set(setPerson)(e.target.value)} aria-label="Lọc theo người">
                <option value="">Mọi người</option>
                {actors.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            )}
            <select className={INPUT} value={actionType} onChange={(e) => set(setActionType)(e.target.value)} aria-label="Lọc theo thao tác">
              <option value="">Mọi thao tác</option>
              {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className={INPUT} value={source} onChange={(e) => set(setSource)(e.target.value)} aria-label="Lọc theo nguồn">
              <option value="">Mọi nguồn</option>
              {SOURCES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className={`${INPUT} w-56`} placeholder="Tìm trong tên campaign / ad" value={search} onChange={(e) => set(setSearch)(e.target.value)} />
            <span className="text-xs text-neutral-500">{int(total)} dòng</span>
          </>
        }
      />
      {log.isLoading ? <Loading /> : !log.error && !log.data?.rows.length && <div className="mt-2"><Empty>Không có thao tác nào khớp bộ lọc.</Empty></div>}
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <button className={BTN} disabled={page === 0} onClick={() => setPage(page - 1)}>Trước</button>
          <span className="text-neutral-500">Trang {page + 1} / {pages}</span>
          <button className={BTN} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Sau</button>
          <span className="text-xs text-neutral-500">Tải CSV xuất trang đang xem.</span>
        </div>
      )}
    </>
  )
}
