// [3.53.0] Trang riêng của từng UA: bốn ô số của kỳ, biểu đồ lịch hoạt động (kiểu contribution của GitHub,
// mỗi ô một ngày, bấm để xem ngày đó), loại hoạt động, app tập trung, creative mới kèm kết quả, và nhật
// ký thao tác của riêng người đó. Mở bằng cách bấm tên người ở bất kỳ màn nào, hoặc tab "Từng UA".
import { useMemo } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import {
  ACT_KINDS,
  ACT_KIND_LABEL,
  addDays,
  creativeRoas,
  dayVN,
  int,
  mondayOf,
  pct,
  shortDay,
  testedLabel,
  usd,
  weekdayVN,
  type CreativeApp,
  type CreativeItem,
  type CreativeItems,
  type CreativePerson,
  type PipelineReply,
  type UaApp,
  type UaLevel,
  type UaSummary,
} from '../../lib/uaReport'
import DataTable, { type Column, type TotalRow } from '../../components/DataTable'
import { Badge, Empty, Stat } from '../../components/ui'
import ActionLog from './ActionLog'
import { KIND_COLOR, RoasCell, WinPill, focusApps, shortApp } from './Activity'
import {
  AppIconImg,
  BTN,
  CreativeNote,
  DASH,
  HeatCell,
  HeatLegend,
  INPUT,
  MUTED,
  ZERO_ACTIVITY,
  creativeOf,
  dayCountOf,
  hhmm,
  useCreativeItems,
  type CalIndex,
  type ViewProps,
} from './shared'

const GAP = 3
const WEEKDAY_FULL: Record<string, string> = { T2: 'Thứ Hai', T3: 'Thứ Ba', T4: 'Thứ Tư', T5: 'Thứ Năm', T6: 'Thứ Sáu', T7: 'Thứ Bảy', CN: 'Chủ nhật' }
const fullDay = (d: string) => `${WEEKDAY_FULL[weekdayVN(d)]} ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** Biểu đồ lịch: cột = tuần (thứ Hai trên cùng), hàng = thứ. */
function Calendar({ cal, personKey, from, day, onPick }: { cal: CalIndex; personKey: string; from: string; day: string | null; onPick: (d: string) => void }) {
  const today = dayVN(0)
  const weeks = useMemo(() => {
    const first = mondayOf(from)
    const n = Math.max(1, Math.ceil((Date.parse(mondayOf(today)) - Date.parse(first)) / (7 * 86_400_000)) + 1)
    return Array.from({ length: n }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)))
  }, [from, today])
  // Ít tuần thì ô to (dễ bấm), đủ một năm thì ô nhỏ cho vừa bề ngang.
  const CELL = weeks.length <= 20 ? 20 : weeks.length <= 32 ? 16 : 13
  const row = { height: CELL, lineHeight: `${CELL}px` }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <div className={`mt-5 flex flex-none flex-col text-[11px] ${MUTED}`} style={{ gap: GAP }}>
        {['T2', '', 'T4', '', 'T6', '', 'CN'].map((t, i) => <span key={i} style={row}>{t}</span>)}
      </div>
      <div>
        <div className="flex h-5" style={{ gap: GAP }}>
          {weeks.map((w, i) => {
            const m = w[6].slice(5, 7) // tháng của Chủ nhật: tuần vắt hai tháng mang nhãn tháng sau
            const show = i === 0 || weeks[i - 1][6].slice(5, 7) !== m
            return <span key={w[0]} className={`flex-none overflow-visible whitespace-nowrap text-[11px] ${MUTED}`} style={{ width: CELL }}>{show ? `Th${Number(m)}` : ''}</span>
          })}
        </div>
        <div className="flex" style={{ gap: GAP }}>
          {weeks.map((w) => (
            <div key={w[0]} className="flex flex-none flex-col" style={{ gap: GAP }}>
              {w.map((d) => (
                <HeatCell key={d} day={d} c={dayCountOf(cal, personKey, d)} size={CELL} blank={d > today || d < from} selected={d === day} onClick={() => onPick(d)} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const STATUS: Record<string, { label: string; tone?: 'good' }> = {
  win: { label: 'Win', tone: 'good' },
  not_ok: { label: 'Dưới ngưỡng' },
  testing: { label: 'Đang thử' },
  untested: { label: 'Chưa chi' },
}
const ITEM_COLUMNS: Column<CreativeItem>[] = [
  {
    id: 'file', header: 'Creative', locked: true, sortValue: (r) => r.file_name ?? r.key, className: 'max-w-80',
    cell: (r) => (
      <div className="truncate" title={r.file_name ?? r.key}>
        {r.file_name ?? <span className={MUTED}>{r.key}</span>}
        {r.media_type && <span className={`ml-1.5 text-[11px] ${MUTED}`}>{r.media_type}</span>}
      </div>
    ),
  },
  { id: 'app', header: 'App', sortValue: (r) => r.app, cell: (r) => (r.app ? <span title={r.app}>{shortApp(r.app)}</span> : DASH) },
  { id: 'platform', header: 'Nền tảng', sortValue: (r) => r.platform, cell: (r) => r.platform ?? DASH },
  { id: 'uploaded_at', header: 'Lên lúc', sortValue: (r) => r.uploaded_at, csvValue: (r) => r.uploaded_at, className: 'whitespace-nowrap', cell: (r) => hhmm(r.uploaded_at) || DASH },
  { id: 'spend', header: 'Chi', align: 'right', sortValue: (r) => r.spend, cell: (r) => (r.spend ? usd(r.spend) : <span className="text-neutral-300 dark:text-neutral-700">$0</span>) },
  { id: 'revenue', header: 'Doanh thu Adjust', align: 'right', defaultHidden: true, sortValue: (r) => r.revenue, cell: (r) => usd(r.revenue) },
  { id: 'roas', header: 'ROAS', align: 'right', sortValue: (r) => creativeRoas(r), cell: (r) => pct(creativeRoas(r)) },
  {
    id: 'status', header: 'Trạng thái', sortValue: (r) => r.status,
    cell: (r) => { const st = STATUS[r.status ?? '']; return st ? <Badge tone={st.tone ?? 'neutral'}>{st.label}</Badge> : r.status ?? DASH },
  },
  { id: 'live', header: 'Còn chạy', defaultHidden: true, sortValue: (r) => (r.live ? 1 : 0), csvValue: (r) => (r.live ? 'có' : 'không'), cell: (r) => (r.live ? 'có' : <span className={MUTED}>không</span>) },
  { id: 'ads', header: 'Số ad', align: 'right', defaultHidden: true, sortValue: (r) => r.ad_count, cell: (r) => int(r.ad_count) },
]

function CreativeItemsTable({ q, tableId, csvName, emptyText }: { q: UseQueryResult<PipelineReply<CreativeItems>>; tableId: string; csvName: string; emptyText: string }) {
  const d = q.data?.status === 'ready' ? q.data.data : null
  return (
    <>
      <CreativeNote q={q} what="Danh sách creative" />
      {d && (d.items.length ? (
        <>
          <div className={d.items.length > 12 ? 'max-h-[30rem] overflow-y-auto rounded-lg' : ''}>
            <DataTable tableId={tableId} columns={ITEM_COLUMNS} rows={d.items} rowKey={(r) => r.key} defaultSort={{ id: 'uploaded_at', dir: 'desc' }} csvName={csvName} />
          </div>
          {d.items_total > d.items.length && <p className={`mt-2 text-xs ${MUTED}`}>Hiện {int(d.items.length)} creative mới nhất trong {int(d.items_total)}.</p>}
        </>
      ) : <Empty>{emptyText}</Empty>)}
    </>
  )
}

function DayDetail(p: ViewProps & { personKey: string; day: string; level: UaLevel; onClose: () => void }) {
  const { s, cal, personKey, day, level, onClose } = p
  const c = dayCountOf(cal, personKey, day)
  const items = useCreativeItems(day, day, personKey, c.u > 0)
  return (
    <div className="mt-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <span className="font-medium">{fullDay(day)}</span>
          <span className={`ml-2 text-sm ${MUTED}`}>{c.u + c.a ? `${int(c.u)} creative lên · ${int(c.a)} thao tác` : 'không có hoạt động ghi nhận'}</span>
        </div>
        <button className={BTN} onClick={onClose}>Bỏ chọn ngày</button>
      </div>
      {c.u > 0 && (
        <div className="mt-3">
          <div className={`mb-1.5 text-xs ${MUTED}`}>Creative lên trong ngày (chi và ROAS tính riêng ngày này)</div>
          <CreativeItemsTable q={items} tableId="ua-person-day-creatives" csvName={`ua-creative_${personKey}_${day}`} emptyText="ZooKeeper không trả creative mới nào của người này trong ngày." />
        </div>
      )}
      {c.a > 0 && (
        <div className="mt-4">
          <div className={`mb-1.5 text-xs ${MUTED}`}>Thao tác trong ngày</div>
          <ActionLog s={s} level={level} fixedPerson={personKey} from={day} to={day} tableId="ua-person-day-log" pageSize={20} />
        </div>
      )}
    </div>
  )
}

type PersonAppRow = CreativeApp & { ua: UaApp | null }
const PERSON_APP_TOTAL = ['new', 'creatives', 'spend', 'revenue', 'roas', 'tested', 'win']

/** [3.53.2] Bảng theo app của một người: Avg ROAS ở ô số đầu trang là số GỘP mọi app (app chi nhiều kéo con số
 *  về phía nó), nên cần thấy ROAS từng app để biết app nào đang tốt, app nào đang kéo xuống. */
function PersonApps({ cr, s, minSpend, csvName }: { cr: CreativePerson; s: UaSummary; minSpend: number | undefined; csvName: string }) {
  const rows = useMemo<PersonAppRow[]>(() => {
    const appOf = new Map(s.apps.map((a) => [a.app_id, a]))
    return cr.apps.filter((a) => a.creatives > 0 || a.spend > 0).map((a) => ({ ...a, ua: a.app_id ? appOf.get(a.app_id) ?? null : null }))
  }, [cr, s.apps])
  const columns = useMemo<Column<PersonAppRow>[]>(
    () => [
      {
        id: 'app', header: 'App', locked: true, sortValue: (r) => r.ua?.app_name ?? r.app,
        cell: (r) => (
          <div className="flex items-center gap-2.5">
            <AppIconImg url={r.ua?.icon_url} name={r.ua?.app_name ?? r.app} size={24} />
            <span title={`Tên trên ZooKeeper: ${r.app}`}>{r.ua?.app_name ?? r.app}</span>
          </div>
        ),
        totalCell: () => null,
      },
      { id: 'new', header: 'Creative mới', align: 'right', sortValue: (r) => r.new, cell: (r) => (r.new ? int(r.new) : <span className="text-neutral-300 dark:text-neutral-700">0</span>) },
      { id: 'creatives', header: 'Đang chạy', align: 'right', sortValue: (r) => r.creatives, cell: (r) => int(r.creatives) },
      { id: 'spend', header: 'Đã chi', align: 'right', sortValue: (r) => r.spend, cell: (r) => usd(r.spend) },
      { id: 'revenue', header: 'Doanh thu Adjust', align: 'right', sortValue: (r) => r.revenue, cell: (r) => usd(r.revenue) },
      {
        id: 'roas', header: 'ROAS', align: 'right', sortValue: (r) => creativeRoas(r), csvValue: (r) => creativeRoas(r),
        cell: (r) => <RoasCell a={r} min={minSpend} />,
      },
      { id: 'win', header: 'Win', align: 'right', sortValue: (r) => r.win, cell: (r) => <WinPill a={r} min={minSpend} /> },
      { id: 'tested', header: testedLabel(minSpend).replace(/^c/, 'C'), align: 'right', defaultHidden: true, sortValue: (r) => r.tested, cell: (r) => int(r.tested) },
    ],
    [minSpend],
  )
  const total = useMemo<TotalRow<PersonAppRow>>(
    () => ({ row: { ...cr, app: 'Tổng', app_id: null, ua: null }, columns: PERSON_APP_TOTAL, label: `Tổng ${int(rows.length)} app (Avg ROAS)` }),
    [cr, rows.length],
  )
  if (!rows.length) return <Empty>Không có creative nào của người này chạy trong khoảng ngày đang chọn.</Empty>
  return (
    <>
      <DataTable tableId="ua-person-apps-2" columns={columns} rows={rows} rowKey={(r) => r.app} defaultSort={{ id: 'spend', dir: 'desc' }} totalRow={total} csvName={csvName} />
      <p className={`mt-2 text-xs ${MUTED}`}>
        ROAS = doanh thu Adjust / chi của các creative người này có trên app đó trong kỳ. Dòng Tổng là Avg ROAS ở ô số đầu trang: tổng doanh thu / tổng chi
        của mọi app, nên app chi nhiều kéo con số về phía nó. Win = số creative win của người này trên app đó.
      </p>
    </>
  )
}

/** Thanh ngang có nhãn + số, dùng cho Loại hoạt động và App tập trung. */
function Bar({ label, title, value, max, color }: { label: string; title?: string; value: number; max: number; color: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 text-sm">
      <span className="w-32 flex-none truncate" title={title ?? label}>{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
        <div className="h-full" style={{ width: `${max > 0 ? ((value / max) * 100).toFixed(0) : 0}%`, backgroundColor: color }} />
      </div>
      <span className={`w-12 flex-none text-right text-xs tabular-nums ${MUTED}`}>{int(value)}</span>
    </div>
  )
}

export default function PersonPage(p: ViewProps & {
  personKey: string
  day: string | null
  level: UaLevel
  /** Ngày đầu của biểu đồ lịch (ngày sớm nhất có dữ liệu, tối đa một năm). */
  calFrom: string
  onPickPerson: (key: string) => void
  onPickDay: (day: string | null) => void
}) {
  const { s, roster, cal, act, team, creativeQ, personKey, day, level, calFrom, onPickPerson, onPickDay } = p
  const person = roster.find((r) => r.key === personKey)
  const items = useCreativeItems(s.from, s.to, personKey, !!person)
  const total = useMemo(() => {
    let t = 0
    for (const [d, c] of cal.get(personKey) ?? []) if (d >= calFrom) t += c.u + c.a
    return t
  }, [cal, personKey, calFrom])

  const picker = (
    <select className={`${INPUT} w-56`} value={person ? personKey : ''} onChange={(e) => e.target.value && onPickPerson(e.target.value)} aria-label="Chọn UA">
      {!person && <option value="">Chọn một người…</option>}
      {roster.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
    </select>
  )
  if (!person) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {picker}
        <span className={`text-sm ${MUTED}`}>Chọn một người để mở trang riêng, hoặc bấm tên ở các màn khác.</span>
      </div>
    )
  }

  const a = act.get(personKey) ?? ZERO_ACTIVITY(personKey, person.name)
  const cr = creativeOf(team, personKey)
  const apps = focusApps(cr)
  const initials = person.name.split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase()
  const waiting = creativeQ.data?.status === 'pending' || creativeQ.isLoading ? 'đang lấy từ ZooKeeper…' : undefined
  const range = `${shortDay(s.from)} – ${shortDay(s.to)}`
  const kindMax = Math.max(1, ...ACT_KINDS.map((k) => a.kinds[k]))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary-50 font-medium text-primary-700 dark:bg-primary-950 dark:text-primary-300">{initials}</div>
        <div className="mr-auto min-w-0">
          <div className="text-base font-medium">{person.name}</div>
          <div className={`truncate text-sm ${MUTED}`}>{apps.length ? apps.slice(0, 4).map((x) => shortApp(x.app)).join(' · ') : team ? 'Chưa có app tập trung trong kỳ' : ' '}</div>
        </div>
        {picker}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Creative mới" value={cr ? int(cr.new) : team ? '0' : '—'} hint={waiting ?? `${range} · ${int(a.kinds.upload)} lượt lên theo lịch`} />
        <Stat label="Thao tác campaign" value={int(a.actions)} hint={`${range} · tạo, bật / tắt, chỉnh ngân sách`} />
        <Stat label="Chi quảng cáo" value={cr ? usd(cr.spend) : '—'} hint={waiting ?? (cr ? `doanh thu Adjust ${usd(cr.revenue)}` : undefined)} />
        <Stat label="Avg ROAS" value={cr ? <RoasCell a={cr} min={team?.min_spend} /> : '—'} hint={waiting ?? (cr ? 'gộp mọi app: doanh thu Adjust / chi' : undefined)} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="mr-auto font-medium">{int(total)} hoạt động từ tháng {Number(calFrom.slice(5, 7))}/{calFrom.slice(0, 4)}</span>
        <HeatLegend />
      </div>
      <div className="mt-2">
        <Calendar cal={cal} personKey={personKey} from={calFrom} day={day} onPick={(d) => onPickDay(d === day ? null : d)} />
      </div>
      <p className={`mt-1 text-xs ${MUTED}`}>Mỗi ô một ngày: creative lên + thao tác campaign. Rê chuột để xem số, bấm để mở ngày đó.</p>
      {day && <DayDetail {...p} personKey={personKey} day={day} level={level} onClose={() => onPickDay(null)} />}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <div className={`mb-2 text-xs ${MUTED}`}>Loại hoạt động · {range}</div>
          {a.total ? ACT_KINDS.filter((k) => k !== 'other' || a.kinds.other > 0).map((k) => (
            <Bar key={k} label={ACT_KIND_LABEL[k]} value={a.kinds[k]} max={kindMax} color={KIND_COLOR[k]} />
          )) : <div className={`text-sm ${MUTED}`}>Không có hoạt động ghi nhận trong khoảng ngày này.</div>}
        </div>
        <div>
          <div className={`mb-2 text-xs ${MUTED}`}>App tập trung (theo creative) · {range}</div>
          {apps.length ? apps.slice(0, 6).map((x) => (
            <Bar key={x.app} label={shortApp(x.app)} title={x.app} value={x.n} max={apps[0].n} color={KIND_COLOR.upload} />
          )) : <div className={`text-sm ${MUTED}`}>{team ? '—' : waiting ?? '—'}</div>}
        </div>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Theo app · {range}</h2>
      {cr ? (
        <PersonApps cr={cr} s={s} minSpend={team?.min_spend} csvName={`ua-theo-app_${personKey}_${s.from}_${s.to}`} />
      ) : team ? (
        <Empty>Không có creative nào của người này chạy trong khoảng ngày đang chọn.</Empty>
      ) : (
        <CreativeNote q={creativeQ} />
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold">Creative mới trong kỳ · {range}</h2>
      <CreativeItemsTable q={items} tableId="ua-person-creatives" csvName={`ua-creative_${personKey}_${s.from}_${s.to}`} emptyText="Không có creative mới nào của người này trong khoảng ngày đang chọn." />

      <h2 className="mb-2 mt-8 text-sm font-semibold">Nhật ký thao tác · {range}</h2>
      <ActionLog s={s} level={level} fixedPerson={personKey} tableId="ua-person-log" />
    </div>
  )
}
