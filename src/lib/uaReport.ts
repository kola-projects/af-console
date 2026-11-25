// [3.51.0] UA activity report — kiểu dữ liệu, truy vấn và phép gom số cho trang /ua-report.
//
// Nguồn: RPC ua_report_summary (migration 0058/0059) trả dữ liệu đã gom theo ngày; mọi phép gom
// tiếp theo (theo người / app / ngày) làm ở client vì dữ liệu nhỏ và đổi tab không cần gọi lại.
//
// HAI KHUNG GÁN KHÁC NHAU — đừng trộn:
//   • THAO TÁC gán theo người đã thao tác trên ZooKeeper (email đăng nhập zk → ua_people).
//   • TIỀN gán theo chủ sở hữu app. [3.52.0] Chủ app = GÁN TAY ở tab "Gán app" (bảng ua_app_owners,
//     migration 0064) nếu có; không thì theo tag người trên BBL Dashboard (ua_people.bdash_tags) như cũ.
// [3.53.0] Thêm khung thứ ba — CREATIVE: số của màn "Kho creative" trên ZooKeeper (ai đưa creative nào lên,
//   chi bao nhiêu, ROAS Adjust). Lấy qua edge function ua-creative-pipeline (có lớp lưu đệm), gán theo người
//   LÊN creative. "ROAS quảng cáo" ở khung này = doanh thu Adjust / chi của creative — KHÁC ROAS của khung tiền.
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
  /** create | status_change | budget_change | bid_change | rename | update | delete (từ migration 0065). */
  action_type: string | null
  n: number
}
/** Creative đưa lên chạy theo ngày × người (ZooKeeper uploads_by_day, migration 0065). */
export type UaUploadAgg = { day: string; person_key: string; person_name: string; n: number }
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
  /** Chủ app hiệu lực: gán tay nếu có, không thì theo tag. */
  owner_key: string | null
  /** 'manual' = gán tay trên af-console · 'tag' = suy từ tag BBL Dashboard · null = chưa có chủ. */
  owner_source: 'manual' | 'tag' | null
  /** Chủ app nếu chỉ xét tag — để biết bỏ gán tay thì app về ai. */
  tag_owner_key: string | null
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
  uploads: UaUploadAgg[]
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
  const s = data as UaSummary
  return { ...s, uploads: s.uploads ?? [] }
}

// ---------------------------------------------------------------------------
// [3.53.0] Hoạt động: lịch theo ngày × người, và số "Kho creative" của ZooKeeper
// ---------------------------------------------------------------------------
export type CalendarRow = { day: string; person_key: string; person_name: string; uploads: number; actions: number }
export type UaCalendar = { from: string; to: string; level: string; rows: CalendarRow[]; data_from: string | null; data_to: string | null }

/** Ngày × người: số creative lên + số thao tác — nguồn của Workload và biểu đồ lịch từng người. */
export async function uaActivityCalendar(from: string, to: string, level: UaLevel): Promise<UaCalendar> {
  const { data, error } = await supabase.rpc('ua_activity_calendar', { p_from: from, p_to: to, p_level: level })
  if (error) throw new Error(error.message)
  return data as UaCalendar
}

/** Bộ số của Kho creative — cùng định nghĩa với ZooKeeper:
 *  creatives = creative có trong quảng cáo đang chạy của kỳ · new = lên lần đầu trong kỳ ·
 *  tested = đã chi từ ngưỡng (min_spend, mặc định $10) · win = tested và ROAS Adjust ≥ ngưỡng ·
 *  inferred = creative không ghi nhận được người lên, ZooKeeper gán theo người chạy app đó nhiều nhất. */
export type CreativeAgg = {
  creatives: number; new: number; live: number; no_spend: number; testing: number; tested: number
  win: number; not_ok: number; inferred: number; spend: number; revenue: number
}
export type CreativeApp = CreativeAgg & { app: string; app_id: string | null }
export type CreativePerson = CreativeAgg & { person_key: string; name: string; mapped: boolean; apps: CreativeApp[] }
export type CreativeTeam = {
  from: string; to: string; generated_at: string | null; min_spend: number; roas_threshold: number
  revenue_available: boolean; totals: CreativeAgg; people: CreativePerson[]
}
export type CreativeItem = {
  key: string; platform: string | null; app: string | null; app_id: string | null; file_name: string | null
  media_type: string | null; status: 'untested' | 'testing' | 'win' | 'not_ok' | string | null; live: boolean
  owner: 'recorded' | 'history' | 'app' | 'inferred' | 'none'; spend: number; revenue: number
  uploaded_at: string | null; ad_count: number
}
export type CreativeItems = { from: string; to: string; person_key: string; zk_accounts: number; items_total: number; items: CreativeItem[] }
/** ready = có số (stale = bản đã cũ, refreshing = đang lấy lại ở nền) · pending = đang lấy lần đầu, hỏi lại sau. */
export type PipelineReply<T> =
  | { status: 'ready'; data: T; fetched_at: string; stale: boolean; refreshing: boolean }
  | { status: 'pending'; eta_s: number; since: string }
  | { status: 'error'; error: string; code?: string }

/** Kho creative chỉ xem được tối đa ngần này ngày một lần (giới hạn của ZooKeeper). */
export const CREATIVE_MAX_DAYS = 31

/** Hỏi edge function ua-creative-pipeline. Không truyền personKey = số cả đội; có personKey + items = danh
 *  sách creative mới của người đó. Function trả bản đã lưu ngay nếu có, chưa có thì trả pending. */
export async function uaCreativePipeline<T>(body: { from: string; to: string; person_key?: string; items?: boolean }): Promise<PipelineReply<T>> {
  const { data, error } = await supabase.functions.invoke('ua-creative-pipeline', { body })
  if (error) {
    let msg = error.message
    try {
      const j = await (error as { context?: Response }).context?.json()
      if (j?.error) msg = String(j.error)
    } catch { /* phản hồi lỗi không phải JSON — giữ thông báo gốc */ }
    return { status: 'error', error: msg }
  }
  return data as PipelineReply<T>
}

/** Nhãn cho nhóm creative "tested" của ZooKeeper (đã chi từ ngưỡng min_spend): viết thẳng ngưỡng ra cho dễ hiểu. */
export const testedLabel = (minSpend: number | null | undefined) => `chi ≥ $${minSpend ?? 10}`

/** ROAS quảng cáo % của creative = doanh thu Adjust / chi. null khi chi dưới $1. */
export const creativeRoas = (a: { spend: number; revenue: number }) => (a.spend >= 1 ? (a.revenue / a.spend) * 100 : null)

export type ActKind = 'upload' | 'create' | 'status' | 'budget' | 'other'
export const ACT_KINDS: ActKind[] = ['upload', 'create', 'status', 'budget', 'other']
export const ACT_KIND_LABEL: Record<ActKind, string> = {
  upload: 'Lên creative',
  create: 'Tạo campaign',
  status: 'Bật / tắt',
  budget: 'Chỉnh ngân sách',
  other: 'Chỉnh khác',
}
export const actKindOf = (actionType: string | null): ActKind =>
  actionType === 'create' ? 'create' : actionType === 'status_change' ? 'status' : actionType === 'budget_change' ? 'budget' : 'other'

export type PersonActivity = {
  key: string
  name: string
  kinds: Record<ActKind, number>
  /** Mọi hoạt động = creative lên + thao tác. */
  total: number
  /** Chỉ thao tác trên campaign / ad (không tính creative lên). */
  actions: number
}

/** Hoạt động trong khoảng ngày đang xem, gom theo người: creative lên + thao tác theo loại. */
export function buildActivity(s: UaSummary): Map<string, PersonActivity> {
  const nameOf = new Map(s.people.map((p) => [p.person_key, p.display_name]))
  const rows = new Map<string, PersonActivity>()
  const get = (key: string, name: string) => {
    let r = rows.get(key)
    if (!r) {
      r = { key, name: nameOf.get(key) ?? name, kinds: { upload: 0, create: 0, status: 0, budget: 0, other: 0 }, total: 0, actions: 0 }
      rows.set(key, r)
    }
    return r
  }
  for (const u of s.uploads) {
    const r = get(u.person_key, u.person_name)
    r.kinds.upload += Number(u.n)
    r.total += Number(u.n)
  }
  for (const a of s.actions) {
    const r = get(a.person_key, a.person_name)
    r.kinds[actKindOf(a.action_type)] += Number(a.n)
    r.total += Number(a.n)
    r.actions += Number(a.n)
  }
  return rows
}

/** Mức đậm của một ô lịch (0–4) theo số hoạt động trong ngày — ngưỡng cố định để mọi người, mọi tuần so được với nhau. */
export const heatLevel = (v: number) => (v <= 0 ? 0 : v <= 20 ? 1 : v <= 60 ? 2 : v <= 120 ? 3 : 4)

/** Thứ Hai của tuần chứa `day` (YYYY-MM-DD). */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
export const weekdayVN = (day: string) => WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]

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

/** Gán tay app cho một người (admin). `personKey = null` = bỏ gán tay, app quay về chủ theo tag. */
export async function setAppOwner(appId: string, personKey: string | null): Promise<void> {
  const { error } = personKey
    ? await supabase.from('ua_app_owners').upsert({ app_id: appId, person_key: personKey }, { onConflict: 'app_id' })
    : await supabase.from('ua_app_owners').delete().eq('app_id', appId)
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Phép gom số
// ---------------------------------------------------------------------------
export type Money = { revenue: number; cost: number; fees: number; installs: number }
export const ZERO_MONEY: Money = { revenue: 0, cost: 0, fees: 0, installs: 0 }

export const profitOf = (m: Money) => m.revenue - m.cost - m.fees
/** Dưới mức chi ads này (USD) coi như app không chạy ads trong khoảng đang xem. */
export const ROAS_MIN_AD_COST = 1
/** ROAS % = doanh thu / (chi ads + phí). null khi gần như không chi ads: app organic chỉ có vài chục cent
 *  phí nên phép chia ra hàng nghìn % — con số đó không nói gì về hiệu quả chạy ads. */
export const roasOf = (m: Money) => (m.cost >= ROAS_MIN_AD_COST ? (m.revenue / (m.cost + m.fees)) * 100 : null)

export function addMoney(a: Money, b: Money): Money {
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
      : get(UNASSIGNED, 'Chưa gán người (app chưa có chủ)', true)
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
  /** Tên chủ app nếu chỉ xét tag BBL Dashboard. */
  tagOwnerName: string | null
  create: number
  update: number
  /** Những người đã thao tác trên app này, nhiều thao tác nhất đứng trước. */
  actors: { key: string; name: string; n: number }[]
  money: Money | null
}

/** `allApps`: thêm cả app chưa có thao tác/tiền trong khoảng ngày (tab Gán app cần đủ danh sách) và bỏ
 *  dòng "chưa suy ra app" — dòng đó không phải một app nên không gán được. */
export function buildByApp(s: UaSummary, allApps = false): UaAppRow[] {
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
        tagOwnerName: app?.tag_owner_key ? nameOf.get(app.tag_owner_key) ?? app.tag_owner_key : null,
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
  if (allApps) for (const a of s.apps) get(a.app_id)
  return [...rows.values()]
    .filter((r) => !allApps || r.app !== null)
    .map(({ actorMap, ...r }) => ({ ...r, actors: [...actorMap.values()].sort((x, y) => y.n - x.n) }))
    .sort((a, b) => (b.money?.revenue ?? 0) - (a.money?.revenue ?? 0) || b.create + b.update - (a.create + a.update))
}

/** Cộng một danh sách dòng thành số của dòng "Tổng" ở chân bảng. */
export function sumRows<T>(rows: T[], get: (r: T) => { create: number; update: number; money: Money | null }) {
  let create = 0
  let update = 0
  let money: Money | null = null
  for (const r of rows) {
    const v = get(r)
    create += v.create
    update += v.update
    if (v.money) money = addMoney(money ?? ZERO_MONEY, v.money)
  }
  return { create, update, money }
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
