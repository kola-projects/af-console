/** Khớp với db/migrations/*.sql của app-factory. Giữ nguyên tên cột tiếng Anh:
 *  người đọc cần khớp được với schema khi tra SQL. */

export type LessonStatus =
  | 'candidate'
  | 'confirmed'
  | 'approved'
  | 'graduated'
  | 'rejected'
  | 'superseded'

export type BugCategory =
  | 'build_fail'
  | 'runtime_only'
  | 'logic_compile_ok'
  | 'ui_theme'
  | 'api_contract'
  | 'permission'
  | 'config'
  | 'dependency'
  | 'other'

export interface PromotionCandidate {
  id: number
  slug: string
  title: string
  scope: string | null
  status: LessonStatus
  distinct_apps: number
  recurred_count: number
  prevented_count: number
  supporting_evidence: number
  last_seen_at: string | null
}

export interface LessonHot {
  id: number
  slug: string
  title: string
  scope: string | null
  status: LessonStatus
  verified_in_our_stack: boolean
  trust_level: number
  distinct_apps: number
  recurred_count: number
  prevented_count: number
  last_seen_at: string | null
}

export interface LessonDead {
  id: number
  slug: string
  title: string
  scope: string | null
  status: LessonStatus
  times_retrieved: number
  times_used: number
  last_retrieved_at: string | null
}

export interface Run {
  id: number
  job_kind: 'generate' | 'clone' | 'harvest' | 'research' | 'backfill'
  app_id: number | null
  run_name: string | null
  af_version: string | null
  code_base_version: string | null
  status: 'running' | 'completed' | 'failed' | 'abandoned'
  started_at: string
  finished_at: string | null
  host: string | null
  outbox_flushed: boolean
  apps?: { name: string } | null
}

export interface RunPhase {
  id: number
  run_id: number
  phase: string
  status: string
  started_at: string
  finished_at: string | null
  summary: string | null
}

export interface Decision {
  id: number
  run_id: number
  phase_id: number | null
  kind: 'tradeoff' | 'inference' | 'assumption' | 'spec_deviation' | 'error_lesson'
  title: string
  body: string | null
  tradeoff: string | null
  revisit_if: string | null
}

export interface Bug {
  id: number
  run_id: number
  phase_id: number | null
  title: string
  error_signature: string | null
  category: BugCategory
  symptom: string | null
  root_cause: string | null
  fix: string | null
  detected_by: string | null
  severity: string | null
  created_at: string
}

export interface LibraryFeasibility {
  id: number
  feature_key: string
  coordinates: string | null
  status: 'verified' | 'directional' | 'rejected'
  total_uses: number
  ok_uses: number
  ok_pct: number | null
  last_version: string | null
  last_used_at: string | null
}

export interface RunHealth {
  af_version: string | null
  code_base_version: string | null
  runs: number
  completed_runs: number
  bugs: number
  bugs_per_run: number | null
  logic_compile_ok_bugs: number
}

export interface Tag {
  id: number
  name: string
  kind: string | null
  status: 'ok' | 'new' | 'merged'
  merged_into: number | null
}

/** Các file trong instructions/ mà một lesson có thể được đẩy lên.
 *  Console chỉ CHỌN đích; việc sửa file do `af_db graduate` phía app-factory làm. */
export const GRADUATION_TARGETS = [
  'instructions/skills/APP_STRUCTURE.md',
  'instructions/skills/ANDROID_APP_DESIGN.md',
  'instructions/skills/ADS_LOGIC.md',
  'instructions/skills/LIBRARY_SELECTION.md',
  'instructions/LIBRARY_REGISTRY.md',
  'instructions/workflow/MEMORY_PROTOCOL.md',
] as const
