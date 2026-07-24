import { supabase } from './supabase'
import type {
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

// ─── Blueprint (bảng blueprint_files, migration 0005 — không Storage) ──────
// Lọc theo run_name (cột được index cho việc này). RLS `authenticated` đã bật ở 0005.

/** Cây file: KHÔNG kéo content_b64 (mỗi ảnh/JSON ~1.5MB base64). */
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
    .select('path,content_b64,content_type')
    .eq('run_name', runName)
    .eq('path', path)
    .single()
  if (res.error) throw new Error(res.error.message)
  return res.data as BlueprintFileContent
}

/** Mọi file dưới một prefix (vd 'design_previews/') — để mockup HTML dựng map link
 *  tương đối rồi mới render. Kéo content vì các file này nhỏ (html/svg/icon). */
export const blueprintDir = async (runName: string, prefix: string) =>
  unwrap<BlueprintFileContent[]>(
    await supabase
      .from('blueprint_files')
      .select('path,content_b64,content_type')
      .eq('run_name', runName)
      .like('path', `${prefix}%`)
      .order('path'),
  )

export const runDecisions = async (runId: number) =>
  unwrap<Decision[]>(await supabase.from('decisions').select('*').eq('run_id', runId).order('id'))

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
