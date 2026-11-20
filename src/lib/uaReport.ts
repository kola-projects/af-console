// [3.51.0] UA activity report — kiểu dữ liệu, truy vấn và phép gom số cho trang /ua-report.
//
// Nguồn: RPC ua_report_summary (migration 0058/0059) trả dữ liệu đã gom theo ngày; mọi phép gom
// tiếp theo (theo người / app / ngày) làm ở client vì dữ liệu nhỏ và đổi tab không cần gọi lại.
//
// HAI KHUNG GÁN KHÁC NHAU — đừng trộn:
//   • THAO TÁC gán theo người đã thao tác trên ZooKeeper (email đăng nhập zk → ua_people).
//   • TIỀN gán theo chủ sở hữu app (tag người trên BBL Dashboard → ua_people.bdash_tags).
// Tiền là USD. Doanh thu = AdMob + MAX + IAP + nhập tay; lãi = doanh thu − chi ads − phí;
// ROAS = doanh thu / (chi ads + phí) — đúng cách tính của BBL Dashboard.
import { supabase } from './supabase'

export type UaLevel = 'campaign' | 'ad' | 'all'

export type UaActionAgg = {
  day: string
  person_key: string
  person_name: string
  app_id: string | null
  platform: string | null
  bucket: 'create' | 'update'
  n: number
}
export type UaMoneyRow = {
  day: string
  app_id: string
  revenue: number
  cost: number
  fees: number
  installs: number
}
export type UaApp = {
  app_id: string
  app_name: string | null
  tags: string[]
  af_app_id: number | null
  /** Icon từ BBL Dashboard (CDN Play / App Store); null với app chưa có trên store hoặc dòng UNKNOWN. */
  icon_url: string | null
  platform: string | null
  app_code: string | null
  af_name: string | null
  owner_key: string | null
}
export type UaPerson = {
  person_key: string
  display_name: string
  zk_emails: string[]
  bdash_tags: string[]
  note: string | null
}
export type UaSummary = {
  from: string
  to: string
  level: string
  actions: UaActionAgg[]
  money: UaMoneyRow[]
  apps: UaApp[]
  people: UaPerson[]
  data_from: string | null
  data_to: string | null
  sync: { last_run_id: number; last_status: string; last_started_at: string; last_success_at: string | null } | null
}

export async function uaReportSummary(from: string, to: string, level: UaLevel): Promise<UaSummary> {
  const { data, error } = await supabase.rpc('ua_report_summary', { p_from: from, p_to: to, p_level: level })
  if (error) throw new Error(error.message)
  return data as UaSummary
}

export type UaActionLogRow = {
  id: string
  occurred_at: string
  person_key: string
  person_name: string
  app_id: string | null
  app_name: string | null
  af_app_id: number | null
  app_icon_url: string | null
  platform: string | null
  level: string | null
  action_type: string | null
  source: string | null
  outcome: string | null
  entity_name: string | null
  account_id: string | null
  changes: Record<string, unknown> | null
}
export type UaLogFilter = {
  from: string
  to: string
  level: UaLevel
  person?: string
  actionType?: string
  source?: string
  search?: string
  /** Cột của view để server sắp xếp (bảng phân trang nên không sắp ở client). */
  sortBy: UaLogSortColumn
  ascending: boolean
  page: number
  pageSize: number
}

export const UA_LOG_SORT_COLUMNS = [
  'occurred_at', 'person_name', 'app_name', 'platform', 'level', 'action_type', 'source', 'entity_name', 'outcome', 'account_id',
] as const
export type UaLogSortColumn = (typeof UA_LOG_SORT_COLUMNS)[number]

export async function uaActionLog(f: UaLogFilter): Promise<{ rows: UaActionLogRow[]; total: number }> {
  const start = f.page * f.pageSize
  let q = supabase
    .from('v_ua_actions')
    .select(
      'id, occurred_at, person_key, person_name, app_id, app_name, af_app_id, app_icon_url, platform, level, action_type, source, outcome, entity_name, account_id, changes',
      { count: 'exact' },
    )
    .gte('day', f.from)
    .lte('day', f.to)
    .order(f.sortBy, { ascending: f.ascending, nullsFirst: false })
    .order('id', { ascending: true }) // khoá phụ để thứ tự ổn định giữa các trang
    .range(start, start + f.pageSize - 1)
  if (f.level !== 'all') q = q.eq('level', f.level)
  if (f.person) q = q.eq('person_key', f.person)
  if (f.actionType) q = q.eq('action_type', f.actionType)
  if (f.source) q = q.eq('source', f.source)
  if (f.search?.trim()) q = q.ilike('entity_name', `%${f.search.trim().replace(/[%_]/g, '')}%`)
  const { data, error, count } = await q
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as UaActionLogRow[], total: count ?? 0 }
}

export async function saveUaPerson(p: UaPerson): Promise<void> {
  const { error } = await supabase.from('ua_people').upsert(
    {
      person_key: p.person_key.trim().toLowerCase(),
      display_name: p.display_name.trim(),
      zk_emails: p.zk_emails,
      bdash_tags: p.bdash_tags,
      note: p.note?.trim() || null,
    },
    { onConflict: 'person_key' },
  )
  if (error) throw new Error(error.message)
}

export async function deleteUaPerson(personKey: string): Promise<void> {
  const { error } = await supabase.from('ua_people').delete().eq('person_key', personKey)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Phép gom số
// ---------------------------------------------------------------------------
export type Money = { revenue: number; cost: number; fees: number; installs: number }
export const ZERO_MONEY: Money = { revenue: 0, cost: 0, fees: 0, installs: 0 }

export const profitOf = (m: Money) => m.revenue - m.cost - m.fees
/** ROAS % = doanh thu / (chi ads + phí). null khi chưa chi đồng nào. */
export const roasOf = (m: Money) => (m.cost + m.fees > 0 ? (m.revenue / (m.cost + m.fees)) * 100 : null)

function addMoney(a: Money, b: Money): Money {
  return {
    revenue: a.revenue + Number(b.revenue || 0),
    cost: a.cost + Number(b.cost || 0),
    fees: a.fees + Number(b.fees || 0),
    installs: a.installs + Number(b.installs || 0),
  }
}

export const UNASSIGNED = '_unassigned'
export const UNKNOWN_PERSON = '_unknown'

export type ScoreRow = {
  key: string
  name: string
  create: number
  update: number
  /** Tiền của các app người này SỞ HỮU; null = không sở hữu app nào có số trong khoảng ngày. */
  money: Money | null
  /** Dòng "tiền chưa gán người" — không phải một người. */
  synthetic: boolean
}

export function buildScorecard(s: UaSummary): ScoreRow[] {
  const appOf = new Map(s.apps.map((a) => [a.app_id, a]))
  const nameOf = new Map(s.people.map((p) => [p.person_key, p.display_name]))
  const rows = new Map<string, ScoreRow>()
  const get = (key: string, name: string, synthetic = false) => {
    let r = rows.get(key)
    if (!r) {
      r = { key, name, create: 0, update: 0, money: null, synthetic }
      rows.set(key, r)
    }
    return r
  }
  for (const a of s.actions) {
    const r = get(a.person_key, nameOf.get(a.person_key) ?? a.person_name)
    if (a.bucket === 'create') r.create += Number(a.n)
    else r.update += Number(a.n)
  }
  for (const m of s.money) {
    const owner = appOf.get(m.app_id)?.owner_key ?? null
    const r = owner
      ? get(owner, nameOf.get(owner) ?? owner)
      : get(UNASSIGNED, 'Chưa gán người (app không có tag người)', true)
    r.money = addMoney(r.money ?? ZERO_MONEY, m)
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(a.synthetic) - Number(b.synthetic) ||
      b.create + b.update - (a.create + a.update) ||
      (b.money?.revenue ?? 0) - (a.money?.revenue ?? 0),
  )
}

export function totalMoney(s: UaSummary): Money {
  return s.money.reduce<Money>((t, m) => addMoney(t, m), ZERO_MONEY)
}

export type UaAppRow = {
  app_id: string
  name: string
  app: UaApp | null
  ownerName: string | null
  create: number
  update: number
  /** Những người đã thao tác trên app này, nhiều thao tác nhất đứng trước. */
  actors: { key: string; name: string; n: number }[]
  money: Money | null
}

export function buildByApp(s: UaSummary): UaAppRow[] {
  const appOf = new Map(s.apps.map((a) => [a.app_id, a]))
  const nameOf = new Map(s.people.map((p) => [p.person_key, p.display_name]))
  const rows = new Map<string, UaAppRow & { actorMap: Map<string, { key: string; name: string; n: number }> }>()
  const get = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      const app = appOf.get(id) ?? null
      r = {
        app_id: id,
        name: id === '' ? 'Chưa suy ra app (account không có chi phí)' : app?.app_name ?? id,
        app,
        ownerName: app?.owner_key ? nameOf.get(app.owner_key) ?? app.owner_key : null,
        create: 0,
        update: 0,
        actors: [],
        money: null,
        actorMap: new Map(),
      }
      rows.set(id, r)
    }
    return r
  }
  for (const a of s.actions) {
    const r = get(a.app_id ?? '')
    if (a.bucket === 'create') r.create += Number(a.n)
    else r.update += Number(a.n)
    const cur = r.actorMap.get(a.person_key) ?? { key: a.person_key, name: nameOf.get(a.person_key) ?? a.person_name, n: 0 }
    cur.n += Number(a.n)
    r.actorMap.set(a.person_key, cur)
  }
  for (const m of s.money) {
    const r = get(m.app_id)
    r.money = addMoney(r.money ?? ZERO_MONEY, m)
  }
  return [...rows.values()]
    .map(({ actorMap, ...r }) => ({ ...r, actors: [...actorMap.values()].sort((x, y) => y.n - x.n) }))
    .sort((a, b) => (b.money?.revenue ?? 0) - (a.money?.revenue ?? 0) || b.create + b.update - (a.create + a.update))
}

/** Mọi ngày trong [from, to] — kể cả ngày không có dòng nào (để thấy ngày trống). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  for (let i = 0; d <= end && i < 400; i++) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export type DayRow = { day: string; create: number; update: number; money: Money }

export function buildByDay(s: UaSummary): DayRow[] {
  const rows = new Map<string, DayRow>(
    daysBetween(s.from, s.to).map((day) => [day, { day, create: 0, update: 0, money: ZERO_MONEY }]),
  )
  for (const a of s.actions) {
    const r = rows.get(a.day)
    if (!r) continue
    if (a.bucket === 'create') r.create += Number(a.n)
    else r.update += Number(a.n)
  }
  for (const m of s.money) {
    const r = rows.get(m.day)
    if (r) r.money = addMoney(r.money, m)
  }
  return [...rows.values()]
}

/** Ma trận người × ngày (số thao tác) cho heatmap nhịp độ. */
export function buildPersonDay(s: UaSummary): { people: { key: string; name: string; total: number; byDay: Map<string, number> }[]; max: number } {
  const nameOf = new Map(s.people.map((p) => [p.person_key, p.display_name]))
  const rows = new Map<string, { key: string; name: string; total: number; byDay: Map<string, number> }>()
  let max = 0
  for (const a of s.actions) {
    let r = rows.get(a.person_key)
    if (!r) {
      r = { key: a.person_key, name: nameOf.get(a.person_key) ?? a.person_name, total: 0, byDay: new Map() }
      rows.set(a.person_key, r)
    }
    const v = (r.byDay.get(a.day) ?? 0) + Number(a.n)
    r.byDay.set(a.day, v)
    r.total += Number(a.n)
    if (v > max) max = v
  }
  return { people: [...rows.values()].sort((a, b) => b.total - a.total), max }
}

// ---------------------------------------------------------------------------
// Định dạng
// ---------------------------------------------------------------------------
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: abs < 100 ? 2 : 0, maximumFractionDigits: abs < 100 ? 2 : 0 })
  return `${n < 0 ? '−' : ''}$${s}`
}
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? '—' : `${n.toFixed(0)}%`
}
export const int = (n: number) => n.toLocaleString('en-US')
/** 2026-11-19 → 19/11 */
export const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Độ ổn định của số tiền theo ngày — khớp 3 tầng lấy dữ liệu của job ua-report-sync:
 *  live    = D0, số đổi liên tục, job lấy lại mỗi giờ
 *  pending = D-1 và D-2, bdash còn cập nhật, job lấy lại vài giờ một lần
 *  final   = từ D-3 trở về trước, coi như ổn định, job rà lại mỗi tháng */
export type DayStatus = 'live' | 'pending' | 'final'
export function dayStatus(day: string): DayStatus {
  if (day >= dayVN(0)) return 'live'
  if (day >= dayVN(2)) return 'pending'
  return 'final'
}
export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  live: 'đang chạy',
  pending: 'còn có thể đổi',
  final: 'đã ổn định',
}

/** Hôm nay theo GMT+7 (lùi `back` ngày), YYYY-MM-DD — ngày của báo cáo luôn tính theo giờ VN. */
export function dayVN(back = 0): string {
  return new Date(Date.now() + 7 * 3600_000 - back * 86_400_000).toISOString().slice(0, 10)
}
