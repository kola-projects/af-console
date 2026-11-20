// [3.51.0] UA activity report — chỉ role ua_manager + admin XEM (route guard ở App.tsx, dữ liệu chặn ở RLS;
// role ua thường không xem được). Sửa mapping người: chỉ admin.
// Dữ liệu do cron job ua-report-sync nạp mỗi ngày (xem trang Cron jobs): thao tác UA từ ZooKeeper
// + tiền theo ngày × app từ BBL Dashboard. Khung gán và công thức: xem đầu file lib/uaReport.ts.
// Mọi bảng dùng DataTable: bấm tiêu đề để sắp xếp, nút "Cột" để ẩn/hiện + đổi thứ tự, "Tải CSV".
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { myProfile } from '../lib/queries'
import {
  DAY_STATUS_LABEL,
  UA_LOG_SORT_COLUMNS,
  UNASSIGNED,
  dayStatus,
  buildByApp,
  buildByDay,
  buildPersonDay,
  buildScorecard,
  dayVN,
  daysBetween,
  deleteUaPerson,
  int,
  pct,
  profitOf,
  roasOf,
  saveUaPerson,
  shortDay,
  totalMoney,
  uaActionLog,
  uaReportSummary,
  usd,
  type DayRow,
  type Money,
  type ScoreRow,
  type UaActionLogRow,
  type UaApp,
  type UaAppRow,
  type UaLevel,
  type UaLogSortColumn,
  type UaPerson,
  type UaSummary,
} from '../lib/uaReport'
import DataTable, { type Column, type SortState } from '../components/DataTable'
import { Badge, Empty, ErrorBox, Loading, Mono, Stat, localTime } from '../components/ui'

const INPUT =
  'rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const BTN =
  'rounded border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900'
const BAD = 'text-red-700 dark:text-red-300'
const DASH = <span className="text-neutral-400">—</span>

type Tab = 'score' | 'app' | 'day' | 'log' | 'people'
const TABS: { id: Tab; label: string }[] = [
  { id: 'score', label: 'Scorecard' },
  { id: 'app', label: 'Theo app' },
  { id: 'day', label: 'Theo ngày' },
  { id: 'log', label: 'Nhật ký' },
  { id: 'people', label: 'Mapping người' },
]

const profitTone = (v: number) => (v < 0 ? BAD : '')

/** Icon app từ BBL Dashboard; không có (hoặc tải lỗi) thì hiện ô chữ cái đầu — cùng kiểu trang Quản lý app. */
function AppIconImg({ url, name, size = 28 }: { url: string | null | undefined; name: string; size?: number }) {
  const [err, setErr] = useState(false)
  const box = { width: size, height: size }
  if (url && !err) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setErr(true)}
        className="flex-none rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-800"
        style={box}
      />
    )
  }
  return (
    <div
      className="flex flex-none items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
      style={{ ...box, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {(name.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase()}
    </div>
  )
}

/** Icon + tên app (+ mã app và link sang trang app nếu là app do AF sinh) + package. */
function AppLabel({ app, id, name }: { app: UaApp | null; id: string; name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <AppIconImg url={app?.icon_url} name={name} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {app?.af_app_id ? (
            <Link to={`/apps/${app.af_app_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{name}</Link>
          ) : (
            <span className={id === '' ? 'text-neutral-500' : ''}>{name}</span>
          )}
          {app?.app_code && <Badge>{app.app_code}</Badge>}
        </div>
        {id && id !== name && <Mono className="text-[11px] text-neutral-400">{id}</Mono>}
      </div>
    </div>
  )
}

/** Bộ cột tiền dùng chung cho mọi bảng — cùng tên, cùng thứ tự, cùng cách tô màu. */
function moneyColumns<T>(get: (row: T) => Money | null): Column<T>[] {
  const val = (f: (m: Money) => number | null) => (row: T) => {
    const m = get(row)
    return m ? f(m) : null
  }
  const cpi = (m: Money) => (m.installs > 0 ? m.cost / m.installs : null)
  const col = (id: string, header: string, f: (m: Money) => number | null, show: (v: number | null) => string, tone?: (v: number) => string, hidden = false): Column<T> => ({
    id,
    header,
    align: 'right',
    defaultHidden: hidden,
    sortValue: val(f),
    cell: (row) => {
      const m = get(row)
      if (!m) return DASH
      const v = f(m)
      return <span className={v !== null && tone ? tone(v) : ''}>{show(v)}</span>
    },
  })
  return [
    col('revenue', 'Doanh thu', (m) => m.revenue, usd),
    col('adcost', 'Chi ads', (m) => m.cost, usd, undefined, true),
    col('fees', 'Phí', (m) => m.fees, usd, undefined, true),
    col('spend', 'Chi + phí', (m) => m.cost + m.fees, usd),
    col('profit', 'Lãi', profitOf, usd, profitTone),
    col('roas', 'ROAS', roasOf, pct, (v) => (v < 100 ? BAD : '')),
    col('installs', 'Installs', (m) => m.installs, (v) => (v === null ? '—' : int(v)), undefined, true),
    col('cpi', 'CPI', cpi, usd, undefined, true),
  ]
}

const countCell = (n: number) => (n ? int(n) : <span className="text-neutral-300 dark:text-neutral-700">0</span>)

/** Ô heatmap: đậm dần theo tỉ lệ so với giá trị lớn nhất. */
function Heat({ v, max }: { v: number; max: number }) {
  const a = v > 0 && max > 0 ? 0.12 + 0.6 * (v / max) : 0
  return (
    <td className="px-1 py-1 text-center">
      <div
        className="mx-auto min-w-9 rounded px-1 py-1 text-xs tabular-nums"
        style={{ backgroundColor: a ? `rgba(37, 99, 235, ${a.toFixed(2)})` : undefined }}
      >
        {v > 0 ? v : <span className="text-neutral-300 dark:text-neutral-700">·</span>}
      </div>
    </td>
  )
}

// ----------------------------------------------------------------------------- Scorecard
function PersonDetail({ s, personKey }: { s: UaSummary; personKey: string }) {
  const days = daysBetween(s.from, s.to)
  const appOf = new Map(s.apps.map((a) => [a.app_id, a]))
  const byDay = new Map<string, number>()
  const byApp = new Map<string, { create: number; update: number }>()
  for (const a of s.actions) {
    if (a.person_key !== personKey) continue
    byDay.set(a.day, (byDay.get(a.day) ?? 0) + Number(a.n))
    const k = a.app_id ?? ''
    const cur = byApp.get(k) ?? { create: 0, update: 0 }
    if (a.bucket === 'create') cur.create += Number(a.n)
    else cur.update += Number(a.n)
    byApp.set(k, cur)
  }
  const max = Math.max(0, ...byDay.values())
  const touched = [...byApp.entries()].sort((a, b) => b[1].create + b[1].update - (a[1].create + a[1].update))
  const owned = new Map<string, Money>()
  for (const m of s.money) {
    if ((appOf.get(m.app_id)?.owner_key ?? UNASSIGNED) !== personKey) continue
    const cur = owned.get(m.app_id) ?? { revenue: 0, cost: 0, fees: 0, installs: 0 }
    owned.set(m.app_id, {
      revenue: cur.revenue + Number(m.revenue),
      cost: cur.cost + Number(m.cost),
      fees: cur.fees + Number(m.fees),
      installs: cur.installs + Number(m.installs),
    })
  }
  const ownedRows = [...owned.entries()].sort((a, b) => b[1].revenue - a[1].revenue)
  const name = (id: string) => (id === '' ? 'Chưa suy ra app' : appOf.get(id)?.app_name ?? id)
  const item = (id: string) => (
    <>
      <AppIconImg url={appOf.get(id)?.icon_url} name={name(id)} size={18} />
      <span className="min-w-0 flex-1 truncate">{name(id)}</span>
    </>
  )

  return (
    <div className="grid gap-4 rounded-lg bg-neutral-50 p-4 text-sm dark:bg-neutral-900 md:grid-cols-2">
      <div className="md:col-span-2">
        <div className="mb-1 text-xs text-neutral-500">Thao tác theo ngày</div>
        <table className="border-collapse">
          <thead>
            <tr>
              {days.map((d) => (
                <th key={d} className="px-1 text-center text-[11px] font-normal text-neutral-500">{shortDay(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>{days.map((d) => <Heat key={d} v={byDay.get(d) ?? 0} max={max} />)}</tr>
          </tbody>
        </table>
      </div>
      <div>
        <div className="mb-1 text-xs text-neutral-500">App đã thao tác ({touched.length})</div>
        {touched.length === 0 ? (
          <div className="text-xs text-neutral-400">Không thao tác trong khoảng ngày này.</div>
        ) : (
          <ul className="space-y-1">
            {touched.slice(0, 10).map(([id, c]) => (
              <li key={id} className="flex items-center gap-2">
                {item(id)}
                <span className="whitespace-nowrap tabular-nums text-neutral-500">{c.create} thêm · {c.update} update</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs text-neutral-500">App sở hữu có số ({ownedRows.length})</div>
        {ownedRows.length === 0 ? (
          <div className="text-xs text-neutral-400">Không sở hữu app nào có doanh thu/chi phí trong khoảng ngày này.</div>
        ) : (
          <ul className="space-y-1">
            {ownedRows.slice(0, 10).map(([id, m]) => (
              <li key={id} className="flex items-center gap-2">
                {item(id)}
                <span className="whitespace-nowrap tabular-nums text-neutral-500">
                  {usd(m.revenue)} · lãi <span className={profitTone(profitOf(m))}>{usd(profitOf(m))}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Scorecard({ s }: { s: UaSummary }) {
  const rows = useMemo(() => buildScorecard(s), [s])
  const columns = useMemo<Column<ScoreRow>[]>(() => {
    const per = (r: ScoreRow) => (r.money && r.create + r.update > 0 ? profitOf(r.money) / (r.create + r.update) : null)
    return [
      { id: 'name', header: 'Người', locked: true, sortValue: (r) => r.name, cell: (r) => <span className={r.synthetic ? 'text-neutral-500' : ''}>{r.name}</span> },
      { id: 'create', header: 'Thêm', align: 'right', sortValue: (r) => (r.synthetic ? null : r.create), cell: (r) => (r.synthetic ? '' : countCell(r.create)) },
      { id: 'update', header: 'Update', align: 'right', sortValue: (r) => (r.synthetic ? null : r.update), cell: (r) => (r.synthetic ? '' : countCell(r.update)) },
      { id: 'total', header: 'Thao tác', align: 'right', defaultHidden: true, sortValue: (r) => (r.synthetic ? null : r.create + r.update), cell: (r) => (r.synthetic ? '' : countCell(r.create + r.update)) },
      ...moneyColumns<ScoreRow>((r) => r.money),
      {
        id: 'perAction', header: 'Lãi / thao tác', align: 'right', sortValue: per,
        cell: (r) => { const v = per(r); return v === null ? DASH : <span className={profitTone(v)}>{usd(v)}</span> },
      },
    ]
  }, [])
  if (!rows.length) return <Empty>Chưa có dữ liệu trong khoảng ngày này.</Empty>
  return (
    <>
      <DataTable
        tableId="ua-scorecard"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        defaultSort={{ id: 'total', dir: 'desc' }}
        pinBottom={(r) => r.synthetic}
        canExpand={(r) => !r.synthetic}
        renderExpanded={(r) => <PersonDetail s={s} personKey={r.key} />}
        csvName={`ua-scorecard_${s.from}_${s.to}`}
      />
      <p className="mt-3 text-xs text-neutral-500">
        Thêm / Update = thao tác do người đó làm trên ZooKeeper. Tiền = của các app người đó <b>sở hữu</b> (tag người trên
        BBL Dashboard) — hai khung khác nhau: nhiều thao tác mà ít tiền thường là đang chạy app của người khác. Bấm một
        dòng để xem theo ngày và theo app; bấm tiêu đề cột để sắp xếp.
      </p>
    </>
  )
}

// ----------------------------------------------------------------------------- Theo app
function ByApp({ s }: { s: UaSummary }) {
  const rows = useMemo(() => buildByApp(s), [s])
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k ? rows.filter((r) => `${r.name} ${r.app_id} ${r.ownerName ?? ''} ${r.app?.app_code ?? ''}`.toLowerCase().includes(k)) : rows
  }, [rows, q])
  const columns = useMemo<Column<UaAppRow>[]>(
    () => [
      { id: 'app', header: 'App', locked: true, sortValue: (r) => r.name, csvValue: (r) => `${r.name} (${r.app_id})`, cell: (r) => <AppLabel app={r.app} id={r.app_id} name={r.name} /> },
      { id: 'owner', header: 'Chủ app', sortValue: (r) => r.ownerName, cell: (r) => (r.ownerName ? r.ownerName : <span className="text-neutral-400">chưa gán</span>) },
      {
        id: 'actors', header: 'Người thao tác', sortValue: (r) => r.actors[0]?.name ?? null,
        csvValue: (r) => r.actors.map((a) => `${a.name} (${a.n})`).join('; '),
        className: 'text-xs text-neutral-600 dark:text-neutral-400',
        cell: (r) => (r.actors.length ? `${r.actors.slice(0, 3).map((a) => `${a.name} (${a.n})`).join(', ')}${r.actors.length > 3 ? ` +${r.actors.length - 3}` : ''}` : DASH),
      },
      { id: 'platform', header: 'Nền tảng', defaultHidden: true, sortValue: (r) => r.app?.platform ?? null, cell: (r) => r.app?.platform ?? DASH },
      { id: 'create', header: 'Thêm', align: 'right', sortValue: (r) => r.create, cell: (r) => (r.create ? int(r.create) : '') },
      { id: 'update', header: 'Update', align: 'right', sortValue: (r) => r.update, cell: (r) => (r.update ? int(r.update) : '') },
      { id: 'total', header: 'Thao tác', align: 'right', defaultHidden: true, sortValue: (r) => r.create + r.update, cell: (r) => (r.create + r.update ? int(r.create + r.update) : '') },
      ...moneyColumns<UaAppRow>((r) => r.money),
    ],
    [],
  )
  return (
    <>
      <DataTable
        tableId="ua-by-app"
        columns={columns}
        rows={shown}
        rowKey={(r) => r.app_id || '_none'}
        defaultSort={{ id: 'revenue', dir: 'desc' }}
        csvName={`ua-theo-app_${s.from}_${s.to}`}
        toolbar={
          <>
            <input className={`${INPUT} w-72`} placeholder="Tìm theo tên app, package, mã app, chủ app" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="text-xs text-neutral-500">{int(shown.length)} app</span>
          </>
        }
      />
      {shown.length === 0 && <div className="mt-2"><Empty>Không có app nào khớp.</Empty></div>}
      <p className="mt-3 text-xs text-neutral-500">
        App của thao tác được suy từ ad account: lấy app có chi phí lớn nhất trên account đó (ưu tiên đúng ngày). Account
        chạy nhiều app sẽ dồn về app chi nhiều nhất; account chưa phát sinh chi phí thì chưa suy ra được app. Mã app và
        link chỉ có ở app do App-Factory sinh (khớp bảng Apps theo package). Icon lấy từ BBL Dashboard.
      </p>
    </>
  )
}

// ----------------------------------------------------------------------------- Theo ngày
function ByDay({ s }: { s: UaSummary }) {
  const rows = useMemo(() => buildByDay(s), [s])
  const pd = useMemo(() => buildPersonDay(s), [s])
  const days = useMemo(() => daysBetween(s.from, s.to), [s.from, s.to])
  const columns = useMemo<Column<DayRow>[]>(() => {
    const maxAct = Math.max(1, ...rows.map((r) => r.create + r.update))
    const maxRev = Math.max(1, ...rows.map((r) => r.money.revenue))
    const bar = (v: number, max: number, cls: string) => (
      <div className="h-1.5 w-24 rounded bg-neutral-100 dark:bg-neutral-800">
        <div className={`h-1.5 rounded ${cls}`} style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%` }} />
      </div>
    )
    const money = moneyColumns<DayRow>((r) => (r.money.revenue !== 0 || r.money.cost !== 0 ? r.money : null)).map((c) =>
      c.id === 'revenue'
        ? { ...c, cell: (r: DayRow) => <div className="flex items-center justify-end gap-2">{bar(r.money.revenue, maxRev, 'bg-green-500')}{c.cell(r)}</div> }
        : c,
    )
    return [
      { id: 'day', header: 'Ngày', locked: true, sortValue: (r) => r.day, cell: (r) => <Mono>{r.day}</Mono> },
      {
        id: 'status', header: 'Số tiền', sortValue: (r) => DAY_STATUS_LABEL[dayStatus(r.day)],
        cell: (r) => {
          const st = dayStatus(r.day)
          return <Badge tone={st === 'live' ? 'warn' : st === 'pending' ? 'neutral' : 'good'}>{DAY_STATUS_LABEL[st]}</Badge>
        },
      },
      { id: 'create', header: 'Thêm', align: 'right', sortValue: (r) => r.create, cell: (r) => countCell(r.create) },
      { id: 'update', header: 'Update', align: 'right', sortValue: (r) => r.update, cell: (r) => countCell(r.update) },
      {
        id: 'total', header: 'Thao tác', align: 'right', sortValue: (r) => r.create + r.update,
        cell: (r) => <div className="flex items-center justify-end gap-2">{bar(r.create + r.update, maxAct, 'bg-blue-500')}{countCell(r.create + r.update)}</div>,
      },
      ...money,
    ]
  }, [rows])
  return (
    <>
      <DataTable
        tableId="ua-by-day"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.day}
        defaultSort={{ id: 'day', dir: 'asc' }}
        csvName={`ua-theo-ngay_${s.from}_${s.to}`}
      />

      <h2 className="mb-2 mt-8 text-sm font-semibold">Nhịp độ từng người (số thao tác mỗi ngày)</h2>
      {pd.people.length === 0 ? (
        <Empty>Không có thao tác nào trong khoảng ngày này.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="py-1 pr-4 text-left font-normal text-neutral-500">Người</th>
                {days.map((d) => (
                  <th key={d} className="px-1 text-center text-[11px] font-normal text-neutral-500">{shortDay(d)}</th>
                ))}
                <th className="pl-3 text-right font-normal text-neutral-500">Tổng</th>
              </tr>
            </thead>
            <tbody>
              {pd.people.map((p) => (
                <tr key={p.key}>
                  <td className="whitespace-nowrap py-1 pr-4">{p.name}</td>
                  {days.map((d) => <Heat key={d} v={p.byDay.get(d) ?? 0} max={pd.max} />)}
                  <td className="pl-3 text-right tabular-nums">{int(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

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

function ActionLog({ s, level }: { s: UaSummary; level: UaLevel }) {
  const [person, setPerson] = useState('')
  const [actionType, setActionType] = useState('')
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState>(LOG_DEFAULT_SORT)
  const [page, setPage] = useState(0)
  const sortBy = (UA_LOG_SORT_COLUMNS as readonly string[]).includes(sort?.id ?? '') ? (sort!.id as UaLogSortColumn) : 'occurred_at'
  const filter = { from: s.from, to: s.to, level, person, actionType, source, search, sortBy, ascending: sort?.dir === 'asc', page, pageSize: PAGE_SIZE }
  const log = useQuery({ queryKey: ['ua-log', filter], queryFn: () => uaActionLog(filter), placeholderData: (prev) => prev })
  const actors = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of s.actions) m.set(a.person_key, a.person_name)
    for (const p of s.people) if (m.has(p.person_key)) m.set(p.person_key, p.display_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [s])
  const set = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0) }
  const total = log.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      {log.error && <div className="mb-2"><ErrorBox error={log.error} /></div>}
      <DataTable
        tableId="ua-action-log"
        columns={LOG_COLUMNS}
        rows={log.data?.rows ?? []}
        rowKey={(r) => r.id}
        sort={sort}
        onSortChange={(v) => { setSort(v ?? LOG_DEFAULT_SORT); setPage(0) }}
        csvName={`ua-nhat-ky_${s.from}_${s.to}_trang-${page + 1}`}
        toolbar={
          <>
            <select className={INPUT} value={person} onChange={(e) => set(setPerson)(e.target.value)} aria-label="Lọc theo người">
              <option value="">Mọi người</option>
              {actors.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
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

// ----------------------------------------------------------------------------- Mapping người
const splitList = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
const EMPTY_PERSON: UaPerson = { person_key: '', display_name: '', zk_emails: [], bdash_tags: [], note: null }

function PersonForm({ initial, isNew, onDone }: { initial: UaPerson; isNew: boolean; onDone: () => void }) {
  const qc = useQueryClient()
  const [key, setKey] = useState(initial.person_key)
  const [name, setName] = useState(initial.display_name)
  const [emails, setEmails] = useState(initial.zk_emails.join(', '))
  const [tags, setTags] = useState(initial.bdash_tags.join(', '))
  const [note, setNote] = useState(initial.note ?? '')
  const refresh = () => qc.invalidateQueries({ queryKey: ['ua-report'] })
  const save = useMutation({
    mutationFn: () => {
      if (!/^[a-z0-9._-]+$/.test(key.trim().toLowerCase())) throw new Error('Mã người chỉ gồm chữ thường, số, dấu chấm, gạch.')
      if (!name.trim()) throw new Error('Nhập tên hiển thị.')
      return saveUaPerson({ person_key: key, display_name: name, zk_emails: splitList(emails), bdash_tags: splitList(tags), note })
    },
    onSuccess: () => { refresh(); onDone() },
  })
  const del = useMutation({ mutationFn: () => deleteUaPerson(initial.person_key), onSuccess: () => { refresh(); onDone() } })
  const field = 'grid gap-1 text-xs text-neutral-500'
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          Mã người (khoá, không đổi được sau khi tạo)
          <input className={INPUT} value={key} disabled={!isNew} placeholder="vd hienntt" onChange={(e) => setKey(e.target.value)} />
        </label>
        <label className={field}>
          Tên hiển thị
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={field}>
          Email đăng nhập ZooKeeper (cách nhau dấu phẩy)
          <input className={INPUT} value={emails} placeholder="a@bblvn.com, a@binarybridge.dev" onChange={(e) => setEmails(e.target.value)} />
        </label>
        <label className={field}>
          Tag người trên BBL Dashboard (cách nhau dấu phẩy)
          <input className={INPUT} value={tags} placeholder="hao, haot9" onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className={`${field} sm:col-span-2`}>
          Ghi chú
          <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {(save.error || del.error) && <div className="mt-3"><ErrorBox error={save.error ?? del.error} /></div>}
      <div className="mt-3 flex items-center gap-2">
        <button className="rounded bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-40" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button className={BTN} onClick={onDone}>Huỷ</button>
        {!isNew && (
          <button
            className="ml-auto text-xs text-red-700 underline disabled:opacity-40 dark:text-red-300"
            disabled={del.isPending}
            onClick={() => { if (window.confirm(`Xoá mapping của ${initial.display_name}? Thao tác và tiền của người này sẽ về "chưa gán".`)) del.mutate() }}
          >
            Xoá mapping
          </button>
        )}
      </div>
    </div>
  )
}

function People({ s, isAdmin }: { s: UaSummary; isAdmin: boolean }) {
  const [editing, setEditing] = useState<string | null>(null) // person_key, hoặc '+' khi thêm mới
  const unmapped = useMemo(() => {
    const mapped = new Set(s.people.map((p) => p.person_key))
    const m = new Map<string, string>()
    for (const a of s.actions) if (!mapped.has(a.person_key) && !a.person_key.startsWith('_')) m.set(a.person_key, a.person_name)
    return [...m.entries()]
  }, [s])
  const columns = useMemo<Column<UaPerson>[]>(() => {
    const cols: Column<UaPerson>[] = [
      { id: 'name', header: 'Người', locked: true, sortValue: (p) => p.display_name, cell: (p) => p.display_name },
      { id: 'key', header: 'Mã', sortValue: (p) => p.person_key, cell: (p) => <Mono>{p.person_key}</Mono> },
      { id: 'emails', header: 'Email ZooKeeper', sortValue: (p) => p.zk_emails.join(', ') || null, className: 'text-xs', cell: (p) => p.zk_emails.join(', ') || <span className="text-neutral-400">chưa có</span> },
      {
        id: 'tags', header: 'Tag BBL Dashboard', sortValue: (p) => p.bdash_tags.join(', ') || null, className: 'text-xs',
        cell: (p) => (p.bdash_tags.length ? p.bdash_tags.map((t) => <span key={t} className="mr-1"><Badge>#{t}</Badge></span>) : <span className="text-neutral-400">chưa gán — không có tiền</span>),
      },
      { id: 'note', header: 'Ghi chú', sortValue: (p) => p.note, className: 'text-xs text-neutral-500', cell: (p) => p.note },
    ]
    if (isAdmin) cols.push({ id: 'edit', header: '', locked: true, cell: (p) => <button className="text-xs underline" onClick={() => setEditing(p.person_key)}>Sửa</button> })
    return cols
  }, [isAdmin])
  const current = editing === '+' ? EMPTY_PERSON : s.people.find((p) => p.person_key === editing)
  return (
    <>
      <p className="mb-3 text-sm text-neutral-500">
        Email ZooKeeper quyết định <b>thao tác</b> thuộc về ai; tag BBL Dashboard quyết định <b>tiền</b> của app nào thuộc về
        ai. Hai thứ này không tự suy ra nhau nên phải khai ở đây. Sửa mapping có hiệu lực cho cả dữ liệu cũ.
      </p>
      {unmapped.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Có {unmapped.length} tài khoản ZooKeeper đã thao tác nhưng chưa có trong mapping:{' '}
          {unmapped.map(([k, n]) => `${n} (${k})`).join(', ')}.
        </div>
      )}
      <DataTable tableId="ua-people" columns={columns} rows={s.people} rowKey={(p) => p.person_key} defaultSort={{ id: 'name', dir: 'asc' }} />
      {isAdmin ? (
        <div className="mt-4">
          {current ? (
            <PersonForm key={editing} initial={current} isNew={editing === '+'} onDone={() => setEditing(null)} />
          ) : (
            <button className={BTN} onClick={() => setEditing('+')}>Thêm người</button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-neutral-500">Chỉ admin sửa được mapping.</p>
      )}
    </>
  )
}

// ----------------------------------------------------------------------------- Trang
export default function UaReport() {
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  const [from, setFrom] = useState(dayVN(6))
  const [to, setTo] = useState(dayVN(0))
  const [level, setLevel] = useState<UaLevel>('campaign')
  const [tab, setTab] = useState<Tab>('score')
  const valid = from <= to
  const q = useQuery({
    queryKey: ['ua-report', from, to, level],
    queryFn: () => uaReportSummary(from, to, level),
    enabled: valid,
    placeholderData: (prev) => prev,
  })
  const s = q.data
  const total = useMemo(() => (s ? totalMoney(s) : null), [s])
  const actions = useMemo(() => (s ? s.actions.reduce((t, a) => t + Number(a.n), 0) : 0), [s])
  // Chip chọn nhanh, cùng kiểu BBL Dashboard: D0 = hôm nay, D-1 = hôm qua … D-6 (mỗi chip MỘT ngày);
  // "7 ngày qua" gộp cả 7 ngày D-6 → D0; "Tháng này" từ ngày 1 tới hôm nay. Ngày tính theo giờ Việt Nam.
  const presets = useMemo(() => {
    const today = dayVN(0)
    const single = [0, 1, 2, 3, 4, 5, 6].map((n) => {
      const d = dayVN(n)
      const hint = n === 0 ? 'Hôm nay' : n === 1 ? 'Hôm qua' : n === 2 ? 'Hôm kia' : `${n} ngày trước`
      return { id: `d${n}`, label: n === 0 ? 'D0' : `D-${n}`, title: `${hint} — ${shortDay(d)} · số tiền ${DAY_STATUS_LABEL[dayStatus(d)]}`, from: d, to: d }
    })
    return [
      ...single,
      { id: 'last7', label: '7 ngày qua', title: `Gộp 7 ngày: ${shortDay(dayVN(6))} – ${shortDay(today)}`, from: dayVN(6), to: today },
      { id: 'month', label: 'Tháng này', title: `Từ 01/${today.slice(5, 7)} tới hôm nay`, from: `${today.slice(0, 8)}01`, to: today },
    ]
  }, [])
  const activePreset = presets.find((p) => p.from === from && p.to === to)?.id ?? null
  // Ngày chưa chốt trong khoảng đang xem: D0 đang chạy, D-1/D-2 còn có thể đổi (xem dayStatus).
  const unsettled = useMemo(() => {
    const days = valid ? daysBetween(from, to) : []
    return { live: days.some((d) => dayStatus(d) === 'live'), pending: days.filter((d) => dayStatus(d) === 'pending').length }
  }, [from, to, valid])
  const unsettledCount = (unsettled.live ? 1 : 0) + unsettled.pending

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg">UA activity Report</h1>
        <input type="date" className={INPUT} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Từ ngày" />
        <span className="text-neutral-400">–</span>
        <input type="date" className={INPUT} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Đến ngày" />
        <select className={INPUT} value={level} onChange={(e) => setLevel(e.target.value as UaLevel)} aria-label="Cấp thao tác">
          <option value="campaign">Cấp campaign</option>
          <option value="ad">Cấp ad</option>
          <option value="all">Mọi cấp</option>
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5" role="group" aria-label="Chọn nhanh khoảng ngày">
        {presets.map((p) => (
          <button
            key={p.id}
            title={p.title}
            aria-pressed={activePreset === p.id}
            onClick={() => { setFrom(p.from); setTo(p.to) }}
            className={`rounded-full px-2.5 py-0.5 text-xs ${
              activePreset === p.id
                ? 'bg-primary-600 font-medium text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        Ai thao tác gì trên campaign, và app của ai ra bao nhiêu tiền. Ngày theo giờ Việt Nam.
        {s?.sync?.last_success_at && <> Đồng bộ lần cuối {localTime(s.sync.last_success_at)}.</>}
        {s?.data_from && <> Dữ liệu tích luỹ từ {s.data_from}.</>}
        {s?.sync?.last_status === 'error' && <span className={BAD}> Lần đồng bộ gần nhất bị lỗi — xem trang Cron jobs.</span>}
      </p>
      {unsettledCount > 0 && (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
          Khoảng này có {unsettledCount} ngày số tiền chưa chốt:
          {unsettled.live && <> hôm nay (D0) đang chạy, cập nhật mỗi giờ{unsettled.pending > 0 ? ';' : '.'}</>}
          {unsettled.pending > 0 && <> {unsettled.pending} ngày liền trước (D-1, D-2) còn có thể đổi, cập nhật vài giờ một lần.</>}
          {' '}Từ D-3 trở về trước coi như đã ổn định.
        </p>
      )}

      {!valid ? (
        <div className="mt-4"><ErrorBox error="Ngày bắt đầu phải không sau ngày kết thúc." /></div>
      ) : q.error ? (
        <div className="mt-4"><ErrorBox error={q.error} /></div>
      ) : !s || !total ? (
        <Loading />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Thao tác" value={int(actions)} hint={`${int(s.actions.filter((a) => a.bucket === 'create').reduce((t, a) => t + Number(a.n), 0))} thêm mới`} />
            <Stat label="Doanh thu" value={usd(total.revenue)} hint={`chi ads ${usd(total.cost)} · phí ${usd(total.fees)}`} />
            <Stat
              label="Lãi"
              value={usd(profitOf(total))}
              tone={profitOf(total) < 0 ? 'bad' : undefined}
              hint={unsettledCount > 0 ? `gồm ${unsettledCount} ngày chưa chốt` : 'mọi ngày đã ổn định'}
            />
            <Stat label="ROAS" value={pct(roasOf(total))} hint="doanh thu / (chi ads + phí)" />
          </div>

          <div className="mt-6 flex border-b border-neutral-200 text-sm dark:border-neutral-800">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-2 ${
                  tab === t.id
                    ? 'border-primary-600 font-medium text-primary-700 dark:text-primary-300'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={`mt-4 ${q.isFetching ? 'opacity-60' : ''}`}>
            {tab === 'score' && <Scorecard s={s} />}
            {tab === 'app' && <ByApp s={s} />}
            {tab === 'day' && <ByDay s={s} />}
            {tab === 'log' && <ActionLog s={s} level={level} />}
            {tab === 'people' && <People s={s} isAdmin={me.data?.role === 'admin'} />}
          </div>
        </>
      )}
    </div>
  )
}
