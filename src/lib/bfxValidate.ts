/** bfxValidate — cổng RESOURCE (shift-left) cho phần funnel của adplan/2.
 *
 *  Port của validate_config.py phía CLI (bám hàm gate() trong mockup Ads Builder):
 *  với mỗi màn → type bfx, mỗi resource-slot: nếu `required` mà CHƯA passed và
 *  KHÔNG có đường resolve nào cứu được (không 'default'+có default, không 'aigen')
 *  → HARD STOP. Trả cả `notes` (default / AI-GEN freeze WxH / conform WxH) để UI
 *  hiển thị phụ đề. Thuần — không phụ thuộc React/DB, dùng lại được ở nhiều nơi.
 */
import type { BfxCatalog, BfxResourceRule } from './types'

/** Thứ tự màn funnel + ký tự serial (SxLxOxWxUx). */
export const BFX_ORDER: Array<[screen: string, letter: string]> = [
  ['Splash', 'S'],
  ['Language', 'L'],
  ['Onboarding', 'O'],
  ['WelcomeBack', 'W'],
  ['Uninstall', 'U'],
]

export type SlotStatus = 'passed' | 'skip' | 'default' | 'aigen' | 'FAIL'

/** Một giá trị được coi là "passed" khi khác null/""/[] (mảng rỗng = chưa điền). */
export function isPassed(v: unknown): boolean {
  if (v == null || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

/** Trạng thái resolve của MỘT slot (đối chiếu giá trị đã điền với luật). */
export function resolveSlot(rule: BfxResourceRule, value: unknown): { status: SlotStatus } {
  if (isPassed(value)) return { status: 'passed' }
  if (!rule.required) return { status: 'skip' }
  if (rule.resolve.includes('default') && rule.default != null) return { status: 'default' }
  if (rule.resolve.includes('aigen')) return { status: 'aigen' }
  return { status: 'FAIL' }
}

export interface GateError {
  key: string
  resolve: string[]
}
export interface GateNote {
  key: string
  msg: string
}
export interface GateResult {
  ok: boolean
  errors: GateError[]
  notes: GateNote[]
}

/** Chạy cổng resource cho toàn bộ funnel đã chọn.
 *  @param catalog   catalog bfx (từ bfx_catalogs)
 *  @param screens   map screenName -> typeCode (vd { Splash:'S1', … })
 *  @param resources map "<TYPE>.<slot>" -> value|array|"aigen"
 */
export function bfxValidate(
  catalog: BfxCatalog | null,
  screens: Record<string, string>,
  resources: Record<string, unknown>,
): GateResult {
  const errors: GateError[] = []
  const notes: GateNote[] = []
  if (!catalog) return { ok: true, errors, notes }

  for (const [, code] of Object.entries(screens)) {
    const t = catalog.types[code]
    if (!t) continue
    for (const [slot, rule] of Object.entries(t.resources)) {
      const key = `${code}.${slot}`
      const r = resolveSlot(rule, resources[key])
      if (r.status === 'FAIL') {
        errors.push({ key, resolve: rule.resolve })
      } else if (r.status === 'default') {
        notes.push({ key, msg: 'default' })
      } else if (r.status === 'aigen') {
        notes.push({
          key,
          msg: `AI-GEN → FREEZE ${rule.conformance ? `${rule.conformance.width}×${rule.conformance.height}` : ''}`.trim(),
        })
      } else if (r.status === 'passed' && rule.conformance) {
        notes.push({ key, msg: `conform ${rule.conformance.width}×${rule.conformance.height}` })
      }
    }
  }
  return { ok: errors.length === 0, errors, notes }
}

/** Serial SxLxOxWxUx từ map màn→type (thiếu type thì để chấm, vd "S1L1O1W·U1"). */
export function bfxSerial(screens: Record<string, string>): string {
  return BFX_ORDER.map(([sc, letter]) => screens[sc] || `${letter}·`).join('')
}

/** Hợp nhất adSlots của các type đã chọn (advisory phủ ad-slot funnel). */
export function bfxAdSlotUnion(catalog: BfxCatalog | null, screens: Record<string, string>): string[] {
  const out: string[] = []
  if (!catalog) return out
  for (const code of Object.values(screens)) {
    for (const a of catalog.types[code]?.adSlots ?? []) if (!out.includes(a)) out.push(a)
  }
  return out
}
