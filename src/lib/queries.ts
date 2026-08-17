import { supabase } from './supabase'
import { b64ToText, bytesToB64 } from './blueprint'
import type {
  AdsProfileMatrixRow,
  AdsScenarioByApp,
  AdsScenarioUsageHistory,
  AdsScenarioVersion,
  AppNewLesson,
  AppRow,
  AppSettings,
  AppUser,
  BlueprintFileContent,
  BlueprintFileMeta,
  Bug,
  Decision,
  LessonDead,
  LessonHot,
  LibraryFeasibility,
  PromotionCandidate,
  Run,
  RunHealth,
  RunLearningRow,
  RunNewLesson,
  RunPhase,
  SignupStatus,
  Tag,
  UserRole,
} from './types'

/** LUẬT CỨNG: đọc CHỈ qua view, không select thẳng bảng nghiệp vụ.
 *  View là lớp đệm đã dựng ở 0001 — đổi bảng bên dưới thì sửa view, client không biết.
 *  Ngoại lệ hợp lệ: bảng con của một run cụ thể (decisions/bugs/run_phases) và tags,
 *  vì chúng đọc theo khoá ngoại chứ không tổng hợp. */

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return (res.data ?? []) as T
}

export const promotionCandidates = async () =>
  unwrap<PromotionCandidate[]>(
    await supabase.from('v_promotion_candidates').select('*').order('distinct_apps', { ascending: false }),
  )

export const lessonsHot = async () =>
  unwrap<LessonHot[]>(await supabase.from('v_lesson_hot').select('*').limit(200))

export const lessonsDead = async () =>
  unwrap<LessonDead[]>(await supabase.from('v_lesson_dead').select('*'))

/** Web chỉ QUYẾT ĐỊNH. Đặt 'approved' + file đích; việc sửa file và commit do
 *  `af_db graduate` phía app-factory làm, rồi mới thành 'graduated'.
 *  Console KHÔNG BAO GIỜ được set 'graduated' — DB sẽ nói dối về git. */
export async function approveLesson(id: number, target: string) {
  const { error } = await supabase
    .from('lessons')
    .update({ status: 'approved', graduated_to: target, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function rejectLesson(id: number, reason: string) {
  const { error } = await supabase
    .from('lessons')
    .update({ status: 'rejected', rejected_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Apps (trang /apps) — KHÔNG cần bảng/cột/view mới ──────────────────────
// apps + embed runs (FK sẵn có). Search/sort làm client-side: quy mô là chục app ×
// trăm run, kéo một lần rẻ hơn chế thêm view chỉ để ORDER BY.

/** Toàn bộ app + run của từng app. Ngoại lệ đọc-thẳng-bảng hợp lệ (như runs()):
 *  đọc theo FK, không tổng hợp phía DB. */
export const appsWithRuns = async () =>
  unwrap<AppRow[]>(
    await supabase
      .from('apps')
      .select('id,name,package_name,source_kind,created_at,extra,runs(id,run_name,job_kind,status,af_version,started_at,finished_at,extra)')
      .order('created_at', { ascending: false })
      .order('started_at', { referencedTable: 'runs', ascending: false }),
  )

export const appDetail = async (id: number) => {
  const res = await supabase
    .from('apps')
    .select('id,name,package_name,source_kind,created_at,extra,runs(id,run_name,job_kind,status,af_version,started_at,finished_at,extra)')
    .eq('id', id)
    .order('started_at', { referencedTable: 'runs', ascending: false })
    .single()
  if (res.error) throw new Error(res.error.message)
  return res.data as unknown as AppRow
}

// ─── Blueprint content resolver (0017) ────────────────────────────────────
// Từ 0017 bytes blueprint sống ở Storage (bucket 'blueprints', key = storage_key);
// row cũ chưa backfill vẫn còn content_b64. resolveContent() chuẩn hoá về CÙNG shape
// { path, content_type, content_b64 } cho mọi viewer — content_b64 lấy từ DB (cũ)
// hoặc tải từ Storage qua signed URL rồi encode base64 (không đổi viewer).
const BLUEPRINT_BUCKET = 'blueprints'

type RawBlueprintRow = {
  path: string
  content_type: string
  content_b64: string | null
  storage_key?: string | null
}

async function contentFromStorage(storageKey: string): Promise<string> {
  const signed = await supabase.storage.from(BLUEPRINT_BUCKET).createSignedUrl(storageKey, 120)
  if (signed.error || !signed.data) throw new Error(signed.error?.message ?? 'không tạo được signed URL')
  const resp = await fetch(signed.data.signedUrl)
  if (!resp.ok) throw new Error(`tải Storage lỗi HTTP ${resp.status}`)
  return bytesToB64(new Uint8Array(await resp.arrayBuffer()))
}

async function resolveContent(row: RawBlueprintRow): Promise<BlueprintFileContent> {
  const content_b64 = row.content_b64 ?? (row.storage_key ? await contentFromStorage(row.storage_key) : '')
  return { path: row.path, content_type: row.content_type, content_b64 }
}

/** Icon đại diện của một run blueprint — MỘT request cho đúng MỘT file:
 *  ưu tiên `aso/icon_512.png` (icon final), fallback `design_previews/app_icon.svg`
 *  ('a' < 'd' nên order=path rồi limit 1 chọn đúng ưu tiên, không kéo thừa file kia). */
export const appIcon = async (runName: string) => {
  const res = await supabase
    .from('blueprint_files')
    .select('path,content_b64,content_type,storage_key')
    .eq('run_name', runName)
    .in('path', ['aso/icon_512.png', 'design_previews/app_icon.svg'])
    .order('path')
    .limit(1)
  if (res.error) throw new Error(res.error.message)
  const row = res.data?.[0] as RawBlueprintRow | undefined
  return row ? await resolveContent(row) : null
}

/** Package name DETECT từ lịch sử build khi apps.package_name trống:
 *  dòng `packageName:` trong task.md của blueprint (template bắt buộc có).
 *  Chỉ hiển thị — không ghi ngược vào bảng apps (sổ cái do CLI ghi). */
export const detectPackageName = async (runName: string) => {
  const res = await supabase
    .from('blueprint_files')
    .select('path,content_b64,content_type,storage_key')
    .eq('run_name', runName)
    .eq('path', 'task.md')
    .maybeSingle()
  if (res.error) throw new Error(res.error.message)
  if (!res.data) return null
  const { content_b64 } = await resolveContent(res.data as RawBlueprintRow)
  const m = b64ToText(content_b64).match(/^packageName:\s*([A-Za-z][\w.]*)/m)
  return m?.[1] ?? null
}

/** Lessons đã bơm vào MỌI run của app + phán quyết — view 0006, lọc theo tập run_id. */
export const appLearning = async (runIds: number[]) => {
  if (!runIds.length) return [] as RunLearningRow[]
  return unwrap<RunLearningRow[]>(
    await supabase.from('v_run_learning').select('*').in('run_id', runIds).order('lesson_id'),
  )
}

/** Lessons sinh mới từ các run của app (first_seen — bảng con theo FK, ngoại lệ hợp lệ). */
export const appNewLessons = async (runIds: number[]) => {
  if (!runIds.length) return [] as AppNewLesson[]
  return unwrap<AppNewLesson[]>(
    await supabase
      .from('lesson_observations')
      .select('lesson_id,run_id,note,lessons(slug,title,status)')
      .in('run_id', runIds)
      .eq('kind', 'first_seen')
      .order('lesson_id')
      // lessons(...) là FK n→1 → OBJECT; supabase-js suy nhầm thành mảng, ép bằng returns<>.
      .returns<AppNewLesson[]>(),
  )
}

export const runs = async () =>
  unwrap<Run[]>(
    await supabase
      .from('runs')
      .select('*, apps(name)')
      .order('started_at', { ascending: false })
      .limit(100),
  )

export const run = async (id: number) => {
  const res = await supabase.from('runs').select('*, apps(name)').eq('id', id).single()
  if (res.error) throw new Error(res.error.message)
  return res.data as Run
}

export const runPhases = async (runId: number) =>
  unwrap<RunPhase[]>(
    await supabase.from('run_phases').select('*').eq('run_id', runId).order('started_at'),
  )

// ─── Blueprint (bảng blueprint_files — metadata; bytes ở Storage từ 0017) ──
// Lọc theo run_name (cột được index cho việc này). RLS `authenticated` bật ở 0005;
// bucket 'blueprints' đọc cho `authenticated` ở 0017. content lấy qua resolveContent().

/** Cây file: KHÔNG kéo content (mỗi ảnh/JSON lớn) — chỉ meta để dựng sidebar. */
export const blueprintFiles = async (runName: string) =>
  unwrap<BlueprintFileMeta[]>(
    await supabase
      .from('blueprint_files')
      .select('path,content_type,bytes')
      .eq('run_name', runName)
      .order('path'),
  )

/** Nội dung 1 file — lazy, chỉ gọi khi người dùng mở file đó. */
export const blueprintFile = async (runName: string, path: string) => {
  const res = await supabase
    .from('blueprint_files')
    .select('path,content_b64,content_type,storage_key')
    .eq('run_name', runName)
    .eq('path', path)
    .single()
  if (res.error) throw new Error(res.error.message)
  return await resolveContent(res.data as RawBlueprintRow)
}

/** Mọi file dưới một prefix (vd 'design_previews/') — để mockup HTML dựng map link
 *  tương đối rồi mới render. Tải content song song (các file này nhỏ: html/svg/icon). */
export const blueprintDir = async (runName: string, prefix: string) => {
  const res = await supabase
    .from('blueprint_files')
    .select('path,content_b64,content_type,storage_key')
    .eq('run_name', runName)
    .like('path', `${prefix}%`)
    .order('path')
  if (res.error) throw new Error(res.error.message)
  return await Promise.all((res.data as RawBlueprintRow[]).map(resolveContent))
}

export const runDecisions = async (runId: number) =>
  unwrap<Decision[]>(await supabase.from('decisions').select('*').eq('run_id', runId).order('id'))

// ─── Learning loop (migration 0006) — console CHỈ hậu kiểm, không mutation ──
// Disposition là việc của agent qua CLI (af_db insert lesson_observations);
// web chỉ hiển thị để con người soát — cùng phân quyền với graduate.

/** Lessons đã bơm vào run (prefetch) + phán quyết từng lesson. Đọc qua view 0006. */
export const runLearning = async (runId: number) =>
  unwrap<RunLearningRow[]>(
    await supabase.from('v_run_learning').select('*').eq('run_id', runId).order('lesson_id'),
  )

/** Lesson mới sinh từ run này (observation first_seen — bảng con theo FK, ngoại lệ hợp lệ). */
export const runNewLessons = async (runId: number) =>
  unwrap<RunNewLesson[]>(
    await supabase
      .from('lesson_observations')
      .select('lesson_id,note,lessons(slug,title,status)')
      .eq('run_id', runId)
      .eq('kind', 'first_seen')
      .order('lesson_id')
      // lessons(...) là FK n→1 nên thực tế trả OBJECT; supabase-js không biết cardinality
      // và suy thành mảng — ép kiểu đúng bằng returns<>.
      .returns<RunNewLesson[]>(),
  )

export const runBugs = async (runId: number) =>
  unwrap<Bug[]>(await supabase.from('bugs').select('*').eq('run_id', runId).order('id'))

/** Bản web của `af_db query bugs --error` — tra theo CHỮ KÝ lỗi, không phải mô tả. */
export const searchBugs = async (signature: string, category?: string) => {
  let q = supabase.from('bugs').select('*').order('created_at', { ascending: false }).limit(100)
  if (signature.trim()) q = q.ilike('error_signature', `%${signature.trim()}%`)
  if (category) q = q.eq('category', category)
  return unwrap<Bug[]>(await q)
}

export const libraries = async () =>
  unwrap<LibraryFeasibility[]>(
    await supabase.from('v_library_feasibility').select('*').order('feature_key'),
  )

export const runHealth = async () =>
  unwrap<RunHealth[]>(await supabase.from('v_run_health').select('*'))

/** Tỉ lệ đọc-trước thật sự có ích. Đây là con số trả lời "AF có thông minh hơn không". */
export const retrievalStats = async () => {
  const total = await supabase.from('retrievals').select('*', { count: 'exact', head: true })
  const used = await supabase
    .from('retrievals')
    .select('*', { count: 'exact', head: true })
    .eq('was_used', true)
  if (total.error) throw new Error(total.error.message)
  if (used.error) throw new Error(used.error.message)
  return { total: total.count ?? 0, used: used.count ?? 0 }
}

export const observationStats = async () => {
  const counts: Record<string, number> = {}
  for (const kind of ['applied_prevented', 'recurred', 'first_seen']) {
    const r = await supabase
      .from('lesson_observations')
      .select('*', { count: 'exact', head: true })
      .eq('kind', kind)
    if (r.error) throw new Error(r.error.message)
    counts[kind] = r.count ?? 0
  }
  return counts
}

export const tags = async () =>
  unwrap<Tag[]>(await supabase.from('tags').select('*').order('name'))

export async function approveTag(id: number) {
  const { error } = await supabase.from('tags').update({ status: 'ok' }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Gộp tag trùng nghĩa. Không có việc này thì sau ~20 build sẽ có compose /
 *  jetpack-compose là hai tag khác nhau và cả kho tra cứu mất giá trị. */
export async function mergeTag(id: number, into: number) {
  const { error } = await supabase
    .from('tags')
    .update({ status: 'merged', merged_into: into })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Người dùng & cấu hình ────────────────────────────────────────────

/** Gọi được khi CHƯA đăng nhập — trang login cần biết có hiện tab Đăng ký không.
 *  `bootstrap = true` nghĩa là chưa ai trong hệ thống: luôn cho đăng ký, và
 *  người đó sẽ thành admin. */
export async function signupStatus(): Promise<SignupStatus> {
  const { data, error } = await supabase.rpc('signup_status')
  if (error) throw new Error(error.message)
  return data as SignupStatus
}

/** Đăng ký rồi đăng nhập luôn. Không cần verify email — trigger phía DB đã
 *  tự đặt email_confirmed_at, nên phiên đăng nhập lấy được ngay. */
export async function signUp(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  const { error: e2 } = await supabase.auth.signInWithPassword({ email, password })
  if (e2) throw new Error(e2.message)
}

export const appUsers = async () =>
  unwrap<AppUser[]>(await supabase.from('app_users').select('*').order('created_at'))

export async function myProfile(): Promise<AppUser | null> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data, error } = await supabase
    .from('app_users').select('*').eq('id', auth.user.id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as AppUser | null
}

export const appSettings = async () => {
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single()
  if (error) throw new Error(error.message)
  return data as AppSettings
}

/** RLS chỉ cho admin; member gọi sẽ không đổi được dòng nào (không phải lỗi,
 *  là 0 dòng bị ảnh hưởng) — nên trả về số dòng để giao diện báo cho đúng. */
export async function setSignupEnabled(enabled: boolean) {
  const { data, error } = await supabase
    .from('app_settings')
    .update({ signup_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', 1).select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không đổi được — chỉ admin mới có quyền.')
}

export async function setUserRole(id: string, role: UserRole) {
  const { data, error } = await supabase.from('app_users').update({ role }).eq('id', id).select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không đổi được — chỉ admin mới có quyền.')
}

export async function setUserActive(id: string, is_active: boolean) {
  const { data, error } = await supabase.from('app_users').update({ is_active }).eq('id', id).select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không đổi được — chỉ admin mới có quyền.')
}

/** Đổi mật khẩu cho người dùng hiện tại. */
export async function changePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

// ─── Ads scenarios (migration 0012) — console CHỈ đọc ──────────────────────
// Definition scenario sống ở git; DB giữ catalog snapshot + lịch sử usage theo app.

/** App nào đã gắn scenario (gom từ usages). */
export const adsScenarioByApp = async () =>
  unwrap<AdsScenarioByApp[]>(
    await supabase
      .from('v_ads_scenario_by_app')
      .select('*')
      .order('last_used_at', { ascending: false }),
  )

/** Lịch sử usage — lọc theo app / scenario. */
export const adsScenarioUsageHistory = async (opts?: {
  app?: string
  scenarioId?: string
  scenarioVersion?: number
}) => {
  let q = supabase
    .from('v_ads_scenario_usage_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (opts?.app) q = q.eq('app', opts.app)
  if (opts?.scenarioId) q = q.eq('scenario_id', opts.scenarioId)
  if (opts?.scenarioVersion != null) q = q.eq('scenario_version', opts.scenarioVersion)
  return unwrap<AdsScenarioUsageHistory[]>(await q)
}

/** Catalog scenario@version (bảng registry — giống tags: đọc thẳng catalog). */
export const adsScenarioVersions = async () =>
  unwrap<AdsScenarioVersion[]>(
    await supabase
      .from('ads_scenario_versions')
      .select('*')
      .order('scenario_id')
      .order('scenario_version', { ascending: false }),
  )

export const adsScenarioVersion = async (scenarioId: string, version: number) => {
  const res = await supabase
    .from('ads_scenario_versions')
    .select('*')
    .eq('scenario_id', scenarioId)
    .eq('scenario_version', version)
    .single()
  if (res.error) throw new Error(res.error.message)
  return res.data as AdsScenarioVersion
}

/** Profile × lib version matrix. */
export const adsProfileMatrix = async () =>
  unwrap<AdsProfileMatrixRow[]>(
    await supabase
      .from('v_ads_profile_matrix')
      .select('*')
      .order('profile_id')
      .order('version', { ascending: false }),
  )
