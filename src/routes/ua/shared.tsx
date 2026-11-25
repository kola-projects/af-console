// [3.53.0] Phần dùng chung của trang UA activity report: kiểu nút/ô nhập, icon app, ô lịch hoạt động,
// và hook lấy số Kho creative (edge function ua-creative-pipeline).
//
// GIỌNG CHỮ của cả trang: trung tính. Tên màn / tên cột là danh từ (Workload, Phân bổ, Kết quả, Loại hoạt
// động, App tập trung); không đặt câu hỏi về con người, không đếm "x/y ngày", không tô đỏ ngày trống —
// ngày không có hoạt động ghi nhận chỉ là một ô xám như biểu đồ contribution của GitHub.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  CREATIVE_MAX_DAYS,
  daysBetween,
  heatLevel,
  shortDay,
  uaCreativePipeline,
  weekdayVN,
  type CreativeItems,
  type CreativePerson,
  type CreativeTeam,
  type PersonActivity,
  type PipelineReply,
  type UaApp,
  type UaCalendar,
  type UaSummary,
} from '../../lib/uaReport'
import { Badge, Mono } from '../../components/ui'

export const INPUT =
  'rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
export const BTN =
  'rounded border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900'
export const BAD = 'text-red-700 dark:text-red-300'
export const DASH = <span className="text-neutral-400">—</span>
export const MUTED = 'text-neutral-500 dark:text-neutral-400'

/** Icon app từ BBL Dashboard; không có (hoặc tải lỗi) thì hiện ô chữ cái đầu — cùng kiểu trang Quản lý app. */
export function AppIconImg({ url, name, size = 28 }: { url: string | null | undefined; name: string; size?: number }) {
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
export function AppLabel({ app, id, name }: { app: UaApp | null; id: string; name: string }) {
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

// ----------------------------------------------------------------------------- lịch hoạt động
export type DayCount = { u: number; a: number }
/** person_key → ngày → { u: creative lên, a: thao tác }. */
export type CalIndex = Map<string, Map<string, DayCount>>
const NO_DAY: DayCount = { u: 0, a: 0 }

export function indexCalendar(cal: UaCalendar | undefined): CalIndex {
  const m: CalIndex = new Map()
  for (const r of cal?.rows ?? []) {
    let p = m.get(r.person_key)
    if (!p) {
      p = new Map()
      m.set(r.person_key, p)
    }
    p.set(r.day, { u: Number(r.uploads), a: Number(r.actions) })
  }
  return m
}
export const dayCountOf = (cal: CalIndex, key: string, day: string): DayCount => cal.get(key)?.get(day) ?? NO_DAY
export const sumDays = (cal: CalIndex, key: string, days: string[]) => days.reduce((t, d) => { const c = dayCountOf(cal, key, d); return t + c.u + c.a }, 0)

// Thang xanh 5 mức; nền tối dùng thang của GitHub (càng sáng càng nhiều).
const HEAT = [
  'bg-neutral-100 dark:bg-neutral-800',
  'bg-[#C0DD97] dark:bg-[#0e4429]',
  'bg-[#97C459] dark:bg-[#006d32]',
  'bg-[#639922] dark:bg-[#26a641]',
  'bg-[#3B6D11] dark:bg-[#39d353]',
]

export function dayTitle(day: string, c: DayCount): string {
  const head = `${weekdayVN(day)} ${shortDay(day)}`
  return c.u + c.a === 0 ? `${head}: không có hoạt động ghi nhận` : `${head}: ${c.u} creative lên · ${c.a} thao tác`
}

/** Một ô = một ngày, đậm dần theo số hoạt động (creative lên + thao tác). `blank` = ngày chưa tới. */
export function HeatCell({ day, c, size = 12, onClick, selected = false, blank = false }: {
  day: string; c: DayCount; size?: number; onClick?: () => void; selected?: boolean; blank?: boolean
}) {
  const box = { width: size, height: size }
  if (blank) return <span className="inline-block flex-none" style={box} />
  const cls = `inline-block flex-none rounded-[2px] ${HEAT[heatLevel(c.u + c.a)]} ${selected ? 'ring-2 ring-primary-600 ring-offset-1 dark:ring-offset-neutral-950' : ''}`
  return onClick ? (
    <button type="button" title={dayTitle(day, c)} aria-label={dayTitle(day, c)} onClick={onClick} className={`${cls} cursor-pointer hover:opacity-80`} style={box} />
  ) : (
    <span title={dayTitle(day, c)} className={cls} style={box} />
  )
}

export function HeatLegend() {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${MUTED}`}>
      Ít
      {HEAT.map((h) => <span key={h} className={`inline-block h-[11px] w-[11px] rounded-[2px] ${h}`} />)}
      Nhiều
    </span>
  )
}

/** Dải ô liền nhau cho một người. */
export function DayStrip({ cal, personKey, days, size = 12, onPick }: {
  cal: CalIndex; personKey: string; days: string[]; size?: number; onPick?: (day: string) => void
}) {
  return (
    <span className="inline-flex gap-[2px] align-middle">
      {days.map((d) => (
        <HeatCell key={d} day={d} c={dayCountOf(cal, personKey, d)} size={size} onClick={onPick ? () => onPick(d) : undefined} />
      ))}
    </span>
  )
}

// ----------------------------------------------------------------------------- người
export type RosterRow = { key: string; name: string }
export type Go = (personKey: string, day?: string) => void

/** Tên người, bấm để mở trang riêng. Dòng không phải một người (khoá bắt đầu bằng _) thì chỉ là chữ. */
export function PersonLink({ row, go }: { row: RosterRow; go: Go }) {
  if (row.key.startsWith('_')) return <span className={MUTED}>{row.name}</span>
  return (
    <button type="button" className="text-left text-primary-700 hover:underline dark:text-primary-300" onClick={(e) => { e.stopPropagation(); go(row.key) }}>
      {row.name}
    </button>
  )
}

export const ZERO_ACTIVITY = (key: string, name: string): PersonActivity => ({
  key, name, kinds: { upload: 0, create: 0, status: 0, budget: 0, other: 0 }, total: 0, actions: 0,
})

/** Mọi thứ các màn hoạt động cần, dựng một lần ở trang. */
export type ViewProps = {
  s: UaSummary
  roster: RosterRow[]
  cal: CalIndex
  act: Map<string, PersonActivity>
  /** Số Kho creative của khoảng ngày đang xem; null khi chưa có (đang lấy / lỗi / quá 31 ngày). */
  team: CreativeTeam | null
  creativeQ: UseQueryResult<PipelineReply<CreativeTeam>>
  go: Go
}
export const creativeOf = (team: CreativeTeam | null, key: string): CreativePerson | null => team?.people.find((p) => p.person_key === key) ?? null

// ----------------------------------------------------------------------------- Kho creative
const pollMs = (d: PipelineReply<unknown> | undefined) => (d?.status === 'pending' ? 4000 : d?.status === 'ready' && d.refreshing ? 15000 : false)
const TOO_LONG: PipelineReply<never> = {
  status: 'error', code: 'range_too_long',
  error: `Số Kho creative chỉ xem được tối đa ${CREATIVE_MAX_DAYS} ngày một lần (giới hạn của ZooKeeper) — thu hẹp khoảng ngày để xem.`,
}

/** Số Kho creative cả đội cho [from, to]. Đang lấy lần đầu thì tự hỏi lại mỗi 4 giây tới khi có. */
export function useCreativeTeam(from: string, to: string, enabled = true) {
  const tooLong = daysBetween(from, to).length > CREATIVE_MAX_DAYS
  return useQuery({
    queryKey: ['ua-creative', from, to, '*'],
    queryFn: () => (tooLong ? Promise.resolve<PipelineReply<CreativeTeam>>(TOO_LONG) : uaCreativePipeline<CreativeTeam>({ from, to })),
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: (q) => pollMs(q.state.data),
  })
}

/** Creative mới của một người trong [from, to] (tối đa 100, mới nhất trước). */
export function useCreativeItems(from: string, to: string, personKey: string, enabled = true) {
  const tooLong = daysBetween(from, to).length > CREATIVE_MAX_DAYS
  return useQuery({
    queryKey: ['ua-creative', from, to, personKey, 'items'],
    queryFn: () => (tooLong ? Promise.resolve<PipelineReply<CreativeItems>>(TOO_LONG) : uaCreativePipeline<CreativeItems>({ from, to, person_key: personKey, items: true })),
    enabled: enabled && !!personKey,
    staleTime: 5 * 60_000,
    refetchInterval: (q) => pollMs(q.state.data),
  })
}

/** Giờ địa phương của người xem: 14:20 25/11. */
export const hhmm = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return Number.isNaN(d.getTime()) ? '' : `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`
}

/** Dòng trạng thái của số Kho creative: đang lấy / lỗi / lấy lúc nào. `what` = tên phần đang chờ. */
export function CreativeNote({ q, what = 'Số Kho creative' }: { q: UseQueryResult<PipelineReply<unknown>>; what?: string }) {
  const d = q.data
  const box = 'rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300'
  if (q.error) return <div className={box}>{what}: không hỏi được máy chủ ({q.error instanceof Error ? q.error.message : String(q.error)}). <button className="underline" onClick={() => q.refetch()}>Thử lại</button></div>
  if (!d) return <div className={box}>Đang hỏi {what.toLowerCase()}…</div>
  if (d.status === 'pending') {
    return (
      <div className={box}>
        Đang lấy {what.toLowerCase()} từ ZooKeeper cho khoảng ngày này — lần đầu mất khoảng {d.eta_s} giây, trang tự cập nhật khi có.
        Các khoảng hay xem (hôm nay, 7 ngày qua, tháng này, từng ngày D-1 … D-6) được lấy sẵn mỗi giờ nên mở ra là có.
      </div>
    )
  }
  if (d.status === 'error') {
    return (
      <div className={box}>
        {d.code === 'range_too_long' ? d.error : <>{what}: chưa lấy được ({d.error}).</>}{' '}
        {d.code !== 'range_too_long' && <button className="underline" onClick={() => q.refetch()}>Thử lại</button>}
      </div>
    )
  }
  return null
}

/** "Kho creative lấy lúc 14:20 25/11" — để biết số mới tới đâu. */
export function CreativeStamp({ q }: { q: UseQueryResult<PipelineReply<unknown>> }) {
  const d = q.data
  if (d?.status !== 'ready') return null
  return <>Số Kho creative lấy từ ZooKeeper lúc {hhmm(d.fetched_at)}{d.refreshing ? ' (đang cập nhật)' : ''}.</>
}
