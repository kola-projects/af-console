import { supabase } from './supabase'
import type {
  Bug,
  Decision,
  LessonDead,
  LessonHot,
  LibraryFeasibility,
  PromotionCandidate,
  Run,
  RunHealth,
  RunPhase,
  Tag,
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
