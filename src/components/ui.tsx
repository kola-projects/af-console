import type { ReactNode } from 'react'
import type { BugCategory } from '../lib/types'

/** Màu CÓ NGHĨA, không trang trí. Đỏ dành riêng cho loại lỗi đắt nhất:
 *  compile xanh, review tĩnh không thấy, chỉ chết khi người dùng bấm. */
const CATEGORY_TONE: Record<BugCategory, string> = {
  logic_compile_ok:
    'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200 ring-red-200 dark:ring-red-900',
  build_fail: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  runtime_only:
    'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200 ring-amber-200 dark:ring-amber-900',
  api_contract: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  permission: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  ui_theme: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  config: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  dependency: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  other: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
}

export function CategoryBadge({ category }: { category: BugCategory }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${CATEGORY_TONE[category]}`}>
      {category}
    </span>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const tones = {
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    good: 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200',
    warn: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
    bad: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
  }
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${tones[tone]}`}>{children}</span>
}

/** Định danh (slug, error_signature, run_name, toạ độ lib) — thứ để COPY đi dán,
 *  không phải thứ để đọc lướt. Luôn monospace. */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-xs ${className}`}>{children}</span>
}

/** Giờ địa phương, KHÔNG phải UTC. `run_name` nhúng giờ lúc sinh app
 *  (Columbia-20260715-181213 = 18:12 giờ máy), nên cắt chuỗi ISO sẽ hiện 11:12
 *  và người đọc tưởng là hai lần chạy khác nhau. */
export function localTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
      {children}
    </div>
  )
}

export function Loading() {
  return <div className="px-1 py-6 text-sm text-neutral-500">Đang tải…</div>
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {msg}
      {/permission denied|JWT|row-level/i.test(msg) && (
        <p className="mt-1 text-xs opacity-80">
          Thường là RLS chặn: đăng nhập lại, hoặc kiểm tra migration 0002 đã apply chưa.
        </p>
      )}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'good' | 'bad'
}) {
  const color =
    tone === 'good'
      ? 'text-green-700 dark:text-green-300'
      : tone === 'bad'
        ? 'text-red-700 dark:text-red-300'
        : ''
  return (
    <div className="rounded-lg bg-neutral-50 px-4 py-3 dark:bg-neutral-900">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-normal text-neutral-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Row({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  /** Cho phép click cả hàng (vd mở trang chi tiết). Control con muốn chặn điều hướng thì gọi e.stopPropagation(). */
  onClick?: () => void
  className?: string
}) {
  const clickable = !!onClick
  return (
    <tr
      className={`border-b border-neutral-100 align-top hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900${
        clickable ? ' cursor-pointer' : ''
      } ${className}`}
      onClick={onClick}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {children}
    </tr>
  )
}

export function Cell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`py-2 pr-4 ${className}`}>{children}</td>
}
