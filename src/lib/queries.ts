import { zipSync } from 'fflate'
import { supabase, createEphemeralClient } from './supabase'
import { b64ToBytes, b64ToDataURL, b64ToText, bytesToB64, mimeOf } from './blueprint'
import type {
  AdPlan,
  AdPlanBody,
  AfVersion,
  AppRequest,
  AppearanceInfo,
  AppearanceManifest,
  AppearanceVariant,
  ProductAssets,
  RequestEvent,
  RequestStatus,
  RequestType,
  UploadedFile,
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
      .select('id,name,package_name,source_kind,created_at,extra,is_hidden,team,app_code,app_codes,runs(id,run_name,job_kind,status,af_version,started_at,finished_at,extra)')
      .order('created_at', { ascending: false })
      .order('started_at', { referencedTable: 'runs', ascending: false }),
  )

/** [0023] Admin ẩn/hiện app khỏi non-admin. RLS: chỉ admin ghi được. */
export async function setAppHidden(id: number, is_hidden: boolean) {
  const { data, error } = await supabase.from('apps').update({ is_hidden }).eq('id', id).select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không đổi được — chỉ admin mới có quyền.')
}

/** [0027] Admin gán team cho app (nhãn thống kê; '' = bỏ team). RLS chỉ admin ghi. */
export async function setAppTeam(id: number, team: string) {
  const { data, error } = await supabase
    .from('apps')
    .update({ team: team || null })
    .eq('id', id)
    .select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không đổi được — chỉ admin mới có quyền.')
}

/** [0023] Danh sách app cho NON-ADMIN: apps (RLS đã lọc app ẩn) + con trỏ blueprint
 *  từ view an toàn v_app_blueprints (KHÔNG mở bảng runs). Dựng runs synth chỉ chứa
 *  con trỏ blueprint để AppIcon/PackageName dùng lại không đổi. */
export const appsPublic = async (): Promise<AppRow[]> => {
  const appsRes = await supabase
    .from('apps')
    .select('id,name,package_name,source_kind,created_at,extra,is_hidden,team,app_code,app_codes')
    .order('created_at', { ascending: false })
  if (appsRes.error) throw new Error(appsRes.error.message)
  const bpRes = await supabase.from('v_app_blueprints').select('app_id,run_name,started_at')
  if (bpRes.error) throw new Error(bpRes.error.message)
  const byApp = new Map<number, { run_name: string; started_at: string }[]>()
  for (const b of (bpRes.data ?? []) as { app_id: number; run_name: string; started_at: string }[]) {
    const arr = byApp.get(b.app_id) ?? []
    arr.push({ run_name: b.run_name, started_at: b.started_at })
    byApp.set(b.app_id, arr)
  }
  return ((appsRes.data ?? []) as Omit<AppRow, 'runs'>[]).map((a) => ({
    ...a,
    runs: (byApp.get(a.id) ?? [])
      .sort((x, y) => (x.started_at < y.started_at ? 1 : -1))
      .map((b) => ({
        id: 0,
        run_name: b.run_name,
        job_kind: 'generate' as const,
        status: 'completed' as const,
        af_version: null,
        started_at: b.started_at,
        finished_at: null,
        extra: { blueprint_run: b.run_name },
      })),
  }))
}

/** [0023] Chi tiết app cho NON-ADMIN (curated) — như appsPublic nhưng 1 app. */
export const appDetailPublic = async (id: number): Promise<AppRow | null> => {
  const appRes = await supabase
    .from('apps')
    .select('id,name,package_name,source_kind,created_at,extra,is_hidden,team,app_code,app_codes')
    .eq('id', id)
    .maybeSingle()
  if (appRes.error) throw new Error(appRes.error.message)
  if (!appRes.data) return null
  const bpRes = await supabase
    .from('v_app_blueprints')
    .select('run_name,started_at')
    .eq('app_id', id)
    .order('started_at', { ascending: false })
  if (bpRes.error) throw new Error(bpRes.error.message)
  return {
    ...(appRes.data as Omit<AppRow, 'runs'>),
    runs: ((bpRes.data ?? []) as { run_name: string; started_at: string }[]).map((b) => ({
      id: 0,
      run_name: b.run_name,
      job_kind: 'generate' as const,
      status: 'completed' as const,
      af_version: null,
      started_at: b.started_at,
      finished_at: null,
      extra: { blueprint_run: b.run_name },
    })),
  }
}

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
 *  dòng `packageName:` trong order.md (tên cũ task.md — app lịch sử) của blueprint.
 *  Chỉ hiển thị — không ghi ngược vào bảng apps (sổ cái do CLI ghi). */
export const detectPackageName = async (runName: string) => {
  const res = await supabase
    .from('blueprint_files')
    .select('path,content_b64,content_type,storage_key')
    .eq('run_name', runName)
    .in('path', ['order.md', 'task.md'])
    .order('path')
    .limit(1)
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

/** Admin đổi mật khẩu của user KHÁC (RPC SECURITY DEFINER — 0025). */
export async function adminSetUserPassword(userId: string, newPassword: string) {
  const { error } = await supabase.rpc('admin_set_user_password', {
    p_user: userId,
    p_password: newPassword,
  })
  if (error) throw new Error(error.message)
}

/** Admin tạo user trực tiếp (email+mật khẩu+role) mà KHÔNG cần service_role:
 *  1. ghi pending_invites (RLS chỉ admin) — allowlist + role đích;
 *  2. signUp bằng client TẠM (không văng session admin);
 *  trigger DB đọc invite để cho qua kể-cả-khi-tắt-đăng-ký + đặt role + xoá invite.
 *  Không cần verify email (trigger tự xác nhận). */
export async function adminCreateUser(email: string, password: string, role: UserRole) {
  const em = email.trim().toLowerCase()
  const { error: e1 } = await supabase
    .from('pending_invites')
    .upsert({ email: em, role }, { onConflict: 'email' })
  if (e1) throw new Error(`Không tạo được invite (chỉ admin): ${e1.message}`)

  const temp = createEphemeralClient()
  const { error: e2 } = await temp.auth.signUp({ email: em, password })
  if (e2) {
    // Dọn invite treo nếu signUp lỗi (email trùng, mật khẩu yếu…).
    await supabase.from('pending_invites').delete().eq('email', em)
    throw new Error(e2.message)
  }
}

// ─── af_versions (0020) — bản AF cho người đặt đơn ──────────────────────

export const afVersions = async () =>
  unwrap<AfVersion[]>(
    await supabase.from('af_versions').select('*').order('sort_rank', { ascending: false }),
  )

/** Chỉ các bản đã mở khoá (cho dropdown đặt đơn). Bản đầu = mới nhất (default). */
export const selectableAfVersions = async () =>
  unwrap<AfVersion[]>(
    await supabase
      .from('af_versions')
      .select('*')
      .eq('is_selectable', true)
      .order('sort_rank', { ascending: false }),
  )

export async function setAfVersionSelectable(version: string, is_selectable: boolean) {
  const { data, error } = await supabase
    .from('af_versions')
    .update({ is_selectable })
    .eq('version', version)
    .select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không đổi được — chỉ admin mới có quyền.')
}

export async function addAfVersion(version: string, sort_rank: number, notes?: string) {
  const { error } = await supabase
    .from('af_versions')
    .insert({ version: version.trim(), sort_rank, notes: notes?.trim() || null })
  if (error) throw new Error(error.message)
}

// ─── Requests queue (0020) — user đặt/huỷ/xem; admin đổi trạng thái ──────

export async function createRequest(
  type: RequestType,
  afVersion: string,
  payload: Record<string, unknown>,
  targetAppCode?: string | null,
) {
  const { data, error } = await supabase.rpc('create_request', {
    p_type: type,
    p_af_version: afVersion,
    p_payload: payload,
    p_target_app_code: targetAppCode ?? null,
  })
  if (error) throw new Error(error.message)
  return data as AppRequest
}

export async function cancelRequest(id: number) {
  const { error } = await supabase.rpc('cancel_request', { p_id: id })
  if (error) throw new Error(error.message)
}

export async function setRequestStatus(
  id: number,
  status: RequestStatus,
  message?: string,
  result?: Record<string, unknown> | null,
) {
  const { error } = await supabase.rpc('set_request_status', {
    p_id: id,
    p_status: status,
    p_message: message ?? null,
    p_result: result ?? null,
  })
  if (error) throw new Error(error.message)
}

/** Đơn của tôi (RLS tự lọc requester=auth.uid()). */
export const myRequests = async () =>
  unwrap<AppRequest[]>(
    await supabase.from('requests').select('*').order('created_at', { ascending: false }),
  )

/** Toàn bộ đơn (admin — RLS cho admin thấy hết; non-admin gọi chỉ ra đơn mình). */
export const allRequests = async () =>
  unwrap<AppRequest[]>(
    await supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500),
  )

export const requestEvents = async (requestId: number) =>
  unwrap<RequestEvent[]>(
    await supabase
      .from('request_events')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at'),
  )

// ─── App codes + Appearance variants (cho form Ads/ASO) ─────────────────

/** Danh sách mã app (datalist gợi ý). Đọc-thẳng-bảng theo cột, không tổng hợp. */
export const appCodes = async () => {
  const res = await supabase
    .from('apps')
    .select('name,app_code,app_codes')
    .not('app_code', 'is', null)
    .order('app_code')
  if (res.error) throw new Error(res.error.message)
  return (res.data ?? []) as { name: string; app_code: string | null; app_codes: string[] | null }[]
}

/** run_name của blueprint mới nhất cho một app_code (để nạp appearance/variants.json).
 *  Trả null nếu không tìm được app hoặc app chưa push blueprint. */
async function blueprintRunOfAppCode(code: string): Promise<string | null> {
  const c = code.trim()
  if (!c) return null
  const res = await supabase
    .from('apps')
    .select('app_code,app_codes,runs(run_name,started_at,extra)')
    .or(`app_code.eq.${c},app_codes.cs.{${c}}`)
    .limit(1)
  if (res.error) throw new Error(res.error.message)
  const app = res.data?.[0] as
    | { runs: { run_name: string | null; started_at: string; extra: Record<string, unknown> | null }[] }
    | undefined
  if (!app?.runs?.length) return null
  const withBp = app.runs
    .filter((r) => r.extra && typeof r.extra.blueprint_run === 'string')
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
  if (withBp.length) return withBp[0].extra!.blueprint_run as string
  // fallback: run mới nhất có run_name
  const named = app.runs.filter((r) => r.run_name).sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
  return named[0]?.run_name ?? null
}

/** Suy biến thể Layout/Style của app cho form ASO:
 *  ưu tiên manifest appearance/variants.json (AF sẽ sinh sau); nếu không có, suy
 *  số biến thể N từ task.md/order.md; không có gì → 'none' (form cho nhập tay). */
export async function appearanceInfo(code: string): Promise<AppearanceInfo> {
  const none: AppearanceInfo = { source: 'none', runName: null, n: null, layouts: [], styles: [] }
  const runName = await blueprintRunOfAppCode(code)
  if (!runName) return none

  // 1. manifest
  const man = await supabase
    .from('blueprint_files')
    .select('path,content_b64,content_type,storage_key')
    .eq('run_name', runName)
    .eq('path', 'appearance/variants.json')
    .maybeSingle()
  if (man.error) throw new Error(man.error.message)
  if (man.data) {
    try {
      const { content_b64 } = await resolveContent(man.data as RawBlueprintRow)
      const m = JSON.parse(b64ToText(content_b64)) as AppearanceManifest
      return {
        source: 'manifest',
        runName,
        n: m.design_variants ?? Math.max(m.layouts?.length ?? 0, m.styles?.length ?? 0),
        layouts: m.layouts ?? [],
        styles: m.styles ?? [],
      }
    } catch {
      /* manifest hỏng → rơi xuống suy N */
    }
  }

  // 2. suy N từ task.md / order.md (design_variants: N)
  const spec = await supabase
    .from('blueprint_files')
    .select('path,content_b64,content_type,storage_key')
    .eq('run_name', runName)
    .in('path', ['order.md', 'task.md'])
    .order('path')
    .limit(1)
    .maybeSingle()
  if (spec.error) throw new Error(spec.error.message)
  if (spec.data) {
    const { content_b64 } = await resolveContent(spec.data as RawBlueprintRow)
    const m = b64ToText(content_b64).match(/design_variants:\s*(\d+)/)
    const n = m ? parseInt(m[1], 10) : null
    if (n && n > 0) {
      const gen = (): AppearanceVariant[] =>
        Array.from({ length: n }, (_, i) => ({ ordinal: i, label: `#${i + 1}` }))
      return { source: 'count', runName, n, layouts: gen(), styles: gen() }
    }
  }
  return { ...none, runName }
}

/** Gói toàn bộ aso/ (blueprint whitelisted) thành zip để nhân sự ASO submit lên store.
 *  Trả bytes; component lo Blob + download. Path trong zip bỏ tiền tố 'aso/'. */
export async function asoZipBytes(runName: string): Promise<Uint8Array> {
  const files = await blueprintDir(runName, 'aso/')
  if (!files.length) throw new Error('App này chưa có gói ASO (thư mục aso/ trống).')
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.path.replace(/^aso\//, '')] = b64ToBytes(f.content_b64)
  return zipSync(entries, { level: 6 })
}

/** Store options cho form ASO/Make+ASO — đọc view an toàn v_stores (0014;
 *  cột nhạy cảm đã REVOKE, view chỉ lộ trường công khai). */
export const storeOptions = async () => {
  const res = await supabase
    .from('v_stores')
    .select('store_code,name,display_name')
    .not('store_code', 'is', null)
    .order('store_code')
  if (res.error) throw new Error(res.error.message)
  return (res.data ?? []) as { store_code: string; name: string | null; display_name: string | null }[]
}

/** data-URI của một ảnh preview trong blueprint (cho picker biến thể). */
export async function blueprintImageDataUri(runName: string, path: string): Promise<string> {
  const { content_b64, content_type } = await blueprintFile(runName, path)
  return `data:${content_type};base64,${content_b64}`
}

// ─── Trang sản phẩm (/apps/:id) — gom asset từ blueprint whitelisted ────
const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i
const isNumberedShot = (path: string) => /(^|\/)\d+\.(png|jpe?g|webp)$/i.test(path)

/** Đọc aso/ + legal/ + design_previews/ (RLS 0023 whitelist) → dữ liệu cho trang
 *  sản phẩm thân thiện. Chịu lỗi từng nhóm (app có thể thiếu nhóm nào đó). */
export async function productAppAssets(runName: string): Promise<ProductAssets> {
  const [aso, legal, dp] = await Promise.all([
    blueprintDir(runName, 'aso/').catch(() => []),
    blueprintDir(runName, 'legal/').catch(() => []),
    blueprintDir(runName, 'design_previews/').catch(() => []),
  ])
  const base = (p: string) => p.split('/').pop() ?? p
  const textOf = (name: string) => {
    const f = aso.find((x) => base(x.path) === name)
    return f ? b64ToText(f.content_b64).trim() || null : null
  }
  const imgOf = (name: string) => {
    const f = aso.find((x) => base(x.path) === name)
    return f ? b64ToDataURL(f.content_b64, mimeOf(f.path, f.content_type)) : null
  }

  const screenshots = aso
    .filter((f) => IMG_EXT.test(f.path) && isNumberedShot(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => b64ToDataURL(f.content_b64, mimeOf(f.path, f.content_type)))

  // legal: URL live ở legal/URLS.json (shape { pages: {privacy,terms,support} });
  // verdict ở aso/legal_urls.json (bản ASO verify). Đọc cả hai, nới lỏng key.
  let privacyUrl: string | null = null
  let termsUrl: string | null = null
  let verdict: string | null = null
  const asStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const legalJson = legal.find((f) => /urls?\.json$/i.test(f.path)) ?? legal.find((f) => f.path.endsWith('.json'))
  if (legalJson) {
    try {
      const j = JSON.parse(b64ToText(legalJson.content_b64)) as Record<string, unknown>
      const pages = (j.pages && typeof j.pages === 'object' ? j.pages : {}) as Record<string, unknown>
      privacyUrl = asStr(pages.privacy) ?? asStr(j.privacy_url) ?? asStr(j.privacy)
      termsUrl = asStr(pages.terms) ?? asStr(j.terms_url) ?? asStr(j.terms)
    } catch {
      /* json hỏng → bỏ qua */
    }
  }
  const asoLegal = aso.find((f) => base(f.path) === 'legal_urls.json')
  if (asoLegal) {
    try {
      const j = JSON.parse(b64ToText(asoLegal.content_b64)) as Record<string, unknown>
      const pages = (j.pages && typeof j.pages === 'object' ? j.pages : {}) as Record<string, unknown>
      verdict = asStr(j.verdict) ?? asStr(j.status)
      privacyUrl = privacyUrl ?? asStr(pages.privacy) ?? asStr(j.privacy_url) ?? asStr(j.privacy)
      termsUrl = termsUrl ?? asStr(pages.terms) ?? asStr(j.terms_url) ?? asStr(j.terms)
    } catch {
      /* json hỏng → bỏ qua */
    }
  }

  const designImages = dp
    .filter((f) => IMG_EXT.test(f.path) || f.path.endsWith('.svg'))
    .map((f) => ({ path: f.path, dataUri: b64ToDataURL(f.content_b64, mimeOf(f.path, f.content_type)) }))

  return {
    title: textOf('title.txt'),
    shortDesc: textOf('short_description.txt'),
    fullDesc: textOf('full_description.txt'),
    releaseNotes: textOf('release_notes.txt'),
    icon: imgOf('icon_512.png'),
    featureGraphic: imgOf('feature_graphic.png'),
    screenshots,
    legal: { privacyUrl, termsUrl, verdict },
    designImages,
    hasDesignIndex: dp.some((f) => f.path.endsWith('index.html')),
  }
}

// ─── File đính kèm yêu cầu (bucket request-uploads, 0021) ───────────────
const REQUEST_UPLOAD_BUCKET = 'request-uploads'

/** Upload trước khi tạo đơn: path '<uid>/<draftId>/<filename>'. Trả meta để nhét payload. */
export async function uploadRequestFile(file: File, draftId: string): Promise<UploadedFile> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) throw new Error('Chưa đăng nhập.')
  const safe = file.name.replace(/[^\w.-]+/g, '_')
  const key = `${uid}/${draftId}/${safe}`
  const { error } = await supabase.storage
    .from(REQUEST_UPLOAD_BUCKET)
    .upload(key, file, { upsert: true, contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  return { key, name: file.name, size: file.size, type: file.type }
}

export async function removeRequestFile(key: string) {
  const { error } = await supabase.storage.from(REQUEST_UPLOAD_BUCKET).remove([key])
  if (error) throw new Error(error.message)
}

/** Signed URL để xem/tải file đính kèm (admin hoặc chủ đơn). */
export async function requestFileUrl(key: string): Promise<string> {
  const { data, error } = await supabase.storage.from(REQUEST_UPLOAD_BUCKET).createSignedUrl(key, 300)
  if (error || !data) throw new Error(error?.message ?? 'không tạo được URL')
  return data.signedUrl
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

// ─── ad_plans (migration 0033) — Ads Builder CRUD (admin-only qua RLS) ───────
export const adPlans = async () =>
  unwrap<AdPlan[]>(await supabase.from('ad_plans').select('*').order('updated_at', { ascending: false }))

export const adPlan = async (id: number) => {
  const res = await supabase.from('ad_plans').select('*').eq('id', id).single()
  if (res.error) throw new Error(res.error.message)
  return res.data as AdPlan
}

/** Tạo mới (id rỗng) hoặc cập nhật (có id). Trả bản ghi sau khi ghi. */
export const saveAdPlan = async (row: {
  id?: number; app_id: number | null; app_code: string | null
  name: string; plan: AdPlanBody; status?: AdPlan['status']
}) => {
  const patch = {
    app_id: row.app_id, app_code: row.app_code, name: row.name,
    plan: row.plan, status: row.status ?? 'draft', updated_at: new Date().toISOString(),
  }
  const q = row.id
    ? supabase.from('ad_plans').update(patch).eq('id', row.id).select('*').single()
    : supabase.from('ad_plans').insert(patch).select('*').single()
  const res = await q
  if (res.error) throw new Error(res.error.message)
  return res.data as AdPlan
}

export const deleteAdPlan = async (id: number) => {
  const res = await supabase.from('ad_plans').delete().eq('id', id)
  if (res.error) throw new Error(res.error.message)
}

// ─── Stores (trang /stores) — v_stores (an toàn) + RLS CRUD + RPC PAT [0034] ──
export type StoreRow = {
  id: number
  store_code: string | null
  name: string
  slug: string
  display_name: string | null
  support_email: string | null
  github_repo: string | null
  website_url: string | null
  play_console_url: string | null
  enabled: boolean
  github_pat_configured: boolean
  extra: Record<string, unknown>
  app_count: number
  created_at: string
  updated_at: string
}

export type StoreInput = {
  name: string
  slug: string
  store_code?: string | null
  display_name?: string | null
  support_email?: string | null
  github_repo?: string | null
  website_url?: string | null
  play_console_url?: string | null
  enabled?: boolean
  extra?: Record<string, unknown>
}

export async function storesList(): Promise<StoreRow[]> {
  const { data, error } = await supabase
    .from('v_stores')
    .select('*')
    .order('store_code', { nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as StoreRow[]
}

/** RPC cấp mã store kế tiếp (aNNN). */
export async function allocStoreCode(): Promise<string> {
  const { data, error } = await supabase.rpc('alloc_store_code')
  if (error) throw new Error(error.message)
  return data as string
}

export async function createStore(input: StoreInput) {
  const { data, error } = await supabase.from('stores').insert(input).select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không tạo được — chỉ admin mới có quyền.')
  return data[0]
}

export async function updateStore(id: number, patch: Partial<StoreInput>) {
  const { data, error } = await supabase.from('stores').update(patch).eq('id', id).select()
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Không đổi được — chỉ admin mới có quyền.')
}

export async function deleteStore(id: number) {
  const { error } = await supabase.from('stores').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Đặt GitHub PAT (mã hoá server-side, không SELECT được lại). */
export async function setStorePat(id: number, pat: string) {
  const { error } = await supabase.rpc('set_store_github_credential', { p_store_id: id, p_pat: pat })
  if (error) throw new Error(error.message)
}

export async function clearStorePat(id: number) {
  const { error } = await supabase.rpc('clear_store_github_credential', { p_store_id: id })
  if (error) throw new Error(error.message)
}
