import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adPlans, adPlan, saveAdPlan, deleteAdPlan, appsWithRuns,
  bfxCatalogs, bfxCatalog, selectableAfVersions, createRequest, blueprintDir, blueprintFile,
} from '../lib/queries'
import { latestAdzonesRun } from '../components/appMeta'
import { b64ToText } from '../lib/blueprint'
import { appCodeOf, type AppRow, type AdPlanBody, type AdPlanTheme, type BfxCatalog, type BfxType } from '../lib/types'
import { AppIcon } from '../components/AppSearchSelect'
import { Empty, ErrorBox, Loading } from '../components/ui'
import { NavMap, Shot, archPos, type IndexFile, type Manifest } from './blueprint/AdZonesView'
import {
  bfxValidate, bfxSerial, bfxAdSlotUnion, resolveSlot, BFX_ORDER,
  type GateResult,
} from '../lib/bfxValidate'

/** Ads Builder — soạn AD-CONTRACT ĐẦY ĐỦ (adplan/2) cho một app rồi lưu (bảng ad_plans).
 *  Wizard 6 bước: App → Style/Theme → Layout → Funnel (bfx) → Ads Home-trở-đi → Kích hoạt.
 *  "Kích hoạt adsx" lưu plan (status ready) rồi tạo order type='adsx' → ./adsx.sh tích hợp
 *  funnel (bfx) + ads Home-trở-đi trong MỘT run. Port từ mockup đã duyệt (adsx_builder_mock). */

// Token màu trung tính (chỗ dựa khi source=host chưa đọc design_system / manual chưa nhập).
// KHÔNG hardcode palette theo app — style/layout/màn đọc từ blueprint/adzones của app đã chọn.
const DEFAULT_TOKENS: Record<string, string> = {
  primary: '#5B57E0', background: '#0E0F16', surface: '#171821', onSurface: '#E8E8F1', accent: '#22D3A5',
}
const TOKEN_KEYS = ['primary', 'background', 'surface', 'onSurface', 'accent'] as const

// ── Placement / Event (Home-trở-đi) ─────────────────────────────────────────
type Placement = { format: string; name: string; template: string; refreshMs?: number; everyN?: number }
type AdEvent = { type: 'interstitial' | 'rewarded'; name: string; capMs?: number; firstShow?: boolean; rewardItem?: string }
type ScreenAds = { placements: Record<string, Placement>; events: Record<string, AdEvent> }

// ── Metadata cho inspector/touch-row (rút từ manifest adzones) ───────────────
type ZoneMeta = { arch: string; where: string }
type TouchMeta = { label: string; sem: string }

// ── blueprint/adzones (nguồn THẬT: index + manifest per màn — reuse type AdZonesView) ──
type Adz = { index: IndexFile | null; manifests: Record<string, Manifest> }
const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '')

/** Tên placement/event auto-suggest (sửa được để khớp role 1.txt). */
function suggestName(screen: string, zoneOrId: string, fmt: string): string {
  const s = screen.toLowerCase()
  if (fmt === 'interstitial') return `inter_${s}`
  if (fmt === 'rewarded') return `reward_${s}`
  return `native_${s}${zoneOrId ? `_${zoneOrId.toLowerCase()}` : ''}`
}

const isFunnelBlock = (f: unknown): f is { bfxVersion: string; screens?: Record<string, string>; resources?: Record<string, unknown> } =>
  !!f && typeof f === 'object' && 'bfxVersion' in (f as Record<string, unknown>)

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
        <button onClick={onNew} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">+ Plan mới</button>
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


// ───────────────────────── WIZARD (adplan/2) ─────────────────────────
const STEPS: Array<{ t: string; s: string }> = [
  { t: 'App', s: 'chọn app đã gen' },
  { t: 'Style / Theme', s: 'colorsystem dùng chung' },
  { t: 'Layout', s: 'zone Home-trở-đi' },
  { t: 'Funnel', s: 'bfx types + resources' },
  { t: 'Ads Home-trở-đi', s: 'placements + events' },
  { t: 'Kích hoạt adsx', s: 'contract + run' },
]

function Wizard({ planId, onClose }: { planId?: number; onClose: () => void }) {
  const qc = useQueryClient()
  const existing = useQuery({ queryKey: ['ad-plan', planId], queryFn: () => adPlan(planId!), enabled: !!planId })
  const appsQ = useQuery({ queryKey: ['apps-with-runs'], queryFn: appsWithRuns })
  const bfxListQ = useQuery({ queryKey: ['bfx-catalogs'], queryFn: bfxCatalogs })
  const afQ = useQuery({ queryKey: ['af-versions-selectable'], queryFn: selectableAfVersions })

  const [step, setStep] = useState(0)
  const [app, setApp] = useState<AppRow | null>(null)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'front-funnel' | 'full'>('full')
  const [theme, setTheme] = useState<AdPlanTheme>({ source: 'style', mode: 'dark', tokens: { ...DEFAULT_TOKENS } })
  const [style, setStyle] = useState('')
  const [layout, setLayout] = useState('')
  const [bfxVersion, setBfxVersion] = useState('')
  const [screens, setScreens] = useState<Record<string, string>>({}) // screenName -> typeCode
  const [resources, setResources] = useState<Record<string, unknown>>({})
  const [home, setHome] = useState<Record<string, ScreenAds>>({})
  const [homeTab, setHomeTab] = useState('')
  const [selZone, setSelZone] = useState<string | null>(null)
  const [af, setAf] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activated, setActivated] = useState<string | null>(null)

  const catalogQ = useQuery({
    queryKey: ['bfx-catalog', bfxVersion],
    queryFn: () => bfxCatalog(bfxVersion || undefined),
    enabled: !!bfxVersion,
  })
  const catalog: BfxCatalog | null = catalogQ.data?.catalog_json ?? null

  // ── adzones của app (nguồn thật: index + manifest per màn + navigation_map) ──
  const runName = app ? latestAdzonesRun(app) : null
  const azQ = useQuery({ queryKey: ['adzones', runName], queryFn: () => blueprintDir(runName!, 'adzones/'), enabled: !!runName })
  const navQ = useQuery({ queryKey: ['navmap', runName], queryFn: () => blueprintFile(runName!, 'navigation_map.md').catch(() => null), enabled: !!runName })
  const adz: Adz = useMemo(() => {
    let index: IndexFile | null = null
    const manifests: Record<string, Manifest> = {}
    for (const f of azQ.data ?? []) {
      if (!f.content_b64) continue
      try {
        const obj = JSON.parse(b64ToText(f.content_b64))
        if (f.path.endsWith('/index.json')) index = obj as IndexFile
        else manifests[f.path.replace(/^adzones\//, '')] = obj as Manifest
      } catch { /* skip */ }
    }
    return { index, manifests }
  }, [azQ.data])
  const navText = navQ.data ? (() => { try { return b64ToText(navQ.data.content_b64) } catch { return '' } })() : ''
  const styles = adz.index?.styles ?? []
  const layouts = adz.index?.layouts ?? []
  const screenList = useMemo(() => adz.index?.screens ?? [], [adz])
  const findManifest = (screen: string, lay: string): Manifest | undefined =>
    adz.manifests[`${screen}.${lay}.json`] || adz.manifests[`${screen}.default.json`] || Object.values(adz.manifests).find((m) => m.screen === screen)
  const shotForScreen = (screen: string) => { const n = norm(screen); return Object.values(adz.manifests).find((m) => norm(m.screen) === n && m.screenshot)?.screenshot || null }

  // default bfxVersion = bản mới nhất; default af = bản mới nhất
  useEffect(() => { if (!bfxVersion && bfxListQ.data?.length) setBfxVersion(bfxListQ.data[0].bfx_version) }, [bfxListQ.data, bfxVersion])
  useEffect(() => { if (!af && afQ.data?.length) setAf(afQ.data[0].version) }, [afQ.data, af])
  // default style/layout = option đầu của adzones (khi app có blueprint)
  useEffect(() => { if (!style && styles.length) setStyle(styles[0].id) }, [styles, style])
  useEffect(() => { if (!layout && layouts.length) setLayout(layouts[0].id) }, [layouts, layout])

  // nạp plan cũ (một lần) — đọc adplan/2; adplan/1 (funnel là template-map) thì bỏ khối funnel
  useEffect(() => {
    if (!planId || !existing.data || !appsQ.data || hydrated) return
    const p = existing.data
    setName(p.name)
    if (p.plan?.scope) setScope(p.plan.scope)
    if (p.plan?.style) setStyle(p.plan.style)
    if (p.plan?.layout) setLayout(p.plan.layout)
    if (p.plan?.theme) setTheme(p.plan.theme)
    if (isFunnelBlock(p.plan?.funnel)) {
      const fb = p.plan!.funnel as { bfxVersion: string; screens?: Record<string, string>; resources?: Record<string, unknown> }
      if (fb.bfxVersion) setBfxVersion(fb.bfxVersion)
      if (fb.screens) setScreens(fb.screens)
      if (fb.resources) setResources(fb.resources)
    }
    if (p.plan?.screens) setHome(p.plan.screens as Record<string, ScreenAds>)
    setApp(appsQ.data.find((a) => a.id === p.app_id) ?? null)
    setHydrated(true)
  }, [planId, existing.data, appsQ.data, hydrated])

  // init funnel screens = type đầu tiên khớp mỗi màn (khi catalog xong & chưa có gì)
  useEffect(() => {
    if (!catalog || Object.keys(screens).length) return
    const next: Record<string, string> = {}
    for (const [sc] of BFX_ORDER) {
      const code = Object.keys(catalog.types).find((c) => catalog.types[c].screen === sc)
      if (code) next[sc] = code
    }
    if (Object.keys(next).length) setScreens(next)
  }, [catalog, screens])

  // init home (Ads Home-trở-đi) theo danh sách màn adzones
  useEffect(() => {
    if (Object.keys(home).length || !screenList.length) return
    const init: Record<string, ScreenAds> = {}
    for (const sc of screenList) init[sc.id] = { placements: {}, events: {} }
    setHome(init)
  }, [screenList, home])
  useEffect(() => {
    const ids = screenList.map((s) => s.id)
    if ((!homeTab || !ids.includes(homeTab)) && ids.length) {
      const first = ids[0]; setHomeTab(first)
      setSelZone(findManifest(first, layout)?.zones[0]?.id ?? null)
    }
  }, [screenList, homeTab, layout]) // eslint-disable-line react-hooks/exhaustive-deps

  const serial = bfxSerial(screens)
  const gate: GateResult = bfxValidate(catalog, screens, resources)

  // ── resource updaters ──
  const setResStr = (key: string, v: string) => setResources((r) => ({ ...r, [key]: v }))
  const setResArr = (key: string, i: number, v: string) =>
    setResources((r) => { const a = Array.isArray(r[key]) ? [...(r[key] as unknown[])] : []; a[i] = v; return { ...r, [key]: a } })
  const toggleAigen = (key: string, on: boolean) =>
    setResources((r) => {
      const a = Array.isArray(r[key]) ? [...(r[key] as unknown[])] : []
      const j = a.indexOf('aigen')
      if (on) { if (j < 0) a.push('aigen') } else if (j >= 0) a.splice(j, 1)
      return { ...r, [key]: a }
    })

  // ── home updaters (theo homeTab) ──
  const patchHome = (fn: (s: ScreenAds) => ScreenAds) =>
    setHome((h) => ({ ...h, [homeTab]: fn(h[homeTab] ?? { placements: {}, events: {} }) }))
  const setPlacement = (zone: string, p: Placement | null) =>
    patchHome((s) => { const placements = { ...s.placements }; if (p) placements[zone] = p; else delete placements[zone]; return { ...s, placements } })
  const updatePlacement = (zone: string, patch: Partial<Placement>) =>
    patchHome((s) => (s.placements[zone] ? { ...s, placements: { ...s.placements, [zone]: { ...s.placements[zone], ...patch } } } : s))
  const setEvent = (id: string, e: AdEvent | null) =>
    patchHome((s) => { const events = { ...s.events }; if (e) events[id] = e; else delete events[id]; return { ...s, events } })

  // ── contract body ──
  const homeFiltered = Object.fromEntries(
    Object.entries(home).filter(([, d]) => Object.keys(d.placements).length || Object.keys(d.events).length),
  )
  const body: AdPlanBody = {
    schema: 'adplan/2',
    app: app ? appCodeOf(app) ?? app.name : undefined,
    scope, style, layout, theme,
    funnel: { bfxVersion, serial, screens, resources },
    screens: homeFiltered as AdPlanBody['screens'],
  }

  const doSave = async (status: 'draft' | 'ready') => {
    if (!app) { alert('Chọn app trước khi lưu.'); setStep(0); return null }
    setSaving(true)
    try {
      const nm = name.trim() || `${appCodeOf(app) ?? 'app'}-adsx`
      const saved = await saveAdPlan({ id: planId, app_id: app.id, app_code: appCodeOf(app), name: nm, plan: body, status })
      qc.invalidateQueries({ queryKey: ['ad-plans'] })
      return saved
    } catch (e) { alert('Lưu lỗi: ' + (e as Error).message); return null } finally { setSaving(false) }
  }
  const saveDraft = async () => { const s = await doSave('draft'); if (s) onClose() }
  const activate = async () => {
    if (!gate.ok || !app) return
    if (!af) { alert('Chọn bản AF trước khi kích hoạt.'); return }
    const saved = await doSave('ready')
    if (!saved) return
    try {
      const code = appCodeOf(app) ?? ''
      const req = await createRequest('adsx', af, { app_code: code, ad_plan_id: saved.id, serial, bfxVersion, scope }, code)
      setActivated(req.request_code)
      qc.invalidateQueries({ queryKey: ['my-requests'] })
      qc.invalidateQueries({ queryKey: ['all-requests'] })
    } catch (e) { alert('Tạo order adsx lỗi: ' + (e as Error).message) }
  }

  const canNext = step === 0 ? !!app : true
  const chip = 'rounded-full border px-3 py-1 font-mono text-xs'
  const seg = 'rounded-md px-2.5 py-1 text-xs'

  // ── panel renderers ──
  const panelApp = () => (
    appsQ.isLoading ? <Loading /> : (
      <div>
        <h2 className="text-base font-semibold">Chọn app đã gen</h2>
        <p className="mt-1 mb-4 text-sm text-neutral-500">App nên có <span className="font-mono">blueprint/adzones</span> (build ≥ v5.12.0) để soạn phần Home-trở-đi.</p>
        <div className="flex flex-wrap gap-2">
          {(appsQ.data ?? []).filter((a) => latestAdzonesRun(a)).map((a) => (
            <button key={a.id} onClick={() => setApp(a)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left ${app?.id === a.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-950' : 'border-neutral-300 dark:border-neutral-700'}`}>
              <AppIcon app={a} />
              <span><span className="block text-sm font-medium">{a.name}</span><span className="block font-mono text-[11px] text-neutral-400">{appCodeOf(a) ?? '—'}</span></span>
            </button>
          ))}
        </div>
        {app && <p className="mt-4 text-sm text-neutral-500">✓ Đã chọn <b className="text-neutral-700 dark:text-neutral-200">{appCodeOf(app)}</b>. adsx sẽ khảo sát applicationId thật + module-ads của host khi chạy.</p>}
      </div>
    )
  )

  const panelTheme = () => {
    const src = theme.source
    return (
      <div>
        <h2 className="text-base font-semibold">Style / Theme — colorsystem dùng chung</h2>
        <p className="mt-1 mb-4 max-w-[62ch] text-sm text-neutral-500">Chọn TRƯỚC funnel: màu funnel là lớp reskin, Home-trở-đi cũng skin theo cùng bộ này.</p>
        <div className="mb-2 text-[11px] tracking-wide text-neutral-400 uppercase">Nguồn màu</div>
        <div className="inline-flex rounded-lg border border-neutral-300 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-900">
          {(['host', 'style', 'manual'] as const).map((s) => (
            <button key={s} onClick={() => setTheme((t) => ({ ...t, source: s }))}
              className={`${seg} ${src === s ? 'bg-white font-semibold text-neutral-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500'}`}>
              {s === 'host' ? 'host (colors.xml)' : s === 'style' ? 'style (adzones)' : 'manual'}
            </button>
          ))}
        </div>
        {src === 'style' && (
          styles.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {styles.map((s) => (
                <button key={s.id} onClick={() => setStyle(s.id)}
                  className={`${chip} ${style === s.id ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300' : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'}`}>{s.label || s.id}</button>
              ))}
            </div>
          ) : <p className="mt-3 text-xs text-amber-600">App chưa có <span className="font-mono">blueprint/adzones</span> — không đọc được style (build ≥ v5.12.0).</p>
        )}
        {src === 'style' && styles.length > 0 && <p className="mt-2 text-xs text-neutral-500">↳ Chọn style của app (từ adzones). Bộ màu thật lấy từ <span className="font-mono">design_system</span> của style khi adsx chạy; token dưới là chỗ dựa, chỉnh tay nếu muốn.</p>}
        {src === 'host' && <p className="mt-3 text-xs text-neutral-500">↳ Đọc palette thật từ <span className="font-mono">blueprint/design_system</span> của app khi chạy (token dưới là chỗ dựa). Giữ tương phản dark→dark.</p>}
        {src === 'manual' && <p className="mt-3 text-xs text-neutral-500">↳ Chỉnh tay từng token bên dưới.</p>}
        <div className="mt-5 text-[11px] tracking-wide text-neutral-400 uppercase">Tokens (source: <span className="font-mono">{src === 'style' ? `style:${style}` : src}</span> · mode: {theme.mode})</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {TOKEN_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-2.5 py-1.5 dark:border-neutral-700">
              <input type="color" disabled={src !== 'manual'} value={theme.tokens[k] ?? DEFAULT_TOKENS[k]}
                onChange={(e) => setTheme((t) => ({ ...t, tokens: { ...t.tokens, [k]: e.target.value } }))}
                className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-default" />
              <span><span className="block text-[11px] text-neutral-500">{k}</span><span className="block font-mono text-[11px]">{theme.tokens[k] ?? DEFAULT_TOKENS[k]}</span></span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  const panelLayout = () => (
    <div>
      <h2 className="text-base font-semibold">Layout — zone Home-trở-đi</h2>
      <p className="mt-1 mb-4 max-w-[62ch] text-sm text-neutral-500">Layout quyết định các <b>zone</b> gắn được ads ở màn Home-trở-đi. Style chỉ skin preview.</p>
      {azQ.isLoading ? <Loading /> : layouts.length ? (
        <div className="flex flex-wrap gap-2.5">
          {layouts.map((l) => (
            <button key={l.id} onClick={() => setLayout(l.id)}
              className={`min-w-[132px] rounded-xl border px-3 py-2.5 text-left ${layout === l.id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-neutral-300 dark:border-neutral-700'}`}>
              <div className="text-sm font-semibold">{l.label || l.id}</div>{l.desc && <div className="mt-0.5 text-[11.5px] text-neutral-500">{l.desc}</div>}
            </button>
          ))}
        </div>
      ) : <Empty>App chưa có <span className="font-mono">blueprint/adzones</span> (build ≥ v5.12.0) — không có layout để chọn.</Empty>}
      <p className="mt-4 text-xs text-neutral-500">Layout + zone đọc từ <span className="font-mono">blueprint/adzones/index.json</span> của app — không bịa vị trí.</p>
    </div>
  )

  const panelFunnel = () => {
    if (bfxListQ.isLoading || catalogQ.isLoading) return <Loading />
    if (bfxListQ.error) return <ErrorBox error={bfxListQ.error} />
    if (!bfxListQ.data?.length) return <Empty>Chưa ingest catalog bfx nào (chạy <span className="font-mono">tools/bfx_ingest.py</span>).</Empty>
    if (!catalog) return <Empty>Không tải được catalog bfx {bfxVersion}.</Empty>
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Funnel — types &amp; resources</h2>
          <label className="flex items-center gap-2 text-xs text-neutral-500">bfx
            <select value={bfxVersion} onChange={(e) => setBfxVersion(e.target.value)} className="rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-neutral-700">
              {bfxListQ.data.map((v) => <option key={v.bfx_version} value={v.bfx_version}>{v.bfx_version}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-1 mb-4 max-w-[62ch] text-sm text-neutral-500">Chọn <b>type</b> mỗi màn (cấu trúc giống source). Bạn chỉ đắp <b>resource</b> (ảnh/text) — màu lấy từ theme. adSlots đi theo type.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BFX_ORDER.map(([sc]) => {
            const code = screens[sc]
            const t: BfxType | undefined = code ? catalog.types[code] : undefined
            const opts = Object.keys(catalog.types).filter((c) => catalog.types[c].screen === sc)
            return (
              <div key={sc} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold">{sc}</span><span className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary-600 dark:bg-primary-950 dark:text-primary-300">{code ?? '—'}</span></div>
                <select value={code ?? ''} onChange={(e) => setScreens((s) => ({ ...s, [sc]: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-[13px] dark:border-neutral-700 dark:bg-neutral-900">
                  {opts.map((c) => <option key={c} value={c}>{c} — {catalog.types[c].title}</option>)}
                </select>
                {t && <div className="mt-2 font-mono text-[10.5px] break-all text-neutral-400">adSlots: {t.adSlots.join(' · ')}</div>}
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 dark:border-primary-900 dark:bg-primary-950/50">
          <span className="text-[11px] tracking-wide text-neutral-500 uppercase">serial</span>
          <span className="font-mono text-lg font-semibold tracking-wide">{serial}</span>
          <span className="ml-auto text-[11.5px] text-neutral-500">🔒 lock cặp (serial, bfx {catalog.bfxVersion})</span>
        </div>

        <div className="mt-6 mb-2 text-[11px] tracking-wide text-neutral-400 uppercase">Resource slots (<span className="text-red-600">*</span> = bắt buộc)</div>
        {Object.entries(screens).map(([, code]) => {
          const tt = catalog.types[code]
          if (!tt) return null
          return Object.entries(tt.resources).map(([slot, rule]) => {
            const key = `${code}.${slot}`
            const r = resolveSlot(rule, resources[key])
            const v = resources[key]
            const stateCls = r.status === 'FAIL' ? 'text-red-600' : r.status === 'passed' ? 'text-emerald-600' : 'text-neutral-400'
            const stateTxt = r.status === 'FAIL' ? 'chưa resolve' : r.status
            return (
              <div key={key} className="mb-2.5 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12.5px] font-semibold">{key}{rule.required && <span className="ml-0.5 text-red-600">*</span>}</span>
                  <span className="rounded border border-neutral-300 px-1.5 font-mono text-[10px] text-neutral-500 dark:border-neutral-700">{rule.kind}{rule.count ? `×${rule.count}` : ''}</span>
                  {rule.conformance && <span className="rounded bg-amber-100 px-1.5 font-mono text-[10.5px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">{rule.conformance.width}×{rule.conformance.height}</span>}
                  <span className={`ml-auto font-mono text-[10.5px] ${stateCls}`}>{stateTxt}</span>
                </div>
                {rule.kind === 'image' ? (() => {
                  const arr = Array.isArray(v) ? (v as unknown[]) : []
                  const canAigen = rule.resolve.includes('aigen')
                  return (
                    <div className="space-y-2">
                      {Array.from({ length: rule.count || 1 }).map((_, i) => (
                        <input key={i} value={arr[i] === 'aigen' ? '' : (typeof arr[i] === 'string' ? (arr[i] as string) : '')}
                          onChange={(e) => setResArr(key, i, e.target.value)} placeholder={arr[i] === 'aigen' ? '(AI-gen)' : `đường dẫn ảnh #${i + 1} (res:…)`}
                          className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900" />
                      ))}
                      {canAigen && (
                        <label className="flex items-center gap-2 text-xs text-neutral-500">
                          <input type="checkbox" checked={arr.includes('aigen')} onChange={(e) => toggleAigen(key, e.target.checked)} className="accent-primary-600" />
                          auto-gen ảnh thiếu (freeze {rule.conformance ? `${rule.conformance.width}×${rule.conformance.height}` : ''})
                        </label>
                      )}
                    </div>
                  )
                })() : rule.count ? (
                  <div className="space-y-2">
                    {Array.from({ length: rule.count }).map((_, i) => {
                      const arr = Array.isArray(v) ? (v as unknown[]) : []
                      const def = Array.isArray(rule.default) ? rule.default : []
                      return (
                        <input key={i} value={typeof arr[i] === 'string' ? (arr[i] as string) : ''} onChange={(e) => setResArr(key, i, e.target.value)}
                          placeholder={def[i] ?? ''} className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 text-[13px] dark:border-neutral-700 dark:bg-neutral-900" />
                      )
                    })}
                  </div>
                ) : (
                  <input value={typeof v === 'string' ? v : ''} onChange={(e) => setResStr(key, e.target.value)}
                    placeholder={rule.default != null ? String(rule.default) : '(bắt buộc nhập)'}
                    className={`w-full rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 text-[13px] dark:border-neutral-700 dark:bg-neutral-900 ${rule.kind !== 'text' ? 'font-mono' : ''}`} />
                )}
                <div className="mt-2 text-[11px] text-neutral-400">resolve: {rule.resolve.join(' → ')}{rule.default ? ` · default: ${Array.isArray(rule.default) ? rule.default.join(' / ') : rule.default}` : ''}</div>
              </div>
            )
          })
        })}

        <GateBox gate={gate} verbose />
      </div>
    )
  }

  const panelHome = () => {
    if (azQ.isLoading) return <Loading />
    if (!screenList.length) return <Empty>App chưa có <span className="font-mono">blueprint/adzones</span> (build ≥ v5.12.0) — chưa có màn Home-trở-đi để gắn ads.</Empty>
    const cur = home[homeTab] ?? { placements: {}, events: {} }
    const manifest = homeTab ? findManifest(homeTab, layout) : undefined
    const zones = manifest?.zones ?? []
    const touchAll = manifest?.touchables ?? []
    const mainTouch = touchAll.filter((t) => t.semantics !== 'navigation')
    // Back luôn là một lựa chọn touchable (synthetic nếu manifest chưa có) — thoát màn thường là chỗ gắn inter.
    const backId = `${homeTab}_back`
    const hasBack = touchAll.some((t) => t.id === backId || /(^|_)back$/.test(t.id))
    const navTouch: Array<{ id: string; label: string; semantics: string }> = [
      ...touchAll.filter((t) => t.semantics === 'navigation').map((t) => ({ id: t.id, label: t.label || t.id, semantics: t.semantics })),
      ...(hasBack ? [] : [{ id: backId, label: '⬅ Back (thoát màn)', semantics: 'navigation' }]),
    ]
    const selZ = zones.find((z) => z.id === selZone)
    const shotPath = manifest?.screenshot
    const count = (id: string) => Object.keys(home[id]?.placements ?? {}).length + Object.keys(home[id]?.events ?? {}).length
    const gotoScreen = (id: string) => { setHomeTab(id); setSelZone(findManifest(id, layout)?.zones[0]?.id ?? null) }
    const pickByNav = (navId: string) => { const n = norm(navId); const sc = screenList.find((s) => { const x = norm(s.id); return x === n || x.includes(n) || n.includes(x) }); if (sc) gotoScreen(sc.id) }

    return (
      <div>
        <h2 className="text-base font-semibold">Ads Home-trở-đi</h2>
        <p className="mt-1 mb-3 max-w-[64ch] text-sm text-neutral-500">Nav map + <b>ảnh thật</b> từng màn (blueprint). Bấm màn trên sơ đồ / tab, rồi bấm <b>zone</b> trên ảnh để cấu hình. <b>Touchable</b> ở list bên phải.</p>

        {navText && (
          <div className="mb-5">
            <NavMap navText={navText} runName={runName || ''} shotForScreen={shotForScreen} onPick={pickByNav} />
            <p className="mt-1 text-[11px] text-neutral-400">Bấm màn trên sơ đồ để nhảy tới gắn ads. Màn đang chọn: <b className="text-neutral-600 dark:text-neutral-300">{homeTab}</b></p>
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-1.5">
          {screenList.map((sc) => { const c = count(sc.id); return (
            <button key={sc.id} onClick={() => gotoScreen(sc.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] capitalize ${homeTab === sc.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-950' : 'border-neutral-300 dark:border-neutral-700'}`}>
              {sc.id.replace(/_/g, ' ')}{c > 0 && <span className="rounded-full bg-primary-600 px-1.5 font-mono text-[10px] text-white">{c}</span>}
            </button>
          ) })}
        </div>

        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          {/* trái: ẢNH THẬT + zone overlay theo archetype (bấm để chọn) */}
          <div>
            <div className="w-full max-w-[300px] rounded-[2rem] border border-neutral-300 bg-neutral-200 p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
              <div className="relative overflow-hidden rounded-[1.6rem]">
                {shotPath ? <Shot runName={runName || ''} path={shotPath} className="block w-full" alt={homeTab} />
                  : <div className="grid aspect-[66/140] place-items-center bg-neutral-50 font-mono text-[10px] text-neutral-400 dark:bg-neutral-950">màn này chưa có ảnh</div>}
                {shotPath && zones.map((z) => {
                  const p = cur.placements[z.id]; const sel = selZone === z.id
                  return (
                    <div key={z.id} className="absolute right-1.5 left-1.5 z-10" style={archPos(z.archetype)}>
                      <button onClick={() => setSelZone(z.id)} title={z.archetype} style={{ textShadow: '0 1px 2px rgba(0,0,0,.55)' }}
                        className={`w-full cursor-pointer rounded-md border-[1.5px] px-2 py-0.5 text-center font-mono text-[8.5px] font-semibold text-white backdrop-blur-[1px] ${p ? 'border-primary-400 bg-primary-500/35' : 'border-white/70 border-dashed bg-black/20'} ${sel ? 'ring-2 ring-primary-300' : ''}`}>
                        {z.id} · {z.archetype}{p ? ` · ${p.name}` : ''}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
            <p className="mt-2 max-w-[300px] text-[11px] text-neutral-400">Ảnh thật từ <span className="font-mono">blueprint/adzones</span>. Bấm khe zone trên ảnh → cấu hình bên phải.</p>
          </div>

          {/* phải: inspector zone (mới) + touch list (mới) */}
          <div className="flex flex-col gap-4">
            <ZoneInspector zone={selZone} zm={selZ ? { arch: selZ.archetype, where: selZ.anchor || '' } : undefined} placement={selZone ? cur.placements[selZone] : undefined}
              onAdd={() => { if (!selZ) return; const inFeed = selZ.archetype === 'in-feed'; setPlacement(selZ.id, { format: 'native', name: suggestName(homeTab, selZ.id, 'native'), template: inFeed ? 'full' : 'small', ...(inFeed ? { everyN: 5 } : { refreshMs: 0 }) }) }}
              onRemove={() => selZone && setPlacement(selZone, null)}
              onPatch={(patch) => selZone && updatePlacement(selZone, patch)} />
            <div>
              <div className="mb-2 text-[11px] tracking-wide text-neutral-400 uppercase">Touchable · tap → interstitial/rewarded</div>
              {mainTouch.length ? (
                <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                  {mainTouch.map((t) => <TouchRow key={t.id} id={t.id} m={{ label: t.label || t.id, sem: t.semantics }} ev={cur.events[t.id]} screen={homeTab} onChange={setEvent} />)}
                </div>
              ) : <p className="text-xs text-neutral-400">Màn này không có touchable action trong adzones.</p>}
              {navTouch.length > 0 && (
                <>
                  <div className="my-3 flex items-center gap-2 text-[10.5px] tracking-wide text-neutral-400 uppercase">Điều hướng<span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" /></div>
                  <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                    {navTouch.map((t) => <TouchRow key={t.id} id={t.id} m={{ label: t.label || t.id, sem: t.semantics }} ev={cur.events[t.id]} screen={homeTab} onChange={setEvent} />)}
                  </div>
                </>
              )}
              <p className="mt-2 text-[11px] text-neutral-400">Tên auto-suggest khi bật; sửa được để khớp role 1.txt.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const panelActivate = () => {
    const union = bfxAdSlotUnion(catalog, screens)
    const homeNames: string[] = []
    for (const sc of Object.values(home)) {
      for (const p of Object.values(sc.placements)) if (p.name) homeNames.push(p.name)
      for (const e of Object.values(sc.events)) if (e.name) homeNames.push(e.name)
    }
    const cmd = `./adsx.sh --appCode=${app ? appCodeOf(app) : '?'} --ad_plan_id=<id> --serial=${serial} --bfxVersion=${bfxVersion} --scope=${scope} --verify=full`
    return (
      <div>
        <h2 className="text-base font-semibold">Kích hoạt adsx</h2>
        <p className="mt-1 mb-4 max-w-[62ch] text-sm text-neutral-500">Lưu contract <span className="font-mono">adplan/2</span> rồi tạo order <span className="font-mono">type=adsx</span>. Một run tích hợp funnel + Home-trở-đi.</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] tracking-wide text-neutral-400 uppercase">Advisory — phủ ad-slot (không chặn build test)</div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 dark:border-neutral-800 dark:bg-neutral-900/50">
              <div className="mb-3">
                <div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Funnel adSlots (serial {serial})</div>
                <div className="flex flex-wrap gap-1.5">{union.map((a) => <span key={a} className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-800">{a}</span>)}</div>
              </div>
              <div className="mb-3">
                <div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Home-trở-đi (bạn đặt)</div>
                <div className="flex flex-wrap gap-1.5">{homeNames.length ? homeNames.map((a, i) => <span key={`${a}-${i}`} className="rounded-md border border-primary-300 bg-white px-2 py-0.5 font-mono text-[11px] text-primary-600 dark:border-primary-800 dark:bg-neutral-800 dark:text-primary-300">{a}</span>) : <span className="text-xs text-neutral-400">chưa đặt</span>}</div>
              </div>
              <div className="flex gap-2 rounded-lg bg-amber-100 px-3 py-2.5 text-[12.5px] dark:bg-amber-950/60">
                <span className="flex-none text-amber-600">⚠</span>
                <span><b>Package-match &amp; 1.txt</b> xác minh khi adsx.sh chạy (HARD STOP) — fetch theo applicationId thật, không khớp thì DỪNG. Slot chưa có unit → cảnh báo "cần UA điền", không chặn.</span>
              </div>
            </div>

            <div className="mt-4 mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Lệnh dựng ra (adsx.sh tự điền ad_plan_id sau khi lưu)</div>
            <pre className="overflow-auto rounded-xl border border-neutral-200 bg-neutral-50 p-3 font-mono text-[11px] dark:border-neutral-800 dark:bg-neutral-900">{cmd}</pre>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] tracking-wide text-neutral-400 uppercase">Tên kịch bản</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${app ? appCodeOf(app) : 'app'}-adsx`}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] tracking-wide text-neutral-400 uppercase">Bản AF</span>
                <select value={af} onChange={(e) => setAf(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                  {afQ.data?.map((v, i) => <option key={v.version} value={v.version}>{v.version}{i === 0 ? ' — mới nhất' : ''}</option>)}
                  {!afQ.data?.length && <option value="">(admin chưa mở khoá bản nào)</option>}
                </select>
              </label>
            </div>

            <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${gate.ok ? 'bg-emerald-50 dark:bg-emerald-950/50' : 'bg-red-50 dark:bg-red-950/50'}`}>
              <div className={`font-mono text-xs font-semibold ${gate.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{gate.ok ? '● Resource gate OK — sẵn sàng kích hoạt' : '● Resource gate FAIL — sửa ở bước Funnel'}</div>
              {!gate.ok && <ul className="mt-2 space-y-1">{gate.errors.map((e) => <li key={e.key} className="font-mono text-[11.5px] text-red-600">✗ {e.key}: bắt buộc, chưa resolve</li>)}</ul>}
            </div>

            {activated ? (
              <div className="mt-4 rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
                ✓ Đã tạo order adsx — mã <span className="font-mono">{activated}</span>.
                <button onClick={onClose} className="ml-3 rounded border border-green-300 px-2 py-0.5 text-xs dark:border-green-800">Xong</button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button disabled={saving} onClick={saveDraft} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">Lưu nháp</button>
                <button disabled={saving || !gate.ok || !af} onClick={activate} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40">{gate.ok ? 'Kích hoạt adsx →' : 'Chưa đủ resource'}</button>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Contract lưu vào <span className="font-mono">ad_plans.plan</span></div>
            <pre className="max-h-[460px] overflow-auto rounded-xl border border-neutral-200 bg-neutral-950 p-4 font-mono text-[11.5px] leading-relaxed text-neutral-300 dark:border-neutral-800">{JSON.stringify(body, null, 2)}</pre>
          </div>
        </div>
      </div>
    )
  }

  const panels = [panelApp, panelTheme, panelLayout, panelFunnel, panelHome, panelActivate]

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onClose} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">← danh sách</button>
        <h1 className="text-lg font-semibold">{planId ? 'Sửa plan' : 'Plan mới'} <span className="font-mono text-xs font-normal text-neutral-400">· adsx</span></h1>
        {app && <span className="font-mono text-xs text-neutral-400">{appCodeOf(app)} · {app.name}</span>}
        <div className="ml-auto inline-flex rounded-lg border border-neutral-300 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-900" title="Phạm vi funnel">
          {(['front-funnel', 'full'] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} className={`${seg} ${scope === s ? 'bg-white font-semibold text-neutral-800 shadow-sm dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500'}`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[210px_1fr] md:items-start">
        {/* rail */}
        <nav className="flex flex-col gap-0.5 md:sticky md:top-4">
          {STEPS.map((st, i) => (
            <button key={st.t} onClick={() => setStep(i)}
              className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-left ${i === step ? 'bg-primary-50 dark:bg-primary-950' : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'}`}>
              <span className={`grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-semibold ${i === step ? 'bg-primary-600 text-white' : i < step ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border border-neutral-300 bg-neutral-100 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800'}`}>{i < step ? '✓' : i + 1}</span>
              <span><span className="block text-[13px] font-medium leading-tight">{st.t}</span><span className="block text-[11px] text-neutral-400">{st.s}</span></span>
            </button>
          ))}
        </nav>

        {/* panel */}
        <div>
          <div className="min-h-[420px] rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
            {panels[step]()}
          </div>
          <div className="mt-5 flex justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 disabled:opacity-40 dark:border-neutral-700">← Trước</button>
            {step < STEPS.length - 1 && (
              <button disabled={!canNext} onClick={() => setStep((s) => s + 1)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-40">Tiếp →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── gate box (dùng ở Funnel; verbose = liệt kê note) ─────────────────────────
function GateBox({ gate, verbose }: { gate: GateResult; verbose?: boolean }) {
  return (
    <div className={`mt-5 rounded-xl px-4 py-3 ${gate.ok ? 'bg-emerald-50 dark:bg-emerald-950/50' : 'bg-red-50 dark:bg-red-950/50'}`}>
      <div className={`flex items-center gap-2 font-mono text-xs font-semibold ${gate.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
        {gate.ok ? '● RESOURCE GATE: OK' : '● RESOURCE GATE: FAIL — shift-left'}
      </div>
      <ul className="mt-2 space-y-1">
        {gate.errors.map((e) => (
          <li key={e.key} className="font-mono text-[11.5px] text-red-600">✗ HARD STOP — {e.key}: required, resolve=[{e.resolve.join(',')}], chưa passed / không default / không ai-gen</li>
        ))}
        {verbose && gate.notes.map((n) => (
          <li key={n.key} className="font-mono text-[11.5px] text-neutral-500">· {n.key}: {n.msg}</li>
        ))}
      </ul>
    </div>
  )
}

// ── zone inspector (Home-trở-đi) ─────────────────────────────────────────────
function ZoneInspector({ zone, zm, placement, onAdd, onRemove, onPatch }: {
  zone: string | null; zm?: ZoneMeta; placement?: Placement
  onAdd: () => void; onRemove: () => void; onPatch: (patch: Partial<Placement>) => void
}) {
  const box = 'rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950'
  if (!zone || !zm) return <div className={box}><div className="text-[11px] tracking-wide text-neutral-400 uppercase">Zone đang chọn</div><p className="mt-2 text-sm text-neutral-500">Bấm một khe <b>zone</b> trên màn để cấu hình.</p></div>
  const inFeed = zm.arch === 'in-feed'
  const fieldCls = 'w-full rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900'
  return (
    <div className={box}>
      <div className="text-[11px] tracking-wide text-neutral-400 uppercase">Zone · {zm.arch} · {zm.where}</div>
      <div className="mt-0.5 mb-3 font-mono text-[15px] font-semibold break-all">zone {zone}</div>
      {placement ? (
        <div className="space-y-3">
          <label className="block text-sm"><span className="mb-1 block text-[11px] tracking-wide text-neutral-400 uppercase">Tên placement (role → 1.txt)</span>
            <input value={placement.name} onChange={(e) => onPatch({ name: e.target.value })} className={`${fieldCls} font-mono`} /></label>
          <label className="block text-sm"><span className="mb-1 block text-[11px] tracking-wide text-neutral-400 uppercase">Format</span>
            <select value={placement.format} onChange={(e) => onPatch({ format: e.target.value })} className={fieldCls}>{['native', 'banner'].map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="block text-sm"><span className="mb-1 block text-[11px] tracking-wide text-neutral-400 uppercase">Template</span>
            <select value={placement.template} onChange={(e) => onPatch({ template: e.target.value })} className={fieldCls}>{['small', 'full'].map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="block text-sm"><span className="mb-1 block text-[11px] tracking-wide text-neutral-400 uppercase">{inFeed ? 'everyN (cách mấy item)' : 'refresh (giây, 0 = tắt)'}</span>
            <input type="number" value={inFeed ? (placement.everyN ?? 5) : ((placement.refreshMs ?? 0) / 1000)}
              onChange={(e) => { const n = Number(e.target.value) || 0; onPatch(inFeed ? { everyN: n || 1 } : { refreshMs: n * 1000 }) }} className={fieldCls} /></label>
          <button onClick={onRemove} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-red-600 dark:border-neutral-700">Gỡ ads khỏi zone {zone}</button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-500">Zone {zone} chưa có ads.</p>
          <button onClick={onAdd} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">＋ Đặt native ads</button>
        </>
      )}
    </div>
  )
}

// ── touchable row (Home-trở-đi) ──────────────────────────────────────────────
function TouchRow({ id, m, ev, screen, onChange }: {
  id: string; m: TouchMeta; ev?: AdEvent; screen: string; onChange: (id: string, e: AdEvent | null) => void
}) {
  const cur = ev?.type ?? 'none'
  return (
    <div className={`border-t border-neutral-200 px-3 py-2.5 first:border-t-0 dark:border-neutral-800 ${ev ? 'bg-primary-50/60 dark:bg-primary-950/40' : ''}`}>
      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{m.label}</div><div className="font-mono text-[10.5px] text-neutral-400">{id} · {m.sem}</div></div>
        <select value={cur} onChange={(e) => {
          const v = e.target.value
          if (v === 'none') onChange(id, null)
          else onChange(id, { type: v as AdEvent['type'], name: ev?.name || suggestName(screen, id, v), ...(v === 'interstitial' ? { capMs: 30000, firstShow: true } : { rewardItem: '' }) })
        }} className="w-[130px] flex-none rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900">
          <option value="none">— không —</option><option value="interstitial">Interstitial</option><option value="rewarded">Rewarded</option>
        </select>
      </div>
      {ev && (
        <div className="mt-2">
          <input value={ev.name} onChange={(e) => onChange(id, { ...ev, name: e.target.value })} className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-mono text-[12px] dark:border-neutral-700 dark:bg-neutral-900" />
          <div className="mt-1 text-[11px] text-neutral-400">role → đối chiếu 1.txt{ev.type === 'interstitial' ? ` · cap ${(ev.capMs ?? 30000) / 1000}s` : ''}</div>
        </div>
      )}
    </div>
  )
}
