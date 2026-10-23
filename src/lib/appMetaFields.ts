/** [3.48.0] Spec trường của trang "Sửa metadata app" — sinh từ bảng đánh dấu
 *  APP_METADATA_FIELDS_TABLE (AF, 2026-10-23): mode `edit` = cho sửa · `readonly` = chỉ hiển thị/lọc.
 *  Nguồn ghi/đọc của mỗi trường (`kind` + `key`):
 *   - col         : cột thật bảng apps
 *   - extra       : apps.extra.<key>   (admin nhập / launcher ghi — scan KHÔNG đè, chỉ backfill khi trống)
 *   - integration : apps.integration.<key> (integration-scan ghi lại mỗi lần quét ⇒ sửa tay sẽ bị quét đè
 *                   với app có repo trong kho; app ngoài kho thì giữ)
 *   - legal       : apps.legal_urls.<key>
 *   - store       : bảng stores (v_stores) theo apps.store_id — chỉ đọc ở trang app
 *  `fallback` = chỗ đọc dự phòng khi giá trị chính trống (vd scan ghi integration.* còn extra chưa có). */
import { TEAMS } from './types'

export type MetaMode = 'edit' | 'readonly'
export type MetaKind = 'col' | 'extra' | 'integration' | 'legal' | 'store'
export type MetaInput = 'text' | 'bool' | 'number' | 'select' | 'list' | 'json'

export interface MetaField {
  /** id = đường dẫn trong file metadata xuất (app.integration.ads.serial) */
  id: string
  label: string
  mode: MetaMode
  kind: MetaKind
  key: string
  input?: MetaInput
  options?: readonly string[]
  /** đường dẫn dự phòng dạng `<kind>.<key>` */
  fallback?: string[]
  hint?: string
  placeholder?: string
}

export interface MetaGroup {
  title: string
  note?: string
  fields: MetaField[]
}

const ro = (id: string, label: string, kind: MetaKind, key: string, extra: Partial<MetaField> = {}): MetaField => ({
  id,
  label,
  mode: 'readonly',
  kind,
  key,
  ...extra,
})
const ed = (id: string, label: string, kind: MetaKind, key: string, extra: Partial<MetaField> = {}): MetaField => ({
  id,
  label,
  mode: 'edit',
  kind,
  key,
  input: 'text',
  ...extra,
})

export const META_GROUPS: MetaGroup[] = [
  {
    title: 'Danh tính (cột apps)',
    fields: [
      ro('app.id', 'ID', 'col', 'id'),
      ro('app.app_code', 'Mã app', 'col', 'app_code', { hint: 'Khoá ổn định — không đổi qua trang này' }),
      ro('app.app_codes', 'Mọi mã từng gán', 'col', 'app_codes', { input: 'list' }),
      ed('app.name', 'Tên app', 'col', 'name'),
      ed('app.name_on_phone', 'Tên trên máy', 'extra', 'name_on_phone', {
        fallback: ['integration.name_on_phone', 'extra.checklist.name_on_phone.value'],
        hint: 'strings.xml app_name',
      }),
      ed('app.name_on_store', 'Tên trên store', 'extra', 'name_on_store', {
        fallback: ['extra.checklist.name_on_store.value'],
      }),
      ed('app.package_name', 'Package name', 'col', 'package_name', { fallback: ['integration.applicationId'] }),
      ed('app.platform', 'Nền tảng', 'col', 'platform', { input: 'select', options: ['android', 'ios'] }),
      ed('app.team', 'Team', 'col', 'team', { input: 'select', options: TEAMS, fallback: ['integration.make.team'] }),
      ro('app.source_kind', 'Nguồn sinh app', 'col', 'source_kind'),
      ro('app.created_at', 'Ngày tạo', 'col', 'created_at'),
      ed('app.is_hidden', 'Ẩn khỏi danh mục', 'col', 'is_hidden', { input: 'bool' }),
      ed('app.store.store_code', 'Store', 'store', 'store_code', {
        input: 'select',
        fallback: ['integration.make.store_code', 'legal.store_code'],
      }),
      ro('app.store_id', 'Store ID', 'col', 'store_id'),
      ed('app.family_code', 'Mã master (multi-version)', 'col', 'family_code', { placeholder: 'trống = app solo' }),
      ro('app.family_role', 'Vai trò family', 'col', 'family_role'),
      ro('app.family_seq', 'Thứ tự app con', 'col', 'family_seq'),
      ro('app.variant_spec', 'Đặc tả biến thể', 'col', 'variant_spec', { input: 'json' }),
    ],
  },
  {
    title: 'Build (make.sh)',
    note: 'integration.* do integration-scan ghi lại mỗi lần quét; sửa tay chỉ bền với app không có repo trong kho.',
    fields: [
      ed('app.src', 'App mẫu (--src)', 'extra', 'make.src', {
        fallback: ['integration.make.src'],
        placeholder: 'https://play.google.com/… | git | .apk',
      }),
      ed('app.mode', 'Mode (--mode)', 'extra', 'make.mode', {
        fallback: ['integration.make.mode'],
        placeholder: 'changeLayoutAuto, full, …',
      }),
      ed('app.v', 'Số biến thể giao diện (-v)', 'extra', 'make.v', { input: 'number', fallback: ['integration.make.v'] }),
      ed('app.integration.af_version', 'AF version lúc build', 'integration', 'af_version'),
      ed('app.libraries.code_base.kind', 'Code base', 'integration', 'code_base.kind', {
        input: 'select',
        options: ['ajcb', 'axcb'],
      }),
      ed('app.libraries.code_base.used', 'Tag code base đang dùng', 'integration', 'code_base.used', { placeholder: 'v2.4' }),
      ro('app.integration.scanned_dir', 'Thư mục đã quét', 'integration', 'scanned_dir'),
      ro('app.integration.branch_count', 'Số nhánh git', 'integration', 'branch_count'),
      ro('app.integration.checked_at', 'Ngày quét', 'integration', 'checked_at'),
    ],
  },
  {
    title: 'Legal & landing',
    fields: [
      ed('app.legal_urls.repo_url', 'Repo legal', 'legal', 'repo_url'),
      ed('app.legal_urls.base_url', 'URL gốc GitHub Pages', 'legal', 'base_url'),
      ed('app.legal_urls.pages.privacy', 'URL Privacy', 'legal', 'pages.privacy', { fallback: ['legal.privacy_url'] }),
      ed('app.legal_urls.pages.terms', 'URL Terms', 'legal', 'pages.terms', { fallback: ['legal.terms_url'] }),
      ed('app.legal_urls.pages.landing', 'URL landing', 'legal', 'pages.landing'),
      ro('app.integration.legal', 'Trạng thái legal', 'integration', 'legal'),
      ro('app.integration.legal_repo', 'Repo legal', 'integration', 'legal_repo'),
      ro('app.integration.legal_source', 'Nguồn legal', 'integration', 'legal_source'),
      ro('app.integration.landing', 'Trạng thái landing', 'integration', 'landing'),
    ],
  },
  {
    title: 'Tích hợp & liên kết',
    fields: [
      ed('app.integration.github', 'GitHub repo', 'extra', 'github', { fallback: ['integration.github'] }),
      ed('app.integration.aso', 'Đã có gói ASO', 'integration', 'aso', { input: 'bool' }),
      ed('app.integration.cicd.integrated', 'Đã có CI/CD', 'integration', 'cicd.integrated', { input: 'bool' }),
      ed('app.extra.dashboard_url', 'Dashboard link', 'extra', 'dashboard_url'),
      ro('app.go_live', 'Đã live Play', 'col', 'go_live'),
    ],
  },
  {
    title: 'Ads',
    fields: [
      ed('app.integration.ads.status', 'Mức tích hợp ads', 'integration', 'ads.status', {
        input: 'select',
        options: ['none', 'funnel', 'full'],
      }),
      ro('app.integration.ads.engine', 'Engine', 'integration', 'ads.engine'),
      ed('app.integration.ads.funnel_version', 'Version funnel', 'integration', 'ads.funnel_version'),
      ed('app.integration.ads.module_ads', 'Version module-ads', 'integration', 'ads.module_ads'),
      ed('app.integration.ads.lane', 'Lane', 'integration', 'ads.lane'),
      ed('app.integration.ads.serial', 'Serial funnel', 'integration', 'ads.serial', { placeholder: 'S1L2O1W1U1' }),
      ro('app.integration.ads.scope', 'Scope', 'integration', 'ads.scope'),
      ro('app.integration.ads.adsMode', 'adsMode', 'integration', 'ads.adsMode'),
      ro('app.integration.ads.branch', 'Nhánh có ads', 'integration', 'ads.branch'),
      ro('app.integration.ads.host', 'Thư mục host', 'integration', 'ads.host'),
      ro('app.integration.ads.host_ref', 'Nhánh code host', 'integration', 'ads.host_ref'),
      ro('app.integration.ads.host_kind', 'Loại host', 'integration', 'ads.host_kind'),
      ro('app.integration.ads.host_wired', 'Host đã nối', 'integration', 'ads.host_wired'),
      ro('app.integration.ads.host_any_branch', 'Có host ở nhánh nào', 'integration', 'ads.host_any_branch'),
      ro('app.integration.ads.lock_missing', 'Thiếu funnel.lock', 'integration', 'ads.lock_missing'),
      ro('app.integration.ads.versions_seen', 'Lịch sử tích hợp ads', 'integration', 'ads.versions_seen', { input: 'json' }),
      ed('app.integration.admob_app_id', 'AdMob App ID', 'extra', 'ads.admob_app_id', {
        fallback: ['integration.admob_app_id'],
        placeholder: 'ca-app-pub-…~…',
      }),
      ed('app.integration.adjust_token', 'Adjust token', 'extra', 'attribution.adjust_token', {
        fallback: ['integration.attribution.adjust_token'],
      }),
      ed('app.integration.adjust_event_token', 'Adjust event token', 'extra', 'attribution.adjust_event_token', {
        fallback: ['integration.attribution.adjust_event_token'],
      }),
      ed('app.integration.fb_app_id', 'Facebook App ID', 'extra', 'attribution.facebook_app_id', {
        fallback: ['integration.attribution.fb_app_id'],
      }),
      ed('app.integration.fb_client_token', 'Facebook client token', 'extra', 'attribution.facebook_client_token', {
        fallback: ['integration.attribution.fb_client_token'],
      }),
      ed('app.integration.discord.webhook_url', 'Discord webhook', 'extra', 'discord.webhook_url', {
        placeholder: 'https://discord.com/api/webhooks/…',
      }),
      ed('app.integration.discord.user_id', 'Discord user được tag', 'extra', 'discord.user_id', {
        fallback: ['integration.discord.user_id'],
      }),
      ro('app.integration.ads_script.source.sheet_id', 'Sheet kịch bản ads', 'integration', 'ads_script.source.sheet_id', {
        fallback: ['extra.ads_script.sheet'],
      }),
      ro('app.integration.ads_script.ads_ids', 'Kịch bản ads (placement)', 'integration', 'ads_script.ads_ids', {
        input: 'list',
      }),
    ],
  },
  {
    title: 'Firebase',
    fields: [
      ed('app.integration.owner_firebase_email', 'Email chủ Firebase PROD', 'extra', 'firebase.owner_email', {
        fallback: ['store.extra.firebase.account_email'],
      }),
      ed('app.integration.google_services.prod.file', 'File google-services PROD', 'extra', 'firebase.prod.file', {
        fallback: ['integration.google_services.prod.file'],
        placeholder: 'app/google-services.json',
      }),
      ro('app.integration.google_services.prod.project_id', 'Firebase project PROD', 'integration', 'google_services.prod.project_id', {
        fallback: ['integration.firebase_prod.project_id', 'extra.firebase.prod.project_id'],
      }),
      ro('app.integration.google_services.prod.mobilesdk_app_id', 'Firebase app id PROD', 'integration', 'google_services.prod.mobilesdk_app_id', {
        fallback: ['integration.firebase_prod.mobilesdk_app_id', 'extra.firebase.prod.mobilesdk_app_id'],
      }),
      ro('app.integration.google_services.prod.updated_at', 'Firebase PROD cập nhật', 'integration', 'firebase_prod.updated_at'),
      ro('app.integration.google_services.dev.project_id', 'Firebase DEV đã dùng', 'integration', 'google_services.dev.project_id', {
        fallback: ['extra.firebase.dev.project_id'],
      }),
    ],
  },
  {
    title: 'Ký release (keystore)',
    note: 'Password lưu rõ theo quyết định chủ sản phẩm; mặc định = applicationId, alias key0.',
    fields: [
      ed('app.integration.signing.keystore_file', 'File keystore', 'extra', 'signing.keystore_file', {
        fallback: ['integration.signing.keystore_file'],
        placeholder: 'config/upload-keystore.jks',
      }),
      ed('app.integration.signing.alias', 'Alias', 'extra', 'signing.alias', {
        fallback: ['integration.signing.alias'],
        placeholder: 'key0',
      }),
      ed('app.integration.signing.storepass', 'Password keystore', 'extra', 'signing.storepass', {
        fallback: ['integration.signing.storepass'],
      }),
      ed('app.integration.signing.keypass', 'Password key', 'extra', 'signing.keypass', {
        fallback: ['integration.signing.keypass'],
      }),
    ],
  },
  {
    title: 'Store (bảng stores — sửa ở trang /stores)',
    fields: [
      ro('app.store.support_email', 'Email store', 'store', 'support_email'),
      ro('app.store.github_org', 'Org GitHub store', 'store', 'extra.github_org'),
      ro('app.store.platform', 'Nền tảng store', 'store', 'extra.platform'),
    ],
  },
]

export const META_FIELDS: MetaField[] = META_GROUPS.flatMap((g) => g.fields)

/** Đọc giá trị theo đường dẫn chấm trong object lồng nhau. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const k of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** Ghi giá trị theo đường dẫn chấm (tạo object trung gian). Mutate + trả về obj. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.')
  let cur: Record<string, unknown> = obj
  for (const k of keys.slice(0, -1)) {
    const next = cur[k]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]] = value
  return obj
}

/** Deep-merge `patch` vào `base` (object lồng nhau; mảng/scalar thay thế). */
export function deepMerge(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> =
    base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {}
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = deepMerge(cur, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}
