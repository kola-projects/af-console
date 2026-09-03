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

/** Run rút gọn embed dưới một app (apps → runs, FK n→1 đảo chiều nên là MẢNG).
 *  Con trỏ blueprint sống ở extra.blueprint_run — có nó nghĩa là run đã push blueprint. */
export interface AppRunSummary {
  id: number
  run_name: string | null
  job_kind: Run['job_kind']
  status: Run['status']
  af_version: string | null
  started_at: string
  finished_at: string | null
  extra: Record<string, unknown> | null
}

/** Một dòng bảng apps + toàn bộ run của nó. "Last update" KHÔNG có cột riêng —
 *  suy từ run mới nhất (started_at/finished_at), app chưa run nào thì lấy created_at. */
export interface AppRow {
  id: number
  name: string
  package_name: string | null
  source_kind: 'request' | 'clone_android' | 'clone_ios'
  created_at: string
  /** [v4.4.0] Mã app YYMMDDXs — tên gọi ổn định thay cho appName (đổi theo ASO).
   *  Cột thật sau migration 0015; trước đó nằm tạm trong `extra` nên đọc cả hai. */
  app_code?: string | null
  app_codes?: string[] | null
  /** [0023] admin ẩn app khỏi non-admin. */
  is_hidden?: boolean
  /** [0027] nhãn team (Auto/Titan) — thống kê/lọc, admin sửa. */
  team?: string | null
  /** [0032] android | ios. Default 'android' cho row cũ. */
  platform?: 'android' | 'ios' | null
  extra?: { app_code?: string; app_codes?: string[] } | null
  runs: AppRunSummary[]
}

/** Mã app hiệu lực: ưu tiên cột thật, fallback extra (giai đoạn trước migration 0015). */
export const appCodeOf = (a: Pick<AppRow, 'app_code' | 'extra'>): string | null =>
  a.app_code ?? a.extra?.app_code ?? null

/** Lesson mới sinh từ MỘT run của app (observation first_seen, cần run_id để chỉ nguồn). */
export interface AppNewLesson {
  lesson_id: number
  run_id: number | null
  note: string | null
  lessons: { slug: string; title: string; status: LessonStatus } | null
}

export interface Run {
  id: number
  job_kind: 'generate' | 'clone' | 'harvest' | 'research' | 'backfill' | 'legal' | 'ads'
  app_id: number | null
  run_name: string | null
  af_version: string | null
  code_base_version: string | null
  status: 'running' | 'completed' | 'failed' | 'abandoned'
  started_at: string
  finished_at: string | null
  host: string | null
  outbox_flushed: boolean
  /** jsonb tự do ở bảng runs. Con trỏ blueprint sống ở đây:
   *  extra.blueprint_run = <run_name> (run đã push blueprint), extra.blueprint_table = 'blueprint_files'. */
  extra: Record<string, unknown> | null
  apps?: { name: string } | null
}

/** Snapshot tóm tắt scenario (catalog hoặc lúc ghi usage). Khớp summary jsonb ở 0012. */
export interface AdsScenarioSummary {
  placement_count?: number
  screen_count?: number
  flow_count?: number
  verify_count?: number
  globals?: Record<string, unknown>
  screens?: string[]
  screens_detail?: Array<{
    id?: string
    optional?: boolean
    slot_ids?: string[]
    slot_count?: number
  }>
  doc_path?: string
  [key: string]: unknown
}

/** Bản chiếu scenario.json lưu ở ads_scenario_versions.definition (0013). */
export interface AdsScenarioDefinition {
  meta?: {
    id?: string
    version?: number
    status?: string
    description?: string
    requires_capabilities?: string[]
  }
  globals?: Record<string, unknown>
  gates?: Array<Record<string, unknown>>
  placements?: Array<Record<string, unknown>>
  screens?: Array<{
    id?: string
    optional?: boolean
    slots?: Array<Record<string, unknown>>
  }>
  flow?: Array<{
    id?: string
    screen?: string
    trigger?: Record<string, unknown>
    actions?: Array<Record<string, unknown>>
  }>
  verify?: Array<Record<string, unknown>>
  [key: string]: unknown
}

/** Catalog một bản scenario@version — bảng ads_scenario_versions (0012/0013). */
export interface AdsScenarioVersion {
  scenario_id: string
  scenario_version: number
  status: 'draft' | 'active' | 'frozen' | 'deprecated'
  description: string | null
  requires_capabilities: string[]
  content_sha: string
  summary: AdsScenarioSummary
  definition: AdsScenarioDefinition
  source_path: string
  verified_at: string
  notes: string | null
  updated_at: string
}

/** App đã từng gắn scenario — view v_ads_scenario_by_app. */
export interface AdsScenarioByApp {
  app: string
  usage_count: number
  scenario_versions_used: number
  profiles_used: number
  last_used_at: string
  latest_scenario_id: string | null
  latest_scenario_version: number | null
  latest_profile_id: string | null
  latest_lib_version: string | null
  latest_outcome: string | null
  latest_run_id: number | null
}

/** Một lần dùng scenario trên app — view v_ads_scenario_usage_history. */
export interface AdsScenarioUsageHistory {
  id: number
  run_id: number
  app: string
  scenario_id: string
  scenario_version: number
  scenario_ref: string
  profile_id: string
  lib_version: string | null
  af_version: string | null
  code_base_version: string | null
  scenario_content_sha: string | null
  scenario_summary: AdsScenarioSummary
  deltas: unknown
  outcome: 'works' | 'works_with_gotcha' | 'failed' | 'replaced'
  notes: string | null
  created_at: string
  run_name: string | null
  job_kind: string | null
  run_status: string | null
  run_started_at: string | null
  run_finished_at: string | null
  effective_af_version: string | null
  effective_code_base_version: string | null
  ui_stack: string | null
  lane_branch: string | null
  gma_artifact: string | null
  gma_version: string | null
  native_render_api: string | null
  compile_sdk: number | null
  lifecycle_pin: string | null
  profile_capabilities: string[] | null
  profile_status: string | null
  profile_doc_path: string | null
  scenario_status: string | null
  scenario_description: string | null
  scenario_requires_capabilities: string[] | null
  catalog_content_sha: string | null
  catalog_summary: AdsScenarioSummary | null
  catalog_definition: AdsScenarioDefinition | null
  scenario_source_path: string | null
}

/** Profile × lib version — view v_ads_profile_matrix. */
export interface AdsProfileMatrixRow {
  version: string
  lib_branch: string | null
  verified_at: string | null
  evidence: string | null
  version_notes: string | null
  profile_id: string
  lane_branch: string | null
  ui_stack: string | null
  gma_artifact: string | null
  gma_version: string | null
  native_render_api: string | null
  compile_sdk: number | null
  lifecycle_pin: string | null
  host_excludes: string[] | null
  banned_symbols: string[] | null
  doc_path: string | null
  reference_host: string | null
  status: string | null
  profile_notes: string | null
  capabilities: string[] | null
  updated_at: string | null
}

/** Một file blueprint = một dòng bảng blueprint_files. Từ 0017 bytes ở Storage
 *  (storage_key), row cũ còn content_b64; queries.resolveContent() gộp về CÙNG shape.
 *  Meta (không kèm content) để dựng cây file; content lấy lazy khi mở. */
export interface BlueprintFileMeta {
  path: string
  content_type: string
  bytes: number | null
}

export interface BlueprintFileContent {
  path: string
  content_b64: string
  content_type: string
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

/** [0006] Một dòng = (run × lesson đã bơm qua prefetch) + phán quyết cuối run.
 *  'missing' = chưa định đoạt → run chưa được phép completed. */
export type LessonDisposition = 'applied_prevented' | 'contradicted' | 'not_relevant' | 'missing'

export interface RunLearningRow {
  run_id: number
  lesson_id: number
  slug: string
  title: string
  lesson_status: LessonStatus
  disposition: LessonDisposition
  note: string | null
  retrieved_in_phases: string[]
  first_retrieved_at: string
}

/** Lesson mới sinh trong run (observation kind='first_seen' + embed lessons). */
export interface RunNewLesson {
  lesson_id: number
  note: string | null
  lessons: { slug: string; title: string; status: LessonStatus } | null
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

/** 0020: role nghiệp vụ. 'member' giữ cho tài khoản cũ; v1 mọi role non-admin
 *  quyền giống nhau (đọc + đặt yêu cầu). */
export type UserRole = 'admin' | 'member' | 'dev' | 'ua' | 'aso'

/** Role admin cấp được khi tạo user (không cấp 'member' — tên cũ, tránh lẫn). */
export const ASSIGNABLE_ROLES: UserRole[] = ['dev', 'ua', 'aso', 'admin']

/** Team (nhãn thống kê app, khớp GitHub team af-products auto/titan). */
export const TEAMS = ['Auto', 'Titan'] as const

export interface AppUser {
  id: string
  email: string | null
  role: UserRole
  is_active: boolean
  created_at: string
}

// ─── af_versions (0020) — bản AF cho người đặt đơn chọn ────────────────
export interface AfVersion {
  version: string
  is_selectable: boolean
  sort_rank: number
  notes: string | null
  created_at: string
}

/** File đính kèm yêu cầu (bucket request-uploads, 0021). Lưu key + meta trong payload. */
export interface UploadedFile {
  key: string
  name: string
  size: number
  type: string
}

// ─── Requests queue (0020) ────────────────────────────────────────────
export type RequestType = 'make_app' | 'add_ads' | 'update_aso'
export type RequestStatus =
  | 'submitted'
  | 'accepted'
  | 'in_progress'
  | 'done'
  | 'rejected'
  | 'failed'
  | 'cancelled'

export interface AppRequest {
  id: number
  request_code: string
  type: RequestType
  requester: string
  requester_email: string | null
  af_version: string | null
  payload: Record<string, unknown>
  status: RequestStatus
  target_app_code: string | null
  run_id: number | null
  result: Record<string, unknown> | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface RequestEvent {
  id: number
  request_id: number
  actor: string | null
  from_status: string | null
  to_status: string | null
  message: string | null
  created_at: string
}

/** Nhãn tiếng Việt cho loại yêu cầu (dùng ở bảng + form). */
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  make_app: 'Make app',
  add_ads: 'Ads integration',
  update_aso: 'ASO',
}

/** Asset trang sản phẩm (/apps/:id) đọc từ blueprint whitelisted (aso/design/legal). */
export interface ProductAssets {
  title: string | null
  shortDesc: string | null
  fullDesc: string | null
  releaseNotes: string | null
  icon: string | null
  featureGraphic: string | null
  screenshots: string[]
  legal: { privacyUrl: string | null; termsUrl: string | null; verdict: string | null }
  designImages: { path: string; dataUri: string }[]
  hasDesignIndex: boolean
  /** iOS (App Store) layout — landing page + reviewer notes. Null cho app Android. */
  landingUrl: string | null
  supportUrl: string | null
  landingHtml: string | null
  reviewNotesMd: string | null
}

// ─── Appearance variants (contract cho form ASO) ──────────────────────
// AF (nâng cấp sau) sẽ sinh manifest này vào blueprint lúc make; AFC chỉ LOAD.
// Không có → form cho nhập tay (không bắt buộc).
export interface AppearanceVariant {
  ordinal: number
  id?: string
  label?: string
  /** đường dẫn blueprint-tương-đối tới ảnh preview (vd 'appearance/style_0.png'). */
  preview?: string
}
export interface AppearanceManifest {
  schema?: number
  design_variants?: number
  layouts: AppearanceVariant[]
  styles: AppearanceVariant[]
}
/** Kết quả suy biến thể của một app cho form ASO.
 *  source: 'manifest' = đọc appearance/variants.json · 'count' = chỉ suy được N
 *  từ task.md · 'none' = không biết gì → nhập tay. */
export interface AppearanceInfo {
  source: 'manifest' | 'count' | 'none'
  runName: string | null
  n: number | null
  layouts: AppearanceVariant[]
  styles: AppearanceVariant[]
}

export interface AppSettings {
  id: number
  signup_enabled: boolean
  updated_at: string
}

/** Trang đăng nhập cần biết điều này KHI CHƯA đăng nhập, nên nó đến từ RPC
 *  signup_status() chứ không từ bảng app_settings (bảng đó anon không đọc được). */
export interface SignupStatus {
  enabled: boolean
  bootstrap: boolean
}

/** ad_plans (migration 0033) — ad-contract đầy đủ soạn bằng Ads Builder.
 *  plan.body: funnel templates + style/layout + ads Home-onward. Xem AdsBuilder.tsx. */
export interface AdPlanBody {
  schema: string
  app?: string
  funnel?: Record<string, string>            // screenId -> templateCode (BF)
  style?: string | null
  layout?: string | null
  screens?: Record<string, { placements: Record<string, unknown>; events: Record<string, unknown> }>
}
export interface AdPlan {
  id: number
  app_id: number | null
  app_code: string | null
  name: string
  plan: AdPlanBody
  status: 'draft' | 'ready' | 'archived'
  created_at: string
  updated_at: string
  created_by: string | null
}
