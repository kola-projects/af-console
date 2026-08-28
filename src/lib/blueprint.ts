/** Helpers thuần cho blueprint viewer — decode base64 & phân loại file.
 *  Không import React: dùng được cả trong component lẫn ngoài. */

/** base64 → bytes gốc. Đúng cho MỌI loại (text lẫn nhị phân).
 *  Cấp phát trên ArrayBuffer tường minh để type khớp Blob/TextDecoder (TS6 lib generic).
 *  Bỏ whitespace — CLI `base64` hay wrap 76 cột, atob sẽ ném InvalidCharacterError. */
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** bytes → base64. Dùng khi tải object từ Storage (0017) rồi trả về shape content_b64
 *  cũ cho mọi viewer. Chunk 0x8000 tránh tràn stack của String.fromCharCode(...spread). */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** base64 → chuỗi UTF-8. KHÔNG dùng atob() trực tiếp làm chuỗi: atob trả Latin-1,
 *  làm hỏng ký tự đa byte (tiếng Việt, Ả-Rập/RTL…). Phải qua TextDecoder. */
export function b64ToText(b64: string): string {
  return new TextDecoder('utf-8').decode(b64ToBytes(b64))
}

/** base64 → objectURL cho <img>/<iframe>. Nhớ URL.revokeObjectURL khi unmount. */
export function b64ToObjectURL(b64: string, contentType: string): string {
  const blob = new Blob([b64ToBytes(b64)], { type: contentType })
  return URL.createObjectURL(blob)
}

/** data: URL — tiện khi muốn nhúng thẳng vào HTML mà không phải quản lý vòng đời objectURL. */
export function b64ToDataURL(b64: string, contentType: string): string {
  return `data:${contentType};base64,${b64.replace(/\s+/g, '')}`
}

/** MIME tin cậy theo đuôi path. Pipeline đôi khi ghi SVG/CSS là text/plain → data URL
 *  `data:text/plain;base64,…` làm <img>/<link> không render. */
export function mimeOf(path: string, contentType?: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  const byExt: Record<string, string> = {
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    html: 'text/html',
    htm: 'text/html',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    json: 'application/json',
  }
  if (byExt[ext]) return byExt[ext]
  return contentType?.split(';')[0]?.trim() || 'application/octet-stream'
}

export type RenderKind = 'md' | 'html' | 'image' | 'svg' | 'json' | 'text'

/** Chọn kiểu render theo ĐUÔI path (nguồn tin cậy hơn content_type của pipeline). */
export function renderKindOf(path: string, contentType?: string): RenderKind {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') return 'image'
  if (ext === 'json') return 'json'
  // Fallback theo content_type khi đuôi không rõ.
  if (contentType?.startsWith('image/')) return contentType.includes('svg') ? 'svg' : 'image'
  if (contentType?.includes('html')) return 'html'
  if (contentType?.includes('json')) return 'json'
  return 'text'
}

export type Group = 'docs' | 'aso' | 'mockups' | 'adzones' | 'legal' | 'screenshots' | 'data'

/** Nhóm cho sidebar. Mockups = design_previews/* (html + icon svg),
 *  adzones = adzones/* (data editor kéo-thả ads, xem instructions/adzones.md),
 *  legal = legal/*, screenshots = image_refs/*, data = local_data|api_specs/*,
 *  aso = aso/* (gói store listing Google Play), còn lại = docs (spec, md). */
export function groupOf(path: string): Group {
  if (path.startsWith('aso/')) return 'aso'
  if (path.startsWith('design_previews/')) return 'mockups'
  if (path.startsWith('adzones/')) return 'adzones'
  if (path.startsWith('legal/')) return 'legal'
  if (path.startsWith('image_refs/')) return 'screenshots'
  if (path.startsWith('local_data/') || path.startsWith('api_specs/')) return 'data'
  return 'docs'
}

export const GROUP_LABEL: Record<Group, string> = {
  docs: 'Docs',
  aso: 'ASO',
  mockups: 'Design preview',
  adzones: 'Ad zones',
  legal: 'Legal',
  screenshots: 'Screenshots',
  data: 'Data',
}

/** Thứ tự nhóm hiển thị + thứ tự ưu tiên trong nhóm docs (theo HANDOFF §3). */
export const GROUP_ORDER: Group[] = ['docs', 'aso', 'mockups', 'adzones', 'legal', 'screenshots', 'data']

/** Nhóm trang SẢN PHẨM cho non-admin (khớp whitelist RLS 0023: aso/design_previews/legal). */
export const PRODUCT_GROUPS: Group[] = ['aso', 'mockups', 'legal']

const DOC_PRIORITY = [
  'order.md',
  'task.md',
  'implementation_spec.md',
  'design_system.md',
  'navigation_map.md',
  'GENERATED.md',
]

/** Sắp file trong một nhóm: docs theo ưu tiên đã biết rồi tới abc; nhóm khác abc thuần. */
export function sortInGroup(paths: string[], group: Group): string[] {
  if (group !== 'docs') return [...paths].sort()
  return [...paths].sort((a, b) => {
    const ia = DOC_PRIORITY.indexOf(a)
    const ib = DOC_PRIORITY.indexOf(b)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.localeCompare(b)
  })
}

/** Tên file cuối (bỏ thư mục) — hiển thị gọn ở sidebar. */
export function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
