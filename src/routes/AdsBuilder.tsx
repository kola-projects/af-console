import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adPlans, adPlan, saveAdPlan, deleteAdPlan, appsWithRuns, blueprintDir, blueprintFile } from '../lib/queries'
import { latestBlueprintRun } from '../components/appMeta'
import { appCodeOf, type AppRow, type AdPlanBody } from '../lib/types'
import { b64ToText } from '../lib/blueprint'
import { BF_SCREENS, BF_TEMPLATES_SOURCE } from '../lib/bfTemplates'
import { AppIcon } from '../components/AppSearchSelect'
import {
  AdScreenEditor, NavMap,
  type Manifest, type IndexFile, type Placement, type AdEvent,
} from './blueprint/AdZonesView'
import { Empty, ErrorBox, Loading } from '../components/ui'

/** Ads Builder — soạn AD-CONTRACT đầy đủ cho một app rồi lưu (bảng ad_plans, migration 0033).
 *  Wizard: App → Funnel templates (BF) → Style/Layout → Ads Home-onward → Lưu.
 *  File này KHÔNG tích hợp ads — chỉ soạn/lưu plan; `ads.sh --plan <id>` sẽ đọc để tích hợp. */

export default function AdsBuilder() {
  const [sp, setSp] = useSearchParams()
  // mở thẳng một plan để sửa khi có ?edit=<id> (từ nút Edit ở Ads V2 / nơi khác)
  const [editId, setEditId] = useState<number | null | 'new'>(() => { const e = sp.get('edit'); return e ? Number(e) : null })
  const close = () => { setEditId(null); if (sp.get('edit')) { sp.delete('edit'); setSp(sp, { replace: true }) } }
  if (editId === null) return <PlanList onOpen={(id) => setEditId(id)} onNew={() => setEditId('new')} />
  return <Wizard planId={editId === 'new' ? undefined : editId} onClose={close} />
}

// ───────────────────────── LIST ─────────────────────────
function PlanList({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const qc = useQueryClient()
  const plans = useQuery({ queryKey: ['ad-plans'], queryFn: adPlans })
  const appsQ = useQuery({ queryKey: ['apps-with-runs'], queryFn: appsWithRuns })
  const appOf = (code: string | null) => (appsQ.data ?? []).find((a) => appCodeOf(a) === code)
  const remove = async (id: number, name: string) => {
    if (!confirm(`Xoá plan "${name}"?`)) return
    await deleteAdPlan(id); qc.invalidateQueries({ queryKey: ['ad-plans'] })
  }
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Ads Builder</h1>
          <p className="text-sm text-neutral-500">Soạn ad-contract đầy đủ (funnel + style/layout + ads Home-onward) → lưu → <span className="font-mono">ads.sh --plan</span> tích hợp.</p>
        </div>
        <button onClick={onNew} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">+ Plan mới</button>
      </div>
      {plans.isLoading ? <Loading /> : plans.error ? <ErrorBox error={plans.error} /> : !plans.data?.length ? (
        <Empty>Chưa có plan nào. Bấm “Plan mới”.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] tracking-wide text-neutral-400 uppercase dark:bg-neutral-900">
              <tr><th className="px-4 py-2">Tên</th><th className="px-4 py-2">App</th><th className="px-4 py-2">Style / Layout</th><th className="px-4 py-2">Trạng thái</th><th className="px-4 py-2">Cập nhật</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody>
              {plans.data.map((p) => (
                <tr key={p.id} className="border-t border-neutral-100 dark:border-neutral-900">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2">
                    {(() => { const a = appOf(p.app_code ?? p.plan?.app ?? null)
                      return a
                        ? <div className="flex items-center gap-2"><AppIcon app={a} /><div className="min-w-0"><div className="truncate text-sm font-medium">{a.name}</div><div className="font-mono text-[11px] text-neutral-400">{appCodeOf(a)}</div></div></div>
                        : <span className="font-mono text-xs">{p.app_code ?? p.plan?.app ?? '—'}</span> })()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-500">{[p.plan?.style, p.plan?.layout].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-2"><span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[11px] dark:bg-neutral-800">{p.status}</span></td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-400">{p.updated_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => onOpen(p.id)} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">Mở</button>
                    <button onClick={() => remove(p.id, p.name)} className="ml-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">Xoá</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── WIZARD ─────────────────────────
type ScreenState = { placements: Record<string, Placement>; events: Record<string, AdEvent> }
const STEPS = ['App', 'Funnel', 'Style / Layout', 'Ads Home-onward', 'Lưu']

function Wizard({ planId, onClose }: { planId?: number; onClose: () => void }) {
  const qc = useQueryClient()
  const existing = useQuery({ queryKey: ['ad-plan', planId], queryFn: () => adPlan(planId!), enabled: !!planId })
  const appsQ = useQuery({ queryKey: ['apps-with-runs'], queryFn: appsWithRuns })

  const [step, setStep] = useState(0)
  const [app, setApp] = useState<AppRow | null>(null)
  const [name, setName] = useState('')
  const [funnel, setFunnel] = useState<Record<string, string>>({})
  const [style, setStyle] = useState<string | null>(null)
  const [layout, setLayout] = useState<string | null>(null)
  const [screens, setScreens] = useState<Record<string, ScreenState>>({})
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)

  // nạp plan cũ (một lần)
  useEffect(() => {
    if (!planId || !existing.data || !appsQ.data || hydrated) return
    const p = existing.data
    setName(p.name)
    setFunnel(p.plan?.funnel ?? {})
    setStyle(p.plan?.style ?? null)
    setLayout(p.plan?.layout ?? null)
    setScreens((p.plan?.screens as Record<string, ScreenState>) ?? {})
    setApp(appsQ.data.find((a) => a.id === p.app_id) ?? null)
    setHydrated(true)
  }, [planId, existing.data, appsQ.data, hydrated])

  const runName = app ? latestBlueprintRun(app) : null
  const az = useQuery({ queryKey: ['adzones', runName], queryFn: () => blueprintDir(runName!, 'adzones/'), enabled: !!runName })
  const parsed = useMemo(() => {
    let index: IndexFile | null = null
    const manifests: Record<string, Manifest> = {}
    for (const f of az.data ?? []) {
      try {
        const obj = JSON.parse(b64ToText(f.content_b64))
        if (f.path.endsWith('/index.json')) index = obj as IndexFile
        else manifests[f.path.replace(/^adzones\//, '')] = obj as Manifest
      } catch { /* skip */ }
    }
    return { index, manifests }
  }, [az.data])

  const body: AdPlanBody = {
    schema: 'adplan/1', app: app ? appCodeOf(app) ?? app.name : undefined,
    funnel, style, layout, screens,
  }

  const save = async (status: 'draft' | 'ready') => {
    if (!name.trim()) { alert('Đặt tên plan trước khi lưu.'); setStep(4); return }
    setSaving(true)
    try {
      await saveAdPlan({ id: planId, app_id: app?.id ?? null, app_code: app ? appCodeOf(app) : null, name: name.trim(), plan: body, status })
      qc.invalidateQueries({ queryKey: ['ad-plans'] })
      onClose()
    } catch (e) { alert('Lưu lỗi: ' + (e as Error).message) } finally { setSaving(false) }
  }

  const canNext = step === 0 ? !!app : step === 2 ? !!style && !!layout : true

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onClose} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">← danh sách</button>
        <h1 className="text-lg font-semibold">{planId ? 'Sửa plan' : 'Plan mới'}</h1>
        {app && <span className="font-mono text-xs text-neutral-400">{appCodeOf(app)} · {app.name}</span>}
      </div>

      {/* stepper */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => i <= step + 1 && setStep(i)}
            className={`rounded-full px-3 py-1 text-xs ${i === step ? 'bg-teal-600 text-white' : i < step ? 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300' : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-900'}`}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {/* STEP 0 — App */}
      {step === 0 && (
        appsQ.isLoading ? <Loading /> : (
          <div>
            <p className="mb-3 text-sm text-neutral-500">Chọn app đã có <span className="font-mono">blueprint/adzones</span> (build sau v5.12.0).</p>
            <div className="flex flex-wrap gap-2">
              {(appsQ.data ?? []).filter((a) => latestBlueprintRun(a)).map((a) => (
                <button key={a.id} onClick={() => { setApp(a); setStyle(null); setLayout(null) }}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${app?.id === a.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 dark:border-neutral-700'}`}>
                  <div className="font-medium">{a.name}</div><div className="font-mono text-[11px] text-neutral-400">{appCodeOf(a) ?? '—'}</div>
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {/* STEP 1 — Funnel templates (BF) */}
      {step === 1 && (
        <div>
          <p className="mb-1 text-sm text-neutral-500">Chọn template cho từng màn funnel của BF.</p>
          <p className="mb-4 text-xs text-amber-600">Nguồn: <b>{BF_TEMPLATES_SOURCE}</b> (mẫu tạm — sau đọc từ BF).</p>
          <div className="space-y-4">
            {BF_SCREENS.map((sc) => (
              <div key={sc.id}>
                <div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">{sc.label}</div>
                <div className="flex flex-wrap gap-2">
                  {sc.templates.map((t) => (
                    <button key={t.code} title={t.desc} onClick={() => setFunnel((f) => ({ ...f, [sc.id]: t.code }))}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${funnel[sc.id] === t.code ? 'border-teal-500 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200' : 'border-neutral-300 text-neutral-600 dark:border-neutral-700'}`}>
                      {t.label}{t.desc && <span className="ml-1.5 font-mono text-[10px] text-neutral-400">{t.desc}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2 — Style / Layout */}
      {step === 2 && (
        az.isLoading ? <Loading /> : !parsed.index ? <Empty>App này chưa có adzones (chạy build ≥ v5.12.0).</Empty> : (
          <div>
            <p className="mb-4 text-sm text-neutral-500">Zone bám <b>layout</b>; style chỉ skin preview.</p>
            <div className="mb-4"><div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Style</div>
              <div className="flex flex-wrap gap-2">{parsed.index.styles.map((s) => (
                <button key={s.id} onClick={() => setStyle(s.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${style === s.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 dark:border-neutral-700'}`}>{s.label}</button>))}</div>
            </div>
            <div><div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Layout</div>
              <div className="flex flex-wrap gap-2">{parsed.index.layouts.map((l) => (
                <button key={l.id} title={l.desc} onClick={() => setLayout(l.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${layout === l.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 dark:border-neutral-700'}`}>{l.label}</button>))}</div>
            </div>
          </div>
        )
      )}

      {/* STEP 3 — Ads Home-onward */}
      {step === 3 && (
        !parsed.index || !layout ? <Empty>Chọn style + layout ở bước trước.</Empty> : (
          <ScreensEditor index={parsed.index} manifests={parsed.manifests} layout={layout} runName={runName ?? undefined} screens={screens} setScreens={setScreens} />
        )
      )}

      {/* STEP 4 — Lưu */}
      {step === 4 && (
        <div className="max-w-xl">
          <div className="mb-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="border-b border-neutral-100 px-3 py-2 text-xs font-semibold dark:border-neutral-900">Xem trước ad-plan (JSON)</div>
            <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300">{JSON.stringify(body, null, 2)}</pre>
          </div>
          {/* tên kịch bản — đặt/sửa ngay trước khi lưu/export */}
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] tracking-wide text-neutral-400 uppercase">Tên kịch bản</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${app ? appCodeOf(app) : 'app'}-adplan`}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-neutral-700 dark:bg-neutral-900" />
          </label>
          <div className="flex items-center gap-2">
            <button disabled={saving} onClick={() => save('draft')} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">Lưu nháp</button>
            <button disabled={saving} onClick={() => save('ready')} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-40">Lưu · sẵn sàng tích hợp</button>
            {!name.trim() && <span className="text-xs text-amber-600">↑ đặt tên trước khi lưu</span>}
          </div>
        </div>
      )}

      {/* nav */}
      <div className="mt-8 flex justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-neutral-700">← Trước</button>
        {step < STEPS.length - 1 && (
          <button disabled={!canNext} onClick={() => setStep((s) => s + 1)} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">Tiếp →</button>
        )}
      </div>
    </div>
  )
}

// bước 3: chọn màn Home-onward + editor phone-in-context cho từng màn
function ScreensEditor({ index, manifests, layout, runName, screens, setScreens }: {
  index: IndexFile; manifests: Record<string, Manifest>; layout: string; runName?: string
  screens: Record<string, ScreenState>; setScreens: React.Dispatch<React.SetStateAction<Record<string, ScreenState>>>
}) {
  const list = index.screens.filter((s) => s.layouts.includes(layout) || s.layouts.includes('default'))
  const [sel, setSel] = useState<string>(list[0]?.id ?? '')
  const manifest = manifests[`${sel}.${layout}.json`] || manifests[`${sel}.default.json`] || Object.values(manifests).find((m) => m.screen === sel)

  // nav map (quan hệ màn) — dùng ảnh THẬT, bấm node để nhảy tới màn đó
  const navQ = useQuery({ queryKey: ['navmap', runName], queryFn: () => blueprintFile(runName!, 'navigation_map.md').catch(() => null), enabled: !!runName })
  const navText = navQ.data ? (() => { try { return b64ToText(navQ.data.content_b64) } catch { return '' } })() : ''
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '')
  const shotForScreen = (s: string) => { const n = norm(s); return Object.values(manifests).find((m) => norm(m.screen) === n && m.screenshot)?.screenshot || null }
  const pickByNav = (navId: string) => { const n = norm(navId); const sc = list.find((s) => { const x = norm(s.id); return x === n || x.includes(n) || n.includes(x) }); if (sc) setSel(sc.id) }

  const setP: React.Dispatch<React.SetStateAction<Record<string, Placement>>> = (u) =>
    setScreens((s) => { const cur = s[sel]?.placements ?? {}; const next = typeof u === 'function' ? u(cur) : u; return { ...s, [sel]: { placements: next, events: s[sel]?.events ?? {} } } })
  const setE: React.Dispatch<React.SetStateAction<Record<string, AdEvent>>> = (u) =>
    setScreens((s) => { const cur = s[sel]?.events ?? {}; const next = typeof u === 'function' ? u(cur) : u; return { ...s, [sel]: { placements: s[sel]?.placements ?? {}, events: next } } })

  const count = (id: string) => (Object.keys(screens[id]?.placements ?? {}).length + Object.keys(screens[id]?.events ?? {}).length)

  return (
    <div>
      {navText && (
        <div className="mb-4">
          <NavMap navText={navText} runName={runName || ''} shotForScreen={shotForScreen} onPick={pickByNav} />
          <p className="mt-1 text-[11px] text-neutral-400">Bấm màn trên sơ đồ để nhảy tới gắn ads. Màn đang chọn: <b className="text-neutral-600 dark:text-neutral-300">{sel}</b></p>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {list.map((s) => (
          <button key={s.id} onClick={() => setSel(s.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${sel === s.id ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 text-neutral-600 dark:border-neutral-700'}`}>
            {s.id}{count(s.id) > 0 && <span className="ml-1.5 rounded-full bg-teal-600 px-1.5 text-[10px] text-white">{count(s.id)}</span>}
          </button>
        ))}
      </div>
      {manifest
        ? <AdScreenEditor key={sel} manifest={manifest} runName={runName} placements={screens[sel]?.placements ?? {}} events={screens[sel]?.events ?? {}} setPlacements={setP} setEvents={setE} />
        : <Empty>Không thấy manifest cho màn “{sel}” ở layout {layout}.</Empty>}
    </div>
  )
}
