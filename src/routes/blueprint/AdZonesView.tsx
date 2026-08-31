import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { blueprintDir, blueprintFile } from '../../lib/queries'
import { b64ToText, b64ToDataURL, mimeOf } from '../../lib/blueprint'
import { Empty, ErrorBox, Loading } from '../../components/ui'

/** AdZonesView — 2 phần (xem instructions/adzones.md):
 *  (1) Navigation map — sơ đồ điều hướng, node = ảnh màn thật (từ navigation_map.md + adzones.screenshot).
 *  (2) Danh sách màn (Plan B) — mỗi màn = ảnh thật + zone; bấm mở editor gắn ads (đặt zone + adsEvent, kiểm policy). */

type StyleV = { id: string; label: string }
type LayoutV = { id: string; label: string; desc?: string }
type ScreenMeta = { id: string; composable: string; layouts: string[] }
export type IndexFile = {
  schema: string; app: string
  styles: StyleV[]; layouts: LayoutV[]; screens: ScreenMeta[]
  manifests: { screen: string; layout: string; file: string; zones: number; touchables: number; screenshot?: string | null }[]
}
type Zone = { id: string; archetype: string; scope?: string; accepts: string[]; anchor: string; reserveDp: number; requires?: string[]; source?: string; evidence?: string }
type Touchable = { id: string; label: string; semantics: string; source?: string }
export type Manifest = {
  schema: string; app: string; screen: string; layout: string
  screenshot?: string | null
  zones: Zone[]; touchables: Touchable[]
  _existing?: { placements: string[]; events: string[] }
  _meta?: Record<string, unknown>
}
export type Placement = { format: string; name: string; template: string; refreshMs?: number; everyN?: number }
export type AdEvent = { type: 'interstitial' | 'rewarded'; name: string; capMs?: number; firstShow?: boolean; rewardItem?: string }
type Msg = { level: 'err' | 'warn'; msg: string }

function checkEvent(t: Touchable | undefined, ev: AdEvent | undefined): Msg[] {
  const out: Msg[] = []
  if (!t || !ev?.type) return out
  if (ev.type === 'interstitial') {
    if (t.semantics === 'micro-interaction') out.push({ level: 'err', msg: 'Interstitial trên micro-interaction — vi phạm policy disruptive-inter của AdMob.' })
    if (ev.capMs != null && ev.capMs > 0 && ev.capMs < 15000) out.push({ level: 'warn', msg: 'Frequency cap < 15s — quá dày, rủi ro policy. Nên ≥ 30s.' })
    if (!ev.name) out.push({ level: 'err', msg: 'Thiếu tên placement.' })
  }
  if (ev.type === 'rewarded') {
    if (!ev.rewardItem) out.push({ level: 'err', msg: 'Rewarded phải khai reward item (value-gate).' })
    if (t.semantics === 'navigation') out.push({ level: 'warn', msg: 'Touchable điều-hướng thuần — reward cần value-gate.' })
    if (!ev.name) out.push({ level: 'err', msg: 'Thiếu tên placement.' })
  }
  return out
}
const suggestName = (screen: string, zid: string, fmt: string) =>
  zid === 'A' ? (fmt === 'banner' ? 'banner_home' : 'native_home')
    : zid === 'C' ? `${fmt}_${screen}` : zid === 'B' ? `${fmt}_${screen}_header`
      : zid === 'D' ? `native_${screen}_feed` : `${fmt}_${screen}_${zid.toLowerCase()}`

const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '')

// tải 1 ảnh blueprint → dataURL (dedupe qua react-query)
function useShot(runName: string, path?: string | null) {
  const q = useQuery({ queryKey: ['bpshot', runName, path], queryFn: () => blueprintFile(runName, path!), enabled: !!runName && !!path })
  return q.data ? b64ToDataURL(q.data.content_b64, mimeOf(path!, q.data.content_type)) : null
}
function Shot({ runName, path, className, alt }: { runName: string; path?: string | null; className?: string; alt?: string }) {
  const url = useShot(runName, path)
  if (!url) return <div className={`${className || ''} bg-neutral-100 dark:bg-neutral-800`} style={{ minHeight: 40 }} />
  return <img src={url} className={className} alt={alt || ''} draggable={false} />
}

// ═══════════════════════ ROOT ═══════════════════════
export default function AdZonesView({ runName }: { runName: string }) {
  const dir = useQuery({ queryKey: ['adzones', runName], queryFn: () => blueprintDir(runName, 'adzones/') })
  const navQ = useQuery({ queryKey: ['navmap', runName], queryFn: () => blueprintFile(runName, 'navigation_map.md').catch(() => null) })

  const parsed = useMemo(() => {
    let index: IndexFile | null = null
    const manifests: Record<string, Manifest> = {}
    for (const f of dir.data ?? []) {
      try {
        const o = JSON.parse(b64ToText(f.content_b64))
        if (f.path.endsWith('/index.json')) index = o as IndexFile
        else manifests[f.path.replace(/^adzones\//, '')] = o as Manifest
      } catch { /* skip */ }
    }
    return { index, manifests }
  }, [dir.data])

  const navText = navQ.data ? (() => { try { return b64ToText(navQ.data.content_b64) } catch { return '' } })() : ''
  const [sel, setSel] = useState<{ screen: string; layout: string } | null>(null)

  if (dir.isLoading) return <Loading />
  if (dir.error) return <ErrorBox error={dir.error} />
  const index = parsed.index
  if (!index) return <Empty>Chưa có adzones (chạy build ≥ v5.12.0 hoặc `python3 tools/adzones.py scan`).</Empty>

  // manifest theo (screen,layout) với fallback
  const findManifest = (screen: string, layout: string) =>
    parsed.manifests[`${screen}.${layout}.json`] || parsed.manifests[`${screen}.default.json`] ||
    Object.values(parsed.manifests).find((m) => m.screen === screen)
  const shotForScreen = (screen: string) => { const n = norm(screen); return Object.values(parsed.manifests).find((m) => norm(m.screen) === n && m.screenshot)?.screenshot || null }

  if (sel) {
    const m = findManifest(sel.screen, sel.layout)
    return (
      <div>
        <button onClick={() => setSel(null)} className="mb-4 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">← danh sách màn</button>
        {m ? <ScreenEditor manifest={m} runName={runName} /> : <Empty>Không thấy manifest.</Empty>}
      </div>
    )
  }

  const defLayout = index.layouts[0]?.id || 'default'
  return (
    <div className="space-y-8">
      <NavMap navText={navText} manifests={parsed.manifests} runName={runName} shotForScreen={shotForScreen}
        onPick={(s) => { const sc = index.screens.find((x) => norm(x.id) === norm(s) || norm(x.id).includes(norm(s)) || norm(s).includes(norm(x.id))); if (sc) setSel({ screen: sc.id, layout: sc.layouts.includes(defLayout) ? defLayout : sc.layouts[0] }) }} />
      <ScreenGrid index={index} runName={runName} shotForScreen={shotForScreen} manifests={parsed.manifests}
        onPick={(screen, layout) => setSel({ screen, layout })} defLayout={defLayout} />
    </div>
  )
}

// ═══════════════════════ NAV MAP ═══════════════════════
type NavNode = { id: string; label: string; x: number; y: number; screen?: string }
function parseNav(text: string) {
  const mm = text.match(/```mermaid([\s\S]*?)```/)
  const body = mm ? mm[1] : text
  const labels: Record<string, string> = {}; const edges: [string, string][] = []
  for (const line of body.split('\n')) {
    if (line.trim().startsWith('%%') || /^\s*(flowchart|graph)\b/.test(line)) continue
    for (const x of line.matchAll(/(\w+)(?:\[\[([^\]]+)\]\]|\[([^\]]+)\]|\(\(([^)]+)\)\)|\{([^}]+)\})/g))
      labels[x[1]] = x[2] || x[3] || x[4] || x[5] || x[1]
    if (/-->/.test(line)) {
      const parts = line.split(/<?-->/)
      for (let i = 0; i < parts.length - 1; i++) {
        const a = (parts[i].trim().match(/(\w+)(?:[[({]|$|\s)/) || parts[i].trim().match(/(\w+)/) || [])[1]
        const rhs = parts[i + 1].replace(/^\s*\|[^|]*\|/, '').trim()
        const b = (rhs.match(/(\w+)/) || [])[1]
        if (a && b) edges.push([a, b])
      }
    }
  }
  const ids = new Set<string>(); edges.forEach(([a, b]) => { ids.add(a); ids.add(b) }); Object.keys(labels).forEach((k) => ids.add(k))
  return { ids: [...ids], labels, edges }
}
function layoutNodes(ids: string[], edges: [string, string][]): Record<string, { x: number; y: number }> {
  const adj: Record<string, string[]> = {}; ids.forEach((i) => (adj[i] = []))
  edges.forEach(([a, b]) => { if (adj[a]) adj[a].push(b); if (adj[b]) adj[b].push(a) })
  const indeg: Record<string, number> = {}; ids.forEach((i) => (indeg[i] = 0)); edges.forEach(([, b]) => (indeg[b] = (indeg[b] || 0) + 1))
  const root = ids.find((i) => indeg[i] === 0) || ids[0]
  const layer: Record<string, number> = {}; if (root) { layer[root] = 0; const q = [root]; while (q.length) { const u = q.shift()!; (adj[u] || []).forEach((v) => { if (layer[v] === undefined) { layer[v] = layer[u] + 1; q.push(v) } }) } }
  ids.forEach((i) => { if (layer[i] === undefined) layer[i] = 0 })
  const byL: Record<number, string[]> = {}; ids.forEach((i) => (byL[layer[i]] = byL[layer[i]] || []).push(i))
  const pos: Record<string, { x: number; y: number }> = {}; const midX = 560, yBase = 70, vGap = 195, hGap = 150
  Object.keys(byL).forEach((L) => { const arr = byL[+L].sort(); const total = (arr.length - 1) * hGap; arr.forEach((id, i) => (pos[id] = { x: Math.round(midX - total / 2 + i * hGap), y: yBase + (+L) * vGap })) })
  return pos
}
export function NavMap({ navText, runName, shotForScreen, onPick }: {
  navText: string; manifests?: Record<string, Manifest>; runName: string
  shotForScreen: (s: string) => string | null; onPick: (screen: string) => void
}) {
  const { nodes, edges, height } = useMemo(() => {
    if (!navText) return { nodes: [] as NavNode[], edges: [] as [string, string][], height: 400 }
    const p = parseNav(navText); const pos = layoutNodes(p.ids, p.edges)
    const nodes: NavNode[] = p.ids.map((id) => ({ id, label: p.labels[id] || id, x: pos[id]?.x ?? 0, y: pos[id]?.y ?? 0, screen: id }))
    const h = Math.max(400, Math.max(...nodes.map((n) => n.y), 0) + 180)
    return { nodes, edges: p.edges, height: h }
  }, [navText])

  const [s, setS] = useState(1); const [t, setT] = useState({ x: 20, y: 10 }); const dragRef = useState<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [drag, setDrag] = dragRef
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))

  if (!nodes.length) return null
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-3"><span className="font-mono text-xs text-teal-600">01</span><h3 className="text-base font-semibold">Navigation map</h3><span className="font-mono text-[11px] text-neutral-400">navigation_map.md · kéo để pan · nút zoom</span></div>
      <div className="mb-2 flex gap-1.5">
        <button onClick={() => setS((v) => Math.min(2.4, v * 1.2))} className="h-8 w-8 rounded-lg border border-neutral-300 dark:border-neutral-700">+</button>
        <button onClick={() => setS((v) => Math.max(.4, v / 1.2))} className="h-8 w-8 rounded-lg border border-neutral-300 dark:border-neutral-700">−</button>
        <button onClick={() => { setS(1); setT({ x: 20, y: 10 }) }} className="rounded-lg border border-neutral-300 px-3 text-xs dark:border-neutral-700">reset</button>
        <span className="ml-1 self-center font-mono text-xs text-neutral-400">{Math.round(s * 100)}%</span>
      </div>
      <div className="relative h-[520px] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950"
        style={{ cursor: drag ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.navnode')) return; setDrag({ x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => { if (drag) setT({ x: drag.tx + (e.clientX - drag.x), y: drag.ty + (e.clientY - drag.y) }) }}
        onPointerUp={() => setDrag(null)}
        onWheel={(e) => { const ns = Math.min(2.4, Math.max(.4, s * (e.deltaY < 0 ? 1.1 : .9))); setS(ns) }}>
        <div style={{ position: 'absolute', transformOrigin: '0 0', transform: `translate(${t.x}px,${t.y}px) scale(${s})`, width: 1120, height }}>
          <svg style={{ position: 'absolute', overflow: 'visible', width: 1120, height }}>
            {edges.map(([a, b], i) => { const A = byId[a], B = byId[b]; if (!A || !B) return null; return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="var(--edge,#9AA8B4)" strokeWidth={1.4} /> })}
          </svg>
          {nodes.map((n) => {
            const shot = shotForScreen(n.id) || shotForScreen(n.label)
            return (
              <div key={n.id} className="navnode" onClick={() => onPick(n.id)}
                style={{ position: 'absolute', left: n.x, top: n.y, transform: 'translate(-50%,-50%)', cursor: 'pointer' }}>
                {shot
                  ? <div style={{ width: 60 }}><Shot runName={runName} path={shot} className="block w-[60px] rounded-md border-2 border-white shadow dark:border-neutral-700" /><div className="mt-0.5 text-center text-[9px] font-semibold">{n.label}</div></div>
                  : <div className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-[10px] font-medium text-neutral-500 shadow dark:border-neutral-700 dark:bg-neutral-900">{n.label}</div>}
              </div>
            )
          })}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-400">Node có ảnh = màn app; bấm để mở gắn ads. Node chữ = màn chưa chụp ảnh hoặc intent hệ thống.</p>
    </section>
  )
}

// ═══════════════════════ SCREEN GRID (Plan B) ═══════════════════════
function ScreenGrid({ index, runName, shotForScreen, manifests, onPick, defLayout }: {
  index: IndexFile; runName: string; shotForScreen: (s: string) => string | null
  manifests: Record<string, Manifest>; onPick: (screen: string, layout: string) => void; defLayout: string
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3"><span className="font-mono text-xs text-teal-600">02</span><h3 className="text-base font-semibold">Danh sách màn — gắn ads (Plan B)</h3><span className="font-mono text-[11px] text-neutral-400">ảnh thật + zone</span></div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))' }}>
        {index.screens.map((sc) => {
          const layout = sc.layouts.includes(defLayout) ? defLayout : sc.layouts[0]
          const m = manifests[`${sc.id}.${layout}.json`] || manifests[`${sc.id}.default.json`] || Object.values(manifests).find((x) => x.screen === sc.id)
          const shot = shotForScreen(sc.id)
          const zc = m?.zones.length ?? 0
          return (
            <button key={sc.id} onClick={() => onPick(sc.id, layout)} className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-500 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="relative bg-neutral-50 dark:bg-neutral-950">
                {shot ? <Shot runName={runName} path={shot} className="block w-full" /> : <div className="grid aspect-[66/140] place-items-center font-mono text-[10px] text-neutral-400">chưa có ảnh</div>}
              </div>
              <div className="px-2.5 py-2"><div className="text-[13px] font-semibold capitalize">{sc.id.replace(/_/g, ' ')}</div><div className="font-mono text-[10px] text-neutral-400">{zc} zone{sc.layouts.length > 1 ? ` · ${sc.layouts.length} layout` : ''}</div></div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ═══════════════════════ SCREEN EDITOR (Plan B: ảnh thật + zone-cards + touchables) ═══════════════════════
function ScreenEditor({ manifest, runName }: { manifest: Manifest; runName: string }) {
  const [placements, setPlacements] = useState<Record<string, Placement>>({})
  const [events, setEvents] = useState<Record<string, AdEvent>>({})
  return <AdScreenEditor manifest={manifest} runName={runName} placements={placements} events={events} setPlacements={setPlacements} setEvents={setEvents} />
}

export function AdScreenEditor({ manifest, runName, placements, events, setPlacements, setEvents }: {
  manifest: Manifest; runName?: string
  placements: Record<string, Placement>; events: Record<string, AdEvent>
  setPlacements: React.Dispatch<React.SetStateAction<Record<string, Placement>>>
  setEvents: React.Dispatch<React.SetStateAction<Record<string, AdEvent>>>
}) {
  const [armed, setArmed] = useState<string | null>(null)
  const [selTouch, setSelTouch] = useState<string | null>(null)
  const zones = manifest.zones
  const backTouch: Touchable = { id: `${manifest.screen}_back`, label: '⬅ Back (thoát màn)', semantics: 'navigation', source: 'synthetic' }
  const allTouch = [...manifest.touchables, backTouch]
  const T = Object.fromEntries(allTouch.map((t) => [t.id, t]))
  const shot = useShot(runName || '', manifest.screenshot)

  const place = (zid: string, f?: string) => { const fmt = f || armed; const z = zones.find((x) => x.id === zid); if (!fmt || !z || !z.accepts.includes(fmt)) return
    setPlacements((p) => ({ ...p, [zid]: { format: fmt, name: suggestName(manifest.screen, zid, fmt), template: z.archetype === 'in-feed' ? 'full' : 'small', ...(z.archetype === 'in-feed' ? { everyN: 5 } : { refreshMs: zid === 'A' ? 15000 : 0 }) } })); setArmed(null) }
  const rmZone = (zid: string) => setPlacements((p) => { const n = { ...p }; delete n[zid]; return n })
  const setField = (zid: string, k: keyof Placement, v: string) => setPlacements((p) => ({ ...p, [zid]: { ...p[zid], [k]: k === 'name' || k === 'template' || k === 'format' ? v : Number(v) } }))
  const setEvent = (tid: string, type: 'interstitial' | 'rewarded' | 'none') => setEvents((e) => { const n = { ...e }; if (type === 'none') delete n[tid]; else { const c = e[tid], t = T[tid]; n[tid] = { type, name: c?.name || (type === 'rewarded' ? 'reward_unlock' : (t?.semantics === 'navigation' ? 'inter_home' : `inter_${tid}`)), capMs: c?.capMs ?? 30000, firstShow: c?.firstShow ?? true, rewardItem: c?.rewardItem || '' } } return n })
  const setEvField = (tid: string, k: keyof AdEvent, v: string | boolean) => setEvents((e) => ({ ...e, [tid]: { ...e[tid], [k]: k === 'capMs' ? Number(v) : v } as AdEvent }))
  const evBad = (tid: string) => checkEvent(T[tid], events[tid]).some((m) => m.level === 'err')

  const plan = useMemo(() => ({ app: manifest.app, screen: manifest.screen, layout: manifest.layout,
    placements: Object.entries(placements).map(([zid, p]) => { const z = zones.find((x) => x.id === zid)!; return { zone: zid, archetype: z.archetype, format: p.format, name: p.name, template: p.template, ...(z.archetype === 'in-feed' ? { everyN: Number(p.everyN) || null } : { refreshMs: Number(p.refreshMs) || 0 }) } }),
    events: Object.entries(events).map(([tid, e]) => ({ touchable: tid, trigger: 'onClick', type: e.type, name: e.name, ...(e.type === 'interstitial' ? { capMs: Number(e.capMs) || 0, firstShow: !!e.firstShow } : { rewardItem: e.rewardItem || null }) })) }), [placements, events, manifest, zones])
  const issues = useMemo(() => { const out: Msg[] = []; const names: Record<string, number> = {}
    for (const [zid, p] of Object.entries(placements)) { if (!p.name) out.push({ level: 'err', msg: `Zone ${zid}: thiếu tên.` }); else names[p.name] = (names[p.name] || 0) + 1; const z = zones.find((x) => x.id === zid)!; if (z.archetype === 'in-feed' && !(Number(p.everyN) >= 2)) out.push({ level: 'err', msg: `Zone ${zid} (in-feed): everyN ≥ 2.` }) }
    for (const [tid, e] of Object.entries(events)) { checkEvent(T[tid], e).forEach((m) => out.push({ level: m.level, msg: `${T[tid]?.label}: ${m.msg}` })); if (e.name) names[e.name] = (names[e.name] || 0) + 1 }
    for (const [n, c] of Object.entries(names)) if (c > 1) out.push({ level: 'err', msg: `Tên "${n}" trùng.` }); return out }, [placements, events, zones, T])

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* trái: palette + ẢNH THẬT + zone cards + touchables */}
      <div className="lg:w-[300px]">
        <div className="mb-1 text-sm font-semibold capitalize">{manifest.screen.replace(/_/g, ' ')} <span className="font-mono text-[11px] font-normal text-neutral-400">· {manifest.layout}</span></div>
        <div className="mb-2 flex gap-2">
          {['native', 'banner'].map((f) => (
            <button key={f} onClick={() => setArmed(armed === f ? null : f)} className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${armed === f ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 dark:border-neutral-700'}`}>{f === 'native' ? '▭' : '▬'} {f}</button>
          ))}
        </div>
        <div className="w-full max-w-[272px] rounded-[2rem] border border-neutral-300 bg-neutral-200 p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <div className="relative overflow-hidden rounded-[1.6rem]">
            {shot ? <img src={shot} alt={manifest.screen} className="block w-full" /> : <div className="grid aspect-[66/140] place-items-center bg-neutral-50 font-mono text-[10px] text-neutral-400 dark:bg-neutral-950">màn này chưa có ảnh</div>}
            {/* zone OVERLAY lên ảnh theo vị trí archetype — bấm đặt/gỡ */}
            {shot && zones.map((z) => <div key={z.id} className="absolute right-1.5 left-1.5 z-10" style={archPos(z.archetype)}><ZoneBar z={z} p={placements[z.id]} armed={armed} onPlace={place} onRemove={rmZone} /></div>)}
          </div>
        </div>
        {/* cấu hình zone đã đặt (tên/template/refresh) — chỉ hiện zone đã có ad */}
        <div className="mt-3 max-w-[272px] space-y-1">
          {zones.filter((z) => placements[z.id]).map((z) => <ZoneCard key={z.id} z={z} p={placements[z.id]} armed={armed} onPlace={place} onRemove={rmZone} onField={setField} />)}
          {!zones.length && <p className="text-xs text-neutral-400">Màn này matcher chưa dò ra zone.</p>}
          {!!zones.length && !Object.keys(placements).length && <p className="font-mono text-[10px] text-neutral-400">bấm chip Native/Banner rồi bấm zone trên ảnh để đặt.</p>}
        </div>
        <div className="mt-3 max-w-[272px]">
          <div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Touchables · bấm gắn adsEvent</div>
          <div className="flex flex-wrap gap-1.5">
            {allTouch.map((t) => { const ev = events[t.id], bad = ev && evBad(t.id), syn = t.source === 'synthetic'
              return <button key={t.id} onClick={() => setSelTouch(t.id)} title={t.semantics} className={`rounded-md border px-2 py-1 text-xs ${selTouch === t.id ? 'ring-2 ring-teal-400 ' : ''}${bad ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950' : ev ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : syn ? 'border-dashed border-neutral-400 text-neutral-500 dark:border-neutral-600' : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'}`}>{t.label}{ev ? ` · ${ev.type === 'rewarded' ? 'RW' : 'INT'}` : ''}</button> })}
          </div>
        </div>
      </div>
      {/* phải: event editor + output */}
      <div className="min-w-0 flex-1 space-y-4">
        {selTouch && <EventEditor t={T[selTouch]} ev={events[selTouch]} onSet={(ty) => setEvent(selTouch, ty)} onField={(k, v) => setEvField(selTouch, k, v)} onClose={() => setSelTouch(null)} />}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2 dark:border-neutral-900"><h4 className="text-sm font-semibold">ad-plan (output)</h4><span className="font-mono text-xs text-neutral-400">{plan.placements.length} placement · {plan.events.length} event</span></div>
          <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">{JSON.stringify(plan, null, 2)}</pre>
          <div className="space-y-1.5 px-4 pb-4">{issues.length ? issues.map((m, i) => <div key={i} className={`rounded-md px-3 py-1.5 text-xs ${m.level === 'err' ? 'bg-red-50 text-red-700 dark:bg-red-950' : 'bg-amber-50 text-amber-700 dark:bg-amber-950'}`}>{m.level === 'err' ? '✕' : '!'} {m.msg}</div>) : <div className="rounded-md bg-teal-50 px-3 py-1.5 text-xs text-teal-700 dark:bg-teal-950 dark:text-teal-200">✓ ad-plan hợp lệ.</div>}</div>
        </div>
      </div>
    </div>
  )
}

// vị trí overlay zone lên ảnh theo archetype (neo dọc gần đúng — manifest chưa có toạ-độ pixel)
function archPos(a: string): React.CSSProperties {
  switch (a) {
    case 'below-header': return { top: '8%' }
    case 'content-flow': return { top: '43%' }
    case 'in-feed': return { top: '60%' }
    case 'scaffold-bottom-dock': return { bottom: '7%' }
    default: return { top: '50%' }
  }
}
// bar overlay MẢNH, trong suốt — đặt trên ảnh; rỗng=dashed, có ad=teal đặc. Bấm đặt/gỡ.
function ZoneBar({ z, p, armed, onPlace, onRemove }: { z: Zone; p?: Placement; armed: string | null; onPlace: (zid: string, f?: string) => void; onRemove: (zid: string) => void }) {
  if (!p) {
    const can = armed && z.accepts.includes(armed)
    return <div onClick={() => armed && onPlace(z.id)} title={z.archetype} style={{ textShadow: '0 1px 2px rgba(0,0,0,.55)' }}
      className={`cursor-pointer rounded-md border-[1.5px] border-dashed px-2 py-0.5 text-center font-mono text-[8.5px] font-semibold backdrop-blur-[1px] ${can ? 'border-teal-400 bg-teal-500/25 text-white' : 'border-white/70 bg-black/15 text-white'}`}>
      {z.id} · {z.archetype}
    </div>
  }
  return <div onClick={() => onRemove(z.id)} title="bấm để gỡ" style={{ textShadow: '0 1px 2px rgba(0,0,0,.4)' }}
    className="flex cursor-pointer items-center gap-1 rounded-md border-[1.5px] border-teal-400 bg-teal-500/35 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-white backdrop-blur-[1px]">
    <span className="grid h-3.5 w-3.5 place-items-center rounded bg-teal-600">{z.id}</span><span className="flex-1 truncate">{p.format}:{p.name}</span><span>✕</span>
  </div>
}

function ZoneCard({ z, p, armed, onPlace, onRemove, onField }: { z: Zone; p?: Placement; armed: string | null; onPlace: (zid: string, f?: string) => void; onRemove: (zid: string) => void; onField: (zid: string, k: keyof Placement, v: string) => void }) {
  if (!p) { const can = armed && z.accepts.includes(armed)
    return <div onClick={() => armed && onPlace(z.id)} title={z.evidence} className={`cursor-pointer rounded-lg border-[1.5px] border-dashed p-2 text-center text-[9.5px] ${can ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950' : 'border-neutral-300 text-neutral-400 dark:border-neutral-700'}`}><span className="font-mono font-semibold">{z.id}</span> · {z.archetype} — {z.accepts.join('/')}</div> }
  const bad = z.archetype === 'in-feed' && !(Number(p.everyN) >= 2)
  return (
    <div className={`rounded-lg border-[1.5px] p-1.5 ${bad ? 'border-red-500 bg-red-50 dark:bg-red-950' : 'border-teal-500 bg-teal-50 dark:bg-teal-950'}`}>
      <div className="flex items-center gap-1.5"><span className={`grid h-4 w-4 place-items-center rounded font-mono text-[9px] text-white ${bad ? 'bg-red-500' : 'bg-teal-600'}`}>{z.id}</span><span className={`flex-1 truncate font-mono text-[9.5px] font-semibold ${bad ? 'text-red-600' : 'text-teal-700 dark:text-teal-300'}`}>{p.format}:{p.name}</span><button onClick={() => onRemove(z.id)} className="px-1 text-neutral-400 hover:text-red-500">✕</button></div>
      <div className="mt-1 flex flex-wrap gap-1">
        <input value={p.name} onChange={(e) => onField(z.id, 'name', e.target.value)} className="w-24 rounded border border-neutral-300 px-1 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900" />
        <select value={p.template} onChange={(e) => onField(z.id, 'template', e.target.value)} className="rounded border border-neutral-300 px-0.5 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900"><option>small</option><option>full</option><option>adaptive</option></select>
        {z.archetype === 'in-feed'
          ? <input type="number" min={2} value={p.everyN ?? ''} onChange={(e) => onField(z.id, 'everyN', e.target.value)} title="everyN" className="w-12 rounded border border-neutral-300 px-1 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900" />
          : <input type="number" min={0} step={1000} value={p.refreshMs ?? 0} onChange={(e) => onField(z.id, 'refreshMs', e.target.value)} title="refreshMs" className="w-14 rounded border border-neutral-300 px-1 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900" />}
      </div>
    </div>
  )
}

function EventEditor({ t, ev, onSet, onField, onClose }: { t?: Touchable; ev?: AdEvent; onSet: (ty: 'interstitial' | 'rewarded' | 'none') => void; onField: (k: keyof AdEvent, v: string | boolean) => void; onClose: () => void }) {
  if (!t) return null
  const msgs = checkEvent(t, ev)
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-2 flex items-center gap-2"><span className="text-sm font-semibold">{t.label}</span><span className="rounded border border-neutral-300 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:border-neutral-700">{t.semantics}</span><button onClick={onClose} className="ml-auto text-neutral-400 hover:text-neutral-700">✕</button></div>
      <div className="mb-3 flex gap-2">{(['interstitial', 'rewarded', 'none'] as const).map((ty) => <button key={ty} onClick={() => onSet(ty)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${(ev?.type === ty) || (!ev && ty === 'none') ? 'border-teal-500 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200' : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'}`}>{ty === 'none' ? 'Không' : ty === 'interstitial' ? 'Interstitial' : 'Rewarded'}</button>)}</div>
      {ev?.type && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1"><span className="font-mono text-[10px] tracking-wide text-neutral-400 uppercase">placement name</span><input value={ev.name} onChange={(e) => onField('name', e.target.value)} className="rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" /></label>
          {ev.type === 'interstitial' ? (
            <>
              <label className="flex flex-col gap-1"><span className="font-mono text-[10px] tracking-wide text-neutral-400 uppercase">frequency cap (ms)</span><input type="number" step={1000} value={ev.capMs ?? 30000} onChange={(e) => onField('capMs', e.target.value)} className="rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" /></label>
              <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400"><input type="checkbox" checked={!!ev.firstShow} onChange={(e) => onField('firstShow', e.target.checked)} /> show ngay lần click đầu</label>
            </>
          ) : (
            <label className="flex flex-col gap-1"><span className="font-mono text-[10px] tracking-wide text-neutral-400 uppercase">reward item (bắt buộc)</span><input value={ev.rewardItem ?? ''} placeholder="vd: unlock_theme / +5_budget" onChange={(e) => onField('rewardItem', e.target.value)} className="rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" /></label>
          )}
          <div className="mt-1 space-y-1">{msgs.length ? msgs.map((m, i) => <div key={i} className={`rounded-md px-2.5 py-1.5 text-xs ${m.level === 'err' ? 'bg-red-50 text-red-700 dark:bg-red-950' : 'bg-amber-50 text-amber-700 dark:bg-amber-950'}`}>{m.level === 'err' ? '✕' : '!'} {m.msg}</div>) : <div className="rounded-md bg-teal-50 px-2.5 py-1.5 text-xs text-teal-700 dark:bg-teal-950 dark:text-teal-200">✓ Hợp lệ.</div>}</div>
        </div>
      )}
    </div>
  )
}
