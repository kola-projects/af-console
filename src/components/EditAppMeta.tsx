import { useMemo, useState } from 'react'
import { META_GROUPS, getPath, setPath, type MetaField, type MetaKind } from '../lib/appMetaFields'
import { appCodeOf, type AppRow } from '../lib/types'
import { Badge, Mono } from './ui'

/** Store (v_stores) cho select + hiển thị read-only ở trang app. */
export interface StoreOpt {
  id: number
  store_code: string
  name: string | null
  display_name: string | null
  support_email: string | null
  extra: Record<string, unknown> | null
}

/** Patch gửi lên: chỉ gồm trường ĐÃ ĐỔI so với lúc mở form. */
export interface MetaPatch {
  cols: Record<string, unknown>
  extra: Record<string, unknown>
  integration: Record<string, unknown>
  legal_urls: Record<string, unknown>
  /** undefined = không đổi · '' = bỏ store · 'aNNN' = gán store */
  store_code?: string
}

type Form = Record<string, string | boolean>

const inputCls =
  'mt-1 w-full rounded border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900'

function readRaw(app: AppRow, store: StoreOpt | null, kind: MetaKind, key: string): unknown {
  switch (kind) {
    case 'col':
      return getPath(app, key)
    case 'extra':
      return getPath(app.extra, key)
    case 'integration':
      return getPath(app.integration, key)
    case 'legal':
      return getPath(app.legal_urls, key)
    case 'store':
      return store ? getPath(store, key) : undefined
  }
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

/** Giá trị hiệu lực + nguồn (chính hay fallback nào). */
function readField(app: AppRow, store: StoreOpt | null, f: MetaField): { value: unknown; from: string | null } {
  const v = readRaw(app, store, f.kind, f.key)
  if (!isEmpty(v)) return { value: v, from: null }
  for (const fb of f.fallback ?? []) {
    const dot = fb.indexOf('.')
    const kind = fb.slice(0, dot) as MetaKind
    const key = fb.slice(dot + 1)
    const fv = readRaw(app, store, kind, key)
    if (!isEmpty(fv)) return { value: fv, from: fb }
  }
  return { value: undefined, from: null }
}

function toForm(f: MetaField, v: unknown): string | boolean {
  if (f.input === 'bool') return v === true
  if (isEmpty(v)) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function fromForm(f: MetaField, v: string | boolean): unknown {
  if (f.input === 'bool') return v === true
  const s = String(v).trim()
  if (!s) return null
  if (f.input === 'number') {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return s
}

function ReadonlyValue({ f, value }: { f: MetaField; value: unknown }) {
  if (isEmpty(value)) return <span className="text-neutral-400">—</span>
  if (typeof value === 'boolean') return <Badge tone={value ? 'good' : undefined}>{value ? 'true' : 'false'}</Badge>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-neutral-400">[]</span>
    if (typeof value[0] === 'object' && value[0] && 'ad_name' in (value[0] as object)) {
      const rows = value as Array<{ ad_name?: string; ad_type?: string; ad_id?: string; description?: string }>
      return (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-neutral-500">{rows.length} placement</summary>
          <div className="mt-1 max-h-56 overflow-auto rounded border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-[11px]">
              <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
                <tr>
                  <th className="px-2 py-1">ad_name</th>
                  <th className="px-2 py-1">type</th>
                  <th className="px-2 py-1">ad_id</th>
                  <th className="px-2 py-1">mô tả</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-2 py-1 font-mono">{r.ad_name}</td>
                    <td className="px-2 py-1">{r.ad_type}</td>
                    <td className="px-2 py-1 font-mono">{r.ad_id}</td>
                    <td className="px-2 py-1 text-neutral-500">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )
    }
    if (f.input === 'json' || typeof value[0] === 'object') {
      return <pre className="mt-1 max-h-40 overflow-auto rounded bg-neutral-50 p-2 text-[11px] dark:bg-neutral-900">{JSON.stringify(value, null, 1)}</pre>
    }
    return <span>{(value as unknown[]).map(String).join(', ')}</span>
  }
  if (typeof value === 'object') {
    return <pre className="mt-1 max-h-40 overflow-auto rounded bg-neutral-50 p-2 text-[11px] dark:bg-neutral-900">{JSON.stringify(value, null, 1)}</pre>
  }
  const s = String(value)
  if (/^https?:\/\//.test(s)) {
    return (
      <a className="break-all text-sky-700 underline dark:text-sky-400" href={s} target="_blank" rel="noreferrer">
        {s}
      </a>
    )
  }
  return <span className="break-all">{s}</span>
}

/** Trang "Sửa metadata app" — render theo spec lib/appMetaFields.ts (edit / readonly), lưu CHỈ trường đã đổi. */
export function EditAppMeta({
  app,
  stores,
  pending,
  onClose,
  onSave,
}: {
  app: AppRow
  stores: StoreOpt[]
  pending: boolean
  onClose: () => void
  onSave: (patch: MetaPatch) => void
}) {
  const store = useMemo(() => stores.find((s) => s.id === app.store_id) ?? null, [stores, app.store_id])
  const fields = useMemo(() => META_GROUPS.flatMap((g) => g.fields), [])
  const initial = useMemo(() => {
    const out: Form = {}
    const from: Record<string, string | null> = {}
    for (const f of fields) {
      if (f.mode !== 'edit') continue
      const r = readField(app, store, f)
      out[f.id] = toForm(f, f.kind === 'store' && f.key === 'store_code' && !r.value ? '' : r.value)
      from[f.id] = r.from
    }
    return { values: out, from }
  }, [app, store, fields])
  const [form, setForm] = useState<Form>(initial.values)
  const set = (id: string, v: string | boolean) => setForm((p) => ({ ...p, [id]: v }))

  const dirty = useMemo(() => fields.filter((f) => f.mode === 'edit' && form[f.id] !== initial.values[f.id]), [fields, form, initial])

  const save = () => {
    const patch: MetaPatch = { cols: {}, extra: {}, integration: {}, legal_urls: {} }
    for (const f of dirty) {
      const v = fromForm(f, form[f.id])
      switch (f.kind) {
        case 'col':
          patch.cols[f.key] = v
          break
        case 'extra':
          setPath(patch.extra, f.key, v)
          break
        case 'integration':
          setPath(patch.integration, f.key, v)
          break
        case 'legal':
          setPath(patch.legal_urls, f.key, v)
          break
        case 'store':
          patch.store_code = v === null ? '' : String(v)
          break
      }
    }
    onSave(patch)
  }

  const platform = (app.platform ?? 'android') === 'ios' ? ' iOS' : '🤖 Android'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Sửa metadata app</div>
          <span className="text-xs text-neutral-500">
            {dirty.length ? `${dirty.length} trường đã đổi` : 'chưa đổi gì'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          {appCodeOf(app) && <Mono className="font-semibold">{appCodeOf(app)}</Mono>}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{app.name}</span>
          <Badge tone={(app.platform ?? 'android') === 'ios' ? undefined : 'good'}>{platform}</Badge>
          {app.integration?.checked_at && (
            <span className="text-neutral-500">quét {app.integration.checked_at}</span>
          )}
        </div>

        {META_GROUPS.map((g) => (
          <section key={g.title} className="mt-5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{g.title}</div>
            {g.note && <div className="mt-0.5 text-[11px] text-neutral-500">{g.note}</div>}
            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
              {g.fields.map((f) => {
                if (f.mode === 'readonly') {
                  const r = readField(app, store, f)
                  const wide = f.input === 'list' || f.input === 'json'
                  return (
                    <div key={f.id} className={`text-xs text-neutral-500 ${wide ? 'md:col-span-2' : ''}`}>
                      <span title={f.id}>{f.label}</span>
                      <div className="mt-0.5 text-sm text-neutral-800 dark:text-neutral-200">
                        <ReadonlyValue f={f} value={r.value} />
                      </div>
                    </div>
                  )
                }
                const from = initial.from[f.id]
                const hint = [f.hint, from ? `từ ${from}` : null].filter(Boolean).join(' · ')
                if (f.input === 'bool') {
                  return (
                    <label key={f.id} className="flex cursor-pointer items-center gap-2 pt-5 text-sm" title={f.id}>
                      <input
                        type="checkbox"
                        checked={form[f.id] === true}
                        disabled={pending}
                        onChange={(e) => set(f.id, e.target.checked)}
                      />
                      {f.label}
                    </label>
                  )
                }
                if (f.input === 'select') {
                  const opts =
                    f.kind === 'store' ? stores.map((s) => ({ v: s.store_code, l: `${s.store_code} · ${s.display_name ?? s.name ?? ''}` })) : (f.options ?? []).map((o) => ({ v: o, l: o }))
                  return (
                    <label key={f.id} className="block text-xs text-neutral-500" title={f.id}>
                      {f.label}
                      {hint && <span className="ml-1 text-[10px] text-neutral-400">({hint})</span>}
                      <select className={inputCls} value={String(form[f.id] ?? '')} disabled={pending} onChange={(e) => set(f.id, e.target.value)}>
                        <option value="">—</option>
                        {opts.map((o) => (
                          <option key={o.v} value={o.v}>
                            {o.l}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                }
                return (
                  <label key={f.id} className="block text-xs text-neutral-500" title={f.id}>
                    {f.label}
                    {hint && <span className="ml-1 text-[10px] text-neutral-400">({hint})</span>}
                    <input
                      className={inputCls}
                      type={f.input === 'number' ? 'number' : 'text'}
                      value={String(form[f.id] ?? '')}
                      disabled={pending}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.id, e.target.value)}
                    />
                  </label>
                )
              })}
            </div>
          </section>
        ))}

        <div className="sticky bottom-0 mt-6 flex justify-end gap-2 border-t border-neutral-200 bg-white pt-3 dark:border-neutral-800 dark:bg-neutral-950">
          <button
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            onClick={onClose}
            disabled={pending}
          >
            Huỷ
          </button>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            onClick={save}
            disabled={pending || !dirty.length}
          >
            {pending ? 'Đang lưu…' : `Lưu${dirty.length ? ` (${dirty.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
