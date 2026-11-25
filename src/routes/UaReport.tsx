// [3.51.0] UA activity report — chỉ role ua_manager + admin XEM (route guard ở App.tsx, dữ liệu chặn ở RLS;
// role ua thường không xem được). Sửa mapping người + gán app cho người: chỉ admin.
// [3.52.0] Tab "Gán app" (gán tay chủ app, ưu tiên hơn tag BBL Dashboard) + dòng "Tổng" ở chân các bảng.
// Dữ liệu do cron job ua-report-sync nạp mỗi ngày (xem trang Cron jobs): thao tác UA từ ZooKeeper
// + tiền theo ngày × app từ BBL Dashboard. Khung gán và công thức: xem đầu file lib/uaReport.ts.
// [3.53.0] Thiết kế mới (chủ sản phẩm duyệt 2026-11-25): Tổng quan · Workload · Phân bổ · Kết quả · Từng UA
// (các màn ở routes/ua/) lấy thêm số "Kho creative" của ZooKeeper; bảng tiền cũ gom vào tab "Tiền theo app",
// Gán app + Mapping người gom vào tab "Thiết lập". Tab và người đang xem nằm trên URL (?tab=…&p=…&day=…).
// Mọi bảng dùng DataTable: bấm tiêu đề để sắp xếp, nút "Cột" để ẩn/hiện + đổi thứ tự, "Tải CSV".
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { myProfile } from '../lib/queries'
import {
  DAY_STATUS_LABEL,
  ROAS_MIN_AD_COST,
  UNASSIGNED,
  ZERO_MONEY,
  addDays,
  dayStatus,
  buildActivity,
  buildByApp,
  buildByDay,
  buildPersonDay,
  buildScorecard,
  dayVN,
  daysBetween,
  deleteUaPerson,
  int,
  mondayOf,
  pct,
  profitOf,
  roasOf,
  saveUaPerson,
  setAppOwner,
  shortDay,
  sumRows,
  totalMoney,
  uaActivityCalendar,
  uaReportSummary,
  usd,
  type CreativeTeam,
  type DayRow,
  type Money,
  type ScoreRow,
  type UaAppRow,
  type UaLevel,
  type UaPerson,
  type UaSummary,
} from '../lib/uaReport'
import DataTable, { type Column, type TotalRow } from '../components/DataTable'
import { Badge, Empty, ErrorBox, Loading, Mono, Stat, localTime } from '../components/ui'
import ActionLog from './ua/ActionLog'
import { Allocation, Overview, Results, TeamStats, Workload } from './ua/Activity'
import PersonPage from './ua/PersonPage'
import { AppIconImg, AppLabel, BAD, BTN, DASH, INPUT, indexCalendar, useCreativeTeam, type Go, type RosterRow, type ViewProps } from './ua/shared'

type Tab = 'overview' | 'workload' | 'alloc' | 'results' | 'person' | 'log' | 'money' | 'setup'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'workload', label: 'Workload' },
  { id: 'alloc', label: 'Phân bổ' },
  { id: 'results', label: 'Kết quả' },
  { id: 'person', label: 'Từng UA' },
  { id: 'log', label: 'Nhật ký' },
  { id: 'money', label: 'Tiền theo app' },
  { id: 'setup', label: 'Thiết lập' },
]
/** Các tab hoạt động dùng chung bốn ô số của cả đội. */
const TEAM_TABS: Tab[] = ['overview', 'workload', 'alloc', 'results']

/** Nhóm nút chuyển màn con (Tiền theo app, Thiết lập). */
function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; label: string }) {
  return (
    <div className="mb-4 inline-flex" role="group" aria-label={label}>
      {options.map(([id, text], i) => (
        <button key={id} aria-pressed={value === id} onClick={() => onChange(id)}
          className={`${BTN} ${i === 0 ? 'rounded-r-none' : i === options.length - 1 ? '-ml-px rounded-l-none' : '-ml-px rounded-none'} ${value === id ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

const profitTone = (v: number) => (v < 0 ? BAD : '')

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

/** id các cột tiền (moneyColumns) + cột đếm — những cột có số ở dòng "Tổng". */
const TOTAL_COLUMNS = ['create', 'update', 'total', 'revenue', 'adcost', 'fees', 'spend', 'profit', 'roas', 'installs', 'cpi']
const ROAS_NOTE = `ROAS để trống khi chi ads dưới $${ROAS_MIN_AD_COST} trong khoảng ngày (app không chạy ads thì tỉ lệ này không có nghĩa).`

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
  const total = useMemo<TotalRow<ScoreRow>>(() => {
    const t = sumRows(rows, (r) => r)
    return { row: { key: '_total', name: 'Tổng', synthetic: false, ...t }, columns: [...TOTAL_COLUMNS, 'perAction'] }
  }, [rows])
  if (!rows.length) return <Empty>Chưa có dữ liệu trong khoảng ngày này.</Empty>
  return (
    <>
      <DataTable
        tableId="ua-scorecard"
        totalRow={total}
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
        Thêm / Update = thao tác do người đó làm trên ZooKeeper. Tiền = của các app người đó <b>sở hữu</b> (gán ở tab
        Gán app, chưa gán tay thì theo tag người trên BBL Dashboard) — hai khung khác nhau: nhiều thao tác mà ít tiền
        thường là đang chạy app của người khác. Dòng Tổng = mọi người cộng cả phần chưa gán, khớp các ô số ở đầu trang.
        Bấm một dòng để xem theo ngày và theo app; bấm tiêu đề cột để sắp xếp. {ROAS_NOTE}
      </p>
    </>
  )
}

// ----------------------------------------------------------------------------- Theo app
const ACTORS_COLUMN: Column<UaAppRow> = {
  id: 'actors', header: 'Người thao tác', sortValue: (r) => r.actors[0]?.name ?? null,
  csvValue: (r) => r.actors.map((a) => `${a.name} (${a.n})`).join('; '),
  className: 'text-xs text-neutral-600 dark:text-neutral-400',
  cell: (r) => (r.actors.length ? `${r.actors.slice(0, 3).map((a) => `${a.name} (${a.n})`).join(', ')}${r.actors.length > 3 ? ` +${r.actors.length - 3}` : ''}` : DASH),
}

/** Dòng "Tổng" cho bảng theo app — cộng đúng các dòng đang hiện (sau khi lọc). */
function appTotal(rows: UaAppRow[]): TotalRow<UaAppRow> {
  return {
    label: `Tổng ${int(rows.length)} app`,
    columns: TOTAL_COLUMNS,
    row: { app_id: '_total', name: 'Tổng', app: null, ownerName: null, tagOwnerName: null, actors: [], ...sumRows(rows, (r) => r) },
  }
}

function ByApp({ s }: { s: UaSummary }) {
  const rows = useMemo(() => buildByApp(s), [s])
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k ? rows.filter((r) => `${r.name} ${r.app_id} ${r.ownerName ?? ''} ${r.app?.app_code ?? ''}`.toLowerCase().includes(k)) : rows
  }, [rows, q])
  const total = useMemo(() => appTotal(shown), [shown])
  const columns = useMemo<Column<UaAppRow>[]>(
    () => [
      { id: 'app', header: 'App', locked: true, sortValue: (r) => r.name, csvValue: (r) => `${r.name} (${r.app_id})`, cell: (r) => <AppLabel app={r.app} id={r.app_id} name={r.name} /> },
      {
        id: 'owner', header: 'Chủ app', sortValue: (r) => r.ownerName,
        cell: (r) =>
          r.ownerName ? (
            <span className="whitespace-nowrap">
              {r.ownerName}
              {r.app?.owner_source === 'manual' && <span className="ml-1.5 text-[11px] text-neutral-400">gán tay</span>}
            </span>
          ) : (
            <span className="text-neutral-400">chưa gán</span>
          ),
      },
      ACTORS_COLUMN,
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
        totalRow={total}
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
        link chỉ có ở app do App-Factory sinh (khớp bảng Apps theo package). Icon lấy từ BBL Dashboard. Đổi chủ app ở
        tab Gán app. {ROAS_NOTE}
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
        ? { ...c, totalCell: c.cell, cell: (r: DayRow) => <div className="flex items-center justify-end gap-2">{bar(r.money.revenue, maxRev, 'bg-green-500')}{c.cell(r)}</div> }
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
        totalCell: (r) => countCell(r.create + r.update),
        cell: (r) => <div className="flex items-center justify-end gap-2">{bar(r.create + r.update, maxAct, 'bg-blue-500')}{countCell(r.create + r.update)}</div>,
      },
      ...money,
    ]
  }, [rows])
  const total = useMemo<TotalRow<DayRow>>(() => {
    const t = sumRows(rows, (r) => r)
    return { label: `Tổng ${int(rows.length)} ngày`, columns: TOTAL_COLUMNS, row: { day: '', create: t.create, update: t.update, money: t.money ?? ZERO_MONEY } }
  }, [rows])
  return (
    <>
      <DataTable
        tableId="ua-by-day"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.day}
        defaultSort={{ id: 'day', dir: 'asc' }}
        totalRow={total}
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

// ----------------------------------------------------------------------------- Gán app
type OwnerFilter = 'all' | 'none' | 'manual' | 'tag'

function Assign({ s, isAdmin, team }: { s: UaSummary; isAdmin: boolean; team: CreativeTeam | null }) {
  const qc = useQueryClient()
  // Ai đang có creative trên app này trong kỳ (theo Kho creative của ZooKeeper) — gợi ý người thực chạy.
  const uploaders = useMemo(() => {
    const m = new Map<string, { name: string; n: number }[]>()
    for (const person of team?.people ?? []) {
      if (person.person_key.startsWith('_')) continue
      for (const a of person.apps) {
        if (!a.app_id || !(a.new || a.creatives)) continue
        const list = m.get(a.app_id) ?? []
        list.push({ name: person.name, n: a.new || a.creatives })
        m.set(a.app_id, list)
      }
    }
    for (const list of m.values()) list.sort((x, y) => y.n - x.n)
    return m
  }, [team])
  const all = useMemo(() => buildByApp(s, true), [s])
  const [q, setQ] = useState('')
  const [src, setSrc] = useState<OwnerFilter>('all')
  const [person, setPerson] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  // Chờ cả lượt tải lại báo cáo rồi mới coi là xong — để ô chọn không nháy về giá trị cũ.
  const assign = useMutation({
    mutationFn: (v: { appId: string; personKey: string | null }) => setAppOwner(v.appId, v.personKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ua-report'] }),
  })
  const pending = assign.isPending ? assign.variables : undefined

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    return all.filter((r) => {
      if (activeOnly && !r.money && r.create + r.update === 0) return false
      if (src !== 'all' && (r.app?.owner_source ?? 'none') !== src) return false
      if (person && r.app?.owner_key !== person) return false
      return !k || `${r.name} ${r.app_id} ${r.ownerName ?? ''} ${r.app?.app_code ?? ''} ${r.app?.tags.join(' ') ?? ''}`.toLowerCase().includes(k)
    })
  }, [all, q, src, person, activeOnly])
  const total = useMemo(() => appTotal(shown), [shown])
  // App đang có tiền trong khoảng ngày mà chưa có chủ — phần cần gán trước.
  const orphan = useMemo(() => {
    const rows = all.filter((r) => !r.app?.owner_key && r.money)
    return { n: rows.length, money: sumRows(rows, (r) => r).money ?? ZERO_MONEY }
  }, [all])

  const columns = useMemo<Column<UaAppRow>[]>(
    () => [
      { id: 'app', header: 'App', locked: true, sortValue: (r) => r.name, csvValue: (r) => `${r.name} (${r.app_id})`, cell: (r) => <AppLabel app={r.app} id={r.app_id} name={r.name} /> },
      {
        id: 'owner', header: 'Chủ app', locked: true, sortValue: (r) => r.ownerName,
        cell: (r) => {
          if (!isAdmin) return r.ownerName ?? <span className="text-neutral-400">chưa gán</span>
          const busy = pending?.appId === r.app_id
          const value = busy ? pending.personKey ?? '' : r.app?.owner_source === 'manual' ? r.app.owner_key ?? '' : ''
          return (
            <select
              className={`${INPUT} w-44 ${busy ? 'opacity-50' : ''}`}
              value={value}
              disabled={assign.isPending}
              aria-label={`Chủ app của ${r.name}`}
              onChange={(e) => assign.mutate({ appId: r.app_id, personKey: e.target.value || null })}
            >
              <option value="">{r.tagOwnerName ? `Theo tag: ${r.tagOwnerName}` : 'Chưa gán'}</option>
              {s.people.map((p) => <option key={p.person_key} value={p.person_key}>{p.display_name}</option>)}
            </select>
          )
        },
      },
      {
        id: 'source', header: 'Nguồn gán', sortValue: (r) => r.app?.owner_source ?? null,
        csvValue: (r) => (r.app?.owner_source === 'manual' ? 'gán tay' : r.app?.owner_source === 'tag' ? 'theo tag' : 'chưa có chủ'),
        cell: (r) =>
          r.app?.owner_source === 'manual' ? <Badge tone="good">gán tay</Badge>
          : r.app?.owner_source === 'tag' ? <Badge>theo tag</Badge>
          : <span className="whitespace-nowrap text-neutral-400">chưa có chủ</span>,
      },
      ...moneyColumns<UaAppRow>((r) => r.money),
      ACTORS_COLUMN,
      {
        id: 'uploaders', header: 'Người lên creative', sortValue: (r) => uploaders.get(r.app_id)?.[0]?.name ?? null,
        csvValue: (r) => (uploaders.get(r.app_id) ?? []).map((a) => `${a.name} (${a.n})`).join('; '),
        className: 'text-xs text-neutral-600 dark:text-neutral-400',
        cell: (r) => {
          const list = uploaders.get(r.app_id) ?? []
          return list.length ? `${list.slice(0, 3).map((a) => `${a.name} (${a.n})`).join(', ')}${list.length > 3 ? ` +${list.length - 3}` : ''}` : DASH
        },
      },
      {
        id: 'tags', header: 'Tag BBL Dashboard', sortValue: (r) => r.app?.tags.join(', ') || null, className: 'text-xs',
        cell: (r) => (r.app?.tags.length ? r.app.tags.map((t) => <span key={t} className="mr-1"><Badge>#{t}</Badge></span>) : DASH),
      },
      { id: 'platform', header: 'Nền tảng', defaultHidden: true, sortValue: (r) => r.app?.platform ?? null, cell: (r) => r.app?.platform ?? DASH },
      { id: 'create', header: 'Thêm', align: 'right', defaultHidden: true, sortValue: (r) => r.create, cell: (r) => (r.create ? int(r.create) : '') },
      { id: 'update', header: 'Update', align: 'right', defaultHidden: true, sortValue: (r) => r.update, cell: (r) => (r.update ? int(r.update) : '') },
      { id: 'total', header: 'Thao tác', align: 'right', defaultHidden: true, sortValue: (r) => r.create + r.update, cell: (r) => (r.create + r.update ? int(r.create + r.update) : '') },
    ],
    [isAdmin, s.people, pending, assign, uploaders],
  )

  return (
    <>
      <p className="mb-3 text-sm text-neutral-500">
        Chọn người ở cột <b>Chủ app</b> để tiền của app đó tính cho người ấy. Gán tay ở đây được ưu tiên hơn tag trên BBL
        Dashboard; chọn lại dòng đầu của ô chọn để bỏ gán tay (app quay về chủ theo tag, nếu có). Gán có hiệu lực cho cả
        dữ liệu cũ và không sửa gì bên BBL Dashboard.
      </p>
      {orphan.n > 0 ? (
        <div className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Trong khoảng ngày đang xem còn <b>{int(orphan.n)} app có tiền mà chưa có chủ</b>: doanh thu {usd(orphan.money.revenue)} ·
          chi + phí {usd(orphan.money.cost + orphan.money.fees)}.{' '}
          <button className="underline" onClick={() => { setSrc('none'); setPerson(''); setActiveOnly(true); setQ('') }}>Chỉ xem các app này</button>
        </div>
      ) : (
        <div className="mb-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">
          Mọi app có tiền trong khoảng ngày đang xem đều đã có chủ.
        </div>
      )}
      {assign.error && <div className="mb-3"><ErrorBox error={assign.error} /></div>}
      <DataTable
        tableId="ua-app-owner"
        columns={columns}
        rows={shown}
        rowKey={(r) => r.app_id}
        defaultSort={{ id: 'spend', dir: 'desc' }}
        totalRow={total}
        csvName={`ua-gan-app_${s.from}_${s.to}`}
        toolbar={
          <>
            <input className={`${INPUT} w-64`} placeholder="Tìm theo tên app, package, mã app, tag" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={INPUT} value={src} onChange={(e) => setSrc(e.target.value as OwnerFilter)} aria-label="Lọc theo nguồn gán">
              <option value="all">Mọi trạng thái</option>
              <option value="none">Chưa có chủ</option>
              <option value="manual">Gán tay</option>
              <option value="tag">Theo tag</option>
            </select>
            <select className={INPUT} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Lọc theo chủ app">
              <option value="">Mọi chủ app</option>
              {s.people.map((p) => <option key={p.person_key} value={p.person_key}>{p.display_name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Chỉ app có số trong khoảng ngày
            </label>
            <span className="text-xs text-neutral-500">{int(shown.length)} / {int(all.length)} app</span>
          </>
        }
      />
      {shown.length === 0 && <div className="mt-2"><Empty>Không có app nào khớp bộ lọc.</Empty></div>}
      <p className="mt-3 text-xs text-neutral-500">
        Danh sách app lấy từ BBL Dashboard. Hai cột Người thao tác (trên campaign) và Người lên creative (theo Kho creative của
        ZooKeeper; số trong ngoặc = số creative) cho biết ai đang chạy app trong khoảng ngày — gợi ý để chọn chủ. Cột Người lên
        creative chỉ có ở app khớp được tên giữa ZooKeeper và BBL Dashboard. {isAdmin ? 'Bỏ tick "Chỉ app có số" để gán trước cho app chưa phát sinh tiền.' : 'Chỉ admin gán được.'} {ROAS_NOTE}
      </p>
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
            onClick={() => { if (window.confirm(`Xoá mapping của ${initial.display_name}? Thao tác và tiền của người này sẽ về "chưa gán", các app đã gán tay cho người này cũng bị bỏ gán.`)) del.mutate() }}
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
        cell: (p) => (p.bdash_tags.length ? p.bdash_tags.map((t) => <span key={t} className="mr-1"><Badge>#{t}</Badge></span>) : <span className="text-neutral-400">chưa có tag — chỉ nhận app gán tay</span>),
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
        ai — trừ những app đã gán tay ở tab Gán app. Hai thứ này không tự suy ra nhau nên phải khai ở đây. Sửa mapping có
        hiệu lực cho cả dữ liệu cũ.
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

// ----------------------------------------------------------------------------- Tiền theo app (các bảng cũ)
type MoneyView = 'person' | 'app' | 'day'
const MONEY_VIEWS = [['person', 'Theo người'], ['app', 'Theo app'], ['day', 'Theo ngày']] as const

function MoneyTab({ s, unsettledCount }: { s: UaSummary; unsettledCount: number }) {
  const [view, setView] = useState<MoneyView>('person')
  const total = useMemo(() => totalMoney(s), [s])
  const actions = useMemo(() => s.actions.reduce((t, a) => t + Number(a.n), 0), [s])
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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
      <Seg value={view} onChange={setView} options={MONEY_VIEWS} label="Cách xem tiền" />
      {view === 'person' && <Scorecard s={s} />}
      {view === 'app' && <ByApp s={s} />}
      {view === 'day' && <ByDay s={s} />}
    </>
  )
}

// ----------------------------------------------------------------------------- Thiết lập
type SetupView = 'assign' | 'people'
const SETUP_VIEWS = [['assign', 'Gán app'], ['people', 'Mapping người']] as const

function SetupTab({ s, isAdmin, team }: { s: UaSummary; isAdmin: boolean; team: CreativeTeam | null }) {
  const [view, setView] = useState<SetupView>('assign')
  return (
    <>
      <Seg value={view} onChange={setView} options={SETUP_VIEWS} label="Phần thiết lập" />
      {view === 'assign' ? <Assign s={s} isAdmin={isAdmin} team={team} /> : <People s={s} isAdmin={isAdmin} />}
    </>
  )
}

// ----------------------------------------------------------------------------- Trang
/** Biểu đồ lịch lùi tối đa ngần này tuần (một năm, như GitHub). */
const CALENDAR_WEEKS = 53
const isTab = (v: string | null): v is Tab => !!v && TABS.some((t) => t.id === v)
const isDayStr = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

export default function UaReport() {
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  const [from, setFrom] = useState(dayVN(6))
  const [to, setTo] = useState(dayVN(0))
  const [level, setLevel] = useState<UaLevel>('all')
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'overview'
  const personKey = params.get('p') ?? ''
  const day = isDayStr(params.get('day')) ? params.get('day') : null
  const nav = useCallback(
    (next: { tab?: Tab; p?: string | null; day?: string | null }, replace = false) => {
      setParams((prev) => {
        const q = new URLSearchParams(prev)
        const put = (k: string, v: string | null | undefined) => { if (v === undefined) return; if (v) q.set(k, v); else q.delete(k) }
        put('tab', next.tab === 'overview' ? null : next.tab)
        put('p', next.p)
        put('day', next.day)
        return q
      }, { replace })
    },
    [setParams],
  )
  const go = useCallback<Go>((key, d) => nav({ tab: 'person', p: key, day: d ?? null }), [nav])

  const valid = from <= to
  const q = useQuery({
    queryKey: ['ua-report', from, to, level],
    queryFn: () => uaReportSummary(from, to, level),
    enabled: valid,
    placeholderData: (prev) => prev,
  })
  const s = q.data
  // Lịch hoạt động: luôn tính tới hôm nay, không theo khoảng ngày đang chọn.
  const today = dayVN(0)
  const calStart = addDays(mondayOf(today), -7 * (CALENDAR_WEEKS - 1))
  const calQ = useQuery({ queryKey: ['ua-calendar', calStart, today, level], queryFn: () => uaActivityCalendar(calStart, today, level), staleTime: 5 * 60_000 })
  const cal = useMemo(() => indexCalendar(calQ.data), [calQ.data])
  const calFrom = calQ.data?.data_from && calQ.data.data_from > calStart ? calQ.data.data_from : calStart
  // Số Kho creative chỉ cần ở các màn dùng tới nó (không gọi khi đang xem Nhật ký / Tiền theo app).
  const creativeQ = useCreativeTeam(from, to, valid && tab !== 'log' && tab !== 'money')
  const team = creativeQ.data?.status === 'ready' ? creativeQ.data.data : null
  const act = useMemo(() => (s ? buildActivity(s) : new Map()), [s])
  // Danh sách người = ai có hoạt động trong 8 tuần gần nhất hoặc trong khoảng ngày đang xem, cộng người đã khai
  // ở Mapping người mà từng có hoạt động (tài khoản cũ không còn dùng thì không hiện). Bỏ dòng không phải người.
  const roster = useMemo<RosterRow[]>(() => {
    const mapped = new Set((s?.people ?? []).map((p) => p.person_key))
    const recent = addDays(today, -7 * 8)
    const nameOf = new Map<string, string>()
    for (const r of calQ.data?.rows ?? []) {
      if (!r.person_key.startsWith('_') && (r.day >= recent || mapped.has(r.person_key))) nameOf.set(r.person_key, r.person_name)
    }
    for (const a of act.values()) if (!a.key.startsWith('_')) nameOf.set(a.key, a.name)
    for (const p of s?.people ?? []) if (nameOf.has(p.person_key)) nameOf.set(p.person_key, p.display_name)
    return [...nameOf.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [calQ.data, act, s, today])

  // Chip chọn nhanh, cùng kiểu BBL Dashboard: D0 = hôm nay, D-1 = hôm qua … D-6 (mỗi chip MỘT ngày);
  // "7 ngày qua" gộp cả 7 ngày D-6 → D0; "Tháng này" từ ngày 1 tới hôm nay. Ngày tính theo giờ Việt Nam.
  const presets = useMemo(() => {
    const single = [0, 1, 2, 3, 4, 5, 6].map((n) => {
      const d = dayVN(n)
      const hint = n === 0 ? 'Hôm nay' : n === 1 ? 'Hôm qua' : n === 2 ? 'Hôm kia' : `${n} ngày trước`
      return { id: `d${n}`, label: n === 0 ? 'D0' : `D-${n}`, title: `${hint} — ${shortDay(d)}`, from: d, to: d }
    })
    return [
      ...single,
      { id: 'last7', label: '7 ngày qua', title: `Gộp 7 ngày: ${shortDay(dayVN(6))} – ${shortDay(today)}`, from: dayVN(6), to: today },
      { id: 'month', label: 'Tháng này', title: `Từ 01/${today.slice(5, 7)} tới hôm nay`, from: `${today.slice(0, 8)}01`, to: today },
    ]
  }, [today])
  const activePreset = presets.find((p) => p.from === from && p.to === to)?.id ?? null
  // Ngày chưa chốt trong khoảng đang xem: D0 đang chạy, D-1/D-2 còn có thể đổi (xem dayStatus).
  const unsettled = useMemo(() => {
    const days = valid ? daysBetween(from, to) : []
    return { live: days.some((d) => dayStatus(d) === 'live'), pending: days.filter((d) => dayStatus(d) === 'pending').length }
  }, [from, to, valid])
  const unsettledCount = (unsettled.live ? 1 : 0) + unsettled.pending
  const isAdmin = me.data?.role === 'admin'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg">UA activity Report</h1>
        <input type="date" className={INPUT} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Từ ngày" />
        <span className="text-neutral-400">–</span>
        <input type="date" className={INPUT} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Đến ngày" />
        <select className={INPUT} value={level} onChange={(e) => setLevel(e.target.value as UaLevel)} aria-label="Cấp thao tác">
          <option value="all">Mọi cấp</option>
          <option value="campaign">Cấp campaign</option>
          <option value="ad">Cấp ad</option>
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
        Hoạt động của đội UA qua ZooKeeper — creative đưa lên, thao tác trên campaign — cùng kết quả của creative và tiền theo app.
        Ngày theo giờ Việt Nam.
        {s?.sync?.last_success_at && <> Đồng bộ lần cuối {localTime(s.sync.last_success_at)}.</>}
        {calQ.data?.data_from && <> Dữ liệu từ {calQ.data.data_from}.</>}
        {s?.sync?.last_status === 'error' && <span className={BAD}> Lần đồng bộ gần nhất bị lỗi — xem trang Cron jobs.</span>}
      </p>

      {!valid ? (
        <div className="mt-4"><ErrorBox error="Ngày bắt đầu phải không sau ngày kết thúc." /></div>
      ) : q.error ? (
        <div className="mt-4"><ErrorBox error={q.error} /></div>
      ) : !s ? (
        <Loading />
      ) : (() => {
        const view: ViewProps = { s, roster, cal, act, team, creativeQ, go }
        return (
          <>
            {TEAM_TABS.includes(tab) && <TeamStats act={act} team={team} creativeQ={creativeQ} />}

            <div className="mt-6 flex flex-wrap border-b border-neutral-200 text-sm dark:border-neutral-800">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => nav({ tab: t.id, day: null })}
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

            {tab === 'money' && unsettledCount > 0 && (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
                Khoảng này có {unsettledCount} ngày số tiền chưa chốt:
                {unsettled.live && <> hôm nay (D0) đang chạy, cập nhật mỗi giờ{unsettled.pending > 0 ? ';' : '.'}</>}
                {unsettled.pending > 0 && <> {unsettled.pending} ngày liền trước (D-1, D-2) còn có thể đổi, cập nhật vài giờ một lần.</>}
                {' '}Từ D-3 trở về trước coi như đã ổn định.
              </p>
            )}
            {calQ.error && tab !== 'money' && tab !== 'log' && tab !== 'setup' && <div className="mt-3"><ErrorBox error={calQ.error} /></div>}

            <div className={`mt-4 ${q.isFetching ? 'opacity-60' : ''}`}>
              {tab === 'overview' && <Overview {...view} />}
              {tab === 'workload' && <Workload {...view} />}
              {tab === 'alloc' && <Allocation {...view} />}
              {tab === 'results' && <Results {...view} />}
              {tab === 'person' && (
                <PersonPage {...view} personKey={personKey} day={day} level={level} calFrom={calFrom}
                  onPickPerson={(key) => nav({ p: key, day: null })} onPickDay={(d) => nav({ day: d }, true)} />
              )}
              {tab === 'log' && <ActionLog s={s} level={level} />}
              {tab === 'money' && <MoneyTab s={s} unsettledCount={unsettledCount} />}
              {tab === 'setup' && <SetupTab s={s} isAdmin={isAdmin} team={team} />}
            </div>
          </>
        )
      })()}
    </div>
  )
}
