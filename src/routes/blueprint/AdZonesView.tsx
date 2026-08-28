import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { blueprintDir, blueprintFile } from '../../lib/queries'
import { b64ToText, b64ToDataURL, mimeOf } from '../../lib/blueprint'
import { Empty, ErrorBox, Loading } from '../../components/ui'

/** AdZonesView — editor kéo-thả ads đọc từ blueprint/adzones/ (schema adzone/1).
 *  Luồng: (1) chọn STYLE + LAYOUT → (2) phone-in-context: đặt native/banner vào
 *  zone hữu hạn (chèn đúng vị trí ngữ cảnh) + gắn adsEvent inter/reward (kiểm policy)
 *  → xuất ad-plan. Xem instructions/adzones.md. Chỉ đọc + soạn plan client-side. */

type StyleV = { id: string; label: string }
type LayoutV = { id: string; label: string; desc?: string }
type ScreenMeta = { id: string; composable: string; layouts: string[] }
export type IndexFile = {
  schema: string; app: string
  styles: StyleV[]; layouts: LayoutV[]; screens: ScreenMeta[]
  manifests: { screen: string; layout: string; file: string; zones: number; touchables: number }[]
}
type Zone = {
  id: string; archetype: string; scope?: string
  accepts: string[]; anchor: string; reserveDp: number; requires?: string[]
  source?: string; evidence?: string
}
type Touchable = { id: string; label: string; semantics: string; source?: string }
export type Manifest = {
  schema: string; app: string; screen: string; layout: string
  screenshot?: string | null   // ảnh màn thật (blueprint-relative) để render; null → mockup fallback
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
    if (t.semantics === 'micro-interaction')
      out.push({ level: 'err', msg: 'Interstitial trên micro-interaction — vi phạm policy disruptive-inter của AdMob. Chỉ gắn inter vào transition thật.' })
    if (ev.capMs != null && ev.capMs > 0 && ev.capMs < 15000)
      out.push({ level: 'warn', msg: 'Frequency cap < 15s — quá dày, rủi ro policy. Nên ≥ 30s.' })
    if (!ev.name) out.push({ level: 'err', msg: 'Thiếu tên placement (khoá join tới sheet unit-id).' })
  }
  if (ev.type === 'rewarded') {
    if (!ev.rewardItem) out.push({ level: 'err', msg: 'Rewarded phải khai thứ để mở khoá (reward item). Không có value-gate thì không đặt reward.' })
    if (t.semantics === 'navigation') out.push({ level: 'warn', msg: 'Touchable điều-hướng thuần — reward cần một value-gate (unlock/extra).' })
    if (!ev.name) out.push({ level: 'err', msg: 'Thiếu tên placement.' })
  }
  return out
}

const suggestName = (screen: string, zid: string, fmt: string) =>
  zid === 'A' ? (fmt === 'banner' ? 'banner_home' : 'native_home')
    : zid === 'C' ? `${fmt}_${screen}`
      : zid === 'B' ? `${fmt}_${screen}_header`
        : zid === 'D' ? `native_${screen}_feed` : `${fmt}_${screen}_${zid.toLowerCase()}`

export default function AdZonesView({ runName }: { runName: string }) {
  const dir = useQuery({
    queryKey: ['adzones', runName],
    queryFn: () => blueprintDir(runName, 'adzones/'),
  })

  const parsed = useMemo(() => {
    let index: IndexFile | null = null
    const manifests: Record<string, Manifest> = {}
    for (const f of dir.data ?? []) {
      try {
        const obj = JSON.parse(b64ToText(f.content_b64))
        if (f.path.endsWith('/index.json')) index = obj as IndexFile
        else manifests[f.path.replace(/^adzones\//, '')] = obj as Manifest
      } catch { /* bỏ file hỏng */ }
    }
    return { index, manifests }
  }, [dir.data])

  const [style, setStyle] = useState<string | null>(null)
  const [layout, setLayout] = useState<string | null>(null)
  const [screen, setScreen] = useState<string | null>(null)

  if (dir.isLoading) return <Loading />
  if (dir.error) return <ErrorBox error={dir.error} />
  const index = parsed.index
  if (!index) return <Empty>Chưa có adzones/index.json (chạy `python3 tools/adzones.py scan &lt;app&gt;`).</Empty>

  const screensForLayout = layout
    ? index.screens.filter((s) => s.layouts.includes(layout) || s.layouts.includes('default'))
    : []

  if (!style || !layout || !screen) {
    return (
      <div className="max-w-2xl">
        <h3 className="mb-1 text-lg font-semibold">Ad zones · {index.app}</h3>
        <p className="mb-5 text-sm text-neutral-500">
          Zone bám <b>layout</b> (không bám style). Chọn <b>style + layout</b> trước, rồi mở phone kéo-thả của layout đó.
        </p>
        <PickRow label="Style (skin preview)">
          {index.styles.map((s) => (
            <Chip key={s.id} on={style === s.id} onClick={() => setStyle(s.id)}>{s.label}</Chip>
          ))}
        </PickRow>
        <PickRow label="Layout (quyết định zones)">
          {index.layouts.map((l) => (
            <Chip key={l.id} on={layout === l.id} onClick={() => { setLayout(l.id); setScreen(null) }} title={l.desc}>{l.label}</Chip>
          ))}
        </PickRow>
        {layout && (
          <PickRow label="Màn (Home-onward)">
            {screensForLayout.length
              ? screensForLayout.map((s) => (<Chip key={s.id} on={screen === s.id} onClick={() => setScreen(s.id)}>{s.id}</Chip>))
              : <span className="text-sm text-neutral-400">layout này chưa có manifest màn nào</span>}
          </PickRow>
        )}
        {(!style || !layout || !screen) && (
          <p className="mt-4 text-xs text-neutral-400">{!style ? 'Chọn style…' : !layout ? 'Chọn layout…' : 'Chọn màn để mở canvas.'}</p>
        )}
      </div>
    )
  }

  const file = `${screen}.${layout}.json`
  const manifest =
    parsed.manifests[file] || parsed.manifests[`${screen}.default.json`] ||
    Object.values(parsed.manifests).find((m) => m.screen === screen)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => setScreen(null)} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">← đổi variant</button>
        <span className="font-mono text-xs text-neutral-500">
          {index.styles.find((s) => s.id === style)?.label} · {index.layouts.find((l) => l.id === layout)?.label} · {screen}
        </span>
      </div>
      {manifest ? <Canvas key={file} manifest={manifest} runName={runName} /> : <Empty>Không thấy manifest {file}.</Empty>}
    </div>
  )
}

function PickRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}
function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className={`rounded-lg border px-3 py-1.5 text-sm ${on
        ? 'border-teal-500 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200'
        : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400'}`}>
      {children}
    </button>
  )
}

// ── canvas: phone-in-context cho một manifest (state cục bộ — dùng trong tab Blueprint) ──
function Canvas({ manifest, runName }: { manifest: Manifest; runName?: string }) {
  const [placements, setPlacements] = useState<Record<string, Placement>>({})
  const [events, setEvents] = useState<Record<string, AdEvent>>({})
  return <AdScreenEditor manifest={manifest} runName={runName} placements={placements} events={events} setPlacements={setPlacements} setEvents={setEvents} />
}

/** Editor một màn (phone-in-context) — CONTROLLED: dùng lại trong Ads Builder wizard. */
export function AdScreenEditor({ manifest, runName, placements, events, setPlacements, setEvents }: {
  manifest: Manifest; runName?: string
  placements: Record<string, Placement>; events: Record<string, AdEvent>
  setPlacements: React.Dispatch<React.SetStateAction<Record<string, Placement>>>
  setEvents: React.Dispatch<React.SetStateAction<Record<string, AdEvent>>>
}) {
  const [armed, setArmed] = useState<string | null>(null)
  const [selTouch, setSelTouch] = useState<string | null>(null)

  const zones = manifest.zones
  const T = Object.fromEntries(manifest.touchables.map((t) => [t.id, t]))
  const zoneByArch = (a: string) => zones.find((z) => z.archetype === a)

  // ảnh MÀN THẬT (nếu manifest có screenshot + biết runName) → render thay mockup
  const shot = manifest.screenshot
  const shotQ = useQuery({
    queryKey: ['adzone-shot', runName, shot],
    queryFn: () => blueprintFile(runName!, shot!),
    enabled: !!runName && !!shot,
  })
  const imgUrl = shotQ.data ? b64ToDataURL(shotQ.data.content_b64, mimeOf(shot!, shotQ.data.content_type)) : null

  const place = (zid: string, fmt?: string) => {
    const f = fmt || armed
    const z = zones.find((x) => x.id === zid)
    if (!f || !z || !z.accepts.includes(f)) return
    setPlacements((p) => ({
      ...p,
      [zid]: {
        format: f, name: suggestName(manifest.screen, zid, f),
        template: z.archetype === 'in-feed' ? 'full' : 'small',
        ...(z.archetype === 'in-feed' ? { everyN: 5 } : { refreshMs: zid === 'A' ? 15000 : 0 }),
      },
    }))
    setArmed(null)
  }
  const removeZone = (zid: string) => setPlacements((p) => { const n = { ...p }; delete n[zid]; return n })
  const setZoneField = (zid: string, k: keyof Placement, v: string) =>
    setPlacements((p) => ({ ...p, [zid]: { ...p[zid], [k]: k === 'name' || k === 'template' || k === 'format' ? v : Number(v) } }))

  const setEvent = (tid: string, type: 'interstitial' | 'rewarded' | 'none') => {
    setEvents((e) => {
      const n = { ...e }
      if (type === 'none') delete n[tid]
      else {
        const cur = e[tid]; const t = T[tid]
        n[tid] = { type, name: cur?.name || (type === 'rewarded' ? 'reward_unlock' : (t?.semantics === 'navigation' ? 'inter_home' : `inter_${tid}`)),
          capMs: cur?.capMs ?? 30000, firstShow: cur?.firstShow ?? true, rewardItem: cur?.rewardItem || '' }
      }
      return n
    })
  }
  const setEventField = (tid: string, k: keyof AdEvent, v: string | boolean) =>
    setEvents((e) => ({ ...e, [tid]: { ...e[tid], [k]: k === 'capMs' ? Number(v) : v } as AdEvent }))
  const eventBad = (tid: string) => checkEvent(T[tid], events[tid]).some((m) => m.level === 'err')

  const plan = useMemo(() => ({
    app: manifest.app, screen: manifest.screen, layout: manifest.layout,
    placements: Object.entries(placements).map(([zid, p]) => {
      const z = zones.find((x) => x.id === zid)!
      return { zone: zid, archetype: z.archetype, format: p.format, name: p.name, template: p.template,
        ...(z.archetype === 'in-feed' ? { everyN: Number(p.everyN) || null } : { refreshMs: Number(p.refreshMs) || 0 }) }
    }),
    events: Object.entries(events).map(([tid, e]) => ({ touchable: tid, trigger: 'onClick', type: e.type, name: e.name,
      ...(e.type === 'interstitial' ? { capMs: Number(e.capMs) || 0, firstShow: !!e.firstShow } : { rewardItem: e.rewardItem || null }) })),
  }), [placements, events, manifest, zones])

  const issues = useMemo(() => {
    const out: Msg[] = []; const names: Record<string, number> = {}
    for (const [zid, p] of Object.entries(placements)) {
      if (!p.name) out.push({ level: 'err', msg: `Zone ${zid}: thiếu tên.` }); else names[p.name] = (names[p.name] || 0) + 1
      const z = zones.find((x) => x.id === zid)!
      if (z.archetype === 'in-feed' && !(Number(p.everyN) >= 2)) out.push({ level: 'err', msg: `Zone ${zid} (in-feed): everyN ≥ 2.` })
    }
    for (const [tid, e] of Object.entries(events)) {
      checkEvent(T[tid], e).forEach((m) => out.push({ level: m.level, msg: `${T[tid]?.label}: ${m.msg}` }))
      if (e.name) names[e.name] = (names[e.name] || 0) + 1
    }
    for (const [n, c] of Object.entries(names)) if (c > 1) out.push({ level: 'err', msg: `Tên "${n}" trùng.` })
    return out
  }, [placements, events, zones, T])

  const slotProps = { placements, armed, onPlace: place, onRemove: removeZone, onField: setZoneField }
  const tiles = manifest.touchables.slice(0, 6)

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* trái: palette + PHONE */}
      <div className="flex flex-col items-center lg:w-[300px]">
        <div className="mb-2 flex w-[272px] gap-2">
          {['native', 'banner'].map((f) => (
            <button key={f} draggable onDragStart={() => setArmed(f)} onClick={() => setArmed(armed === f ? null : f)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize ${armed === f ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 dark:border-neutral-700'}`}>
              <span className="mr-1 opacity-60">{f === 'native' ? '▭' : '▬'}</span>{f}
            </button>
          ))}
        </div>
        <p className="mb-3 text-center font-mono text-[11px] text-neutral-400">{armed ? `đã chọn ${armed} — bấm zone` : 'bấm chip rồi bấm zone (hoặc kéo-thả)'}</p>

        {/* IMAGE MODE — ảnh MÀN THẬT + phủ zone theo archetype */}
        {imgUrl && (
          <div className="relative w-[272px] rounded-[2rem] border border-neutral-300 bg-neutral-200 p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
            <div className="relative overflow-hidden rounded-[1.6rem]">
              <img src={imgUrl} alt={manifest.screen} className="block w-full" />
              {zones.map((z) => (
                <div key={z.id} className="absolute right-2 left-2 z-10" style={archPos(z.archetype)}>
                  <ZoneSlot z={z} p={placements[z.id]} armed={armed} onPlace={place} onRemove={removeZone} onField={setZoneField} />
                </div>
              ))}
            </div>
            <div className="pt-1 text-center font-mono text-[9px] text-neutral-400">ảnh thật · {manifest.screenshot?.split('/').pop()}</div>
          </div>
        )}

        {/* MOCKUP FALLBACK — màn chưa có ảnh */}
        {!imgUrl && (
        <div className="w-[272px] rounded-[2rem] border border-neutral-300 bg-neutral-200 p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex min-h-[540px] flex-col overflow-hidden rounded-[1.6rem] bg-neutral-50 dark:bg-neutral-950">
            <div className="flex flex-1 flex-col gap-2 p-3">
              {/* header */}
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[15px] font-bold">{cap(manifest.app.replace(/^\d+-\d+-/, ''))} 💰</span>
                <span className="font-mono text-[11px] text-neutral-400">Aug ▾</span>
              </div>

              <ZoneOrGap z={zoneByArch('below-header')} {...slotProps} />

              {/* hero card (trang trí) */}
              <div className="rounded-2xl p-3 text-white" style={{ backgroundImage: 'linear-gradient(135deg,#5B8DD9,#7C6FE0)' }}>
                <div className="text-[11px] opacity-90">Total balance</div>
                <div className="text-xl font-bold">$4,820</div>
                <div className="mt-2 flex justify-between border-t border-dashed border-white/40 pt-1.5 text-[10.5px] opacity-90">
                  <span>Total expenditure</span><span>−$1,240</span>
                </div>
              </div>

              {/* actions = touchables (clickable, gắn event) */}
              {tiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tiles.map((t) => {
                    const ev = events[t.id]; const bad = ev && eventBad(t.id)
                    return (
                      <button key={t.id} onClick={() => setSelTouch(t.id)} title={t.semantics}
                        className={`relative flex-1 basis-[28%] rounded-xl border px-1 py-2.5 text-center text-[10px] font-medium ${selTouch === t.id ? 'ring-2 ring-teal-400 ' : ''}${bad ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950'
                          : ev ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'}`}>
                        <span className="block truncate">{t.label}</span>
                        {ev && <span className={`absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-px font-mono text-[7px] text-white ${bad ? 'bg-red-500' : ev.type === 'rewarded' ? 'bg-violet-500' : 'bg-teal-600'}`}>{ev.type === 'rewarded' ? 'RW' : 'INT'}</span>}
                      </button>
                    )
                  })}
                </div>
              )}

              <ZoneOrGap z={zoneByArch('content-flow')} {...slotProps} />

              {/* feed + in-feed zone chèn giữa các row */}
              <div>
                <div className="pb-1 text-[10px] font-bold text-neutral-400">TODAY</div>
                <FeedRow amt="−$18" c="text-red-500" />
                <ZoneOrGap z={zoneByArch('in-feed')} {...slotProps} inline />
                <FeedRow amt="+$900" c="text-emerald-500" />
              </div>
            </div>

            {/* dock: scaffold zone trên nav bar */}
            <div className="mt-auto">
              <div className="px-2 pb-1">
                <ZoneOrGap z={zoneByArch('scaffold-bottom-dock')} {...slotProps} sharedLabel />
              </div>
              <div className="flex items-center justify-around border-t border-neutral-200 bg-white px-2 pt-2 pb-3 dark:border-neutral-800 dark:bg-neutral-900">
                <div className="grid h-8 w-8 -translate-y-1 place-items-center rounded-full bg-teal-500 text-lg text-white">＋</div>
                {['⌂ Home', '◔ Stats', '◈ Budget', '⚙ Set'].map((n) => (
                  <span key={n} className="flex-1 text-center text-[9px] text-neutral-400">{n.split(' ')[0]}<br />{n.split(' ')[1]}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* touchables — chỗ gắn adsEvent tường minh (luôn hiện, kể cả khi phone không đủ tile) */}
        <div className="mt-4 w-[272px]">
          <div className="mb-1.5 text-[11px] tracking-wide text-neutral-400 uppercase">Touchables · bấm để gắn adsEvent</div>
          {manifest.touchables.length ? (
            <div className="flex flex-wrap gap-1.5">
              {manifest.touchables.map((t) => {
                const ev = events[t.id]; const bad = ev && eventBad(t.id)
                return (
                  <button key={t.id} onClick={() => setSelTouch(t.id)} title={t.semantics}
                    className={`rounded-md border px-2 py-1 text-xs ${selTouch === t.id ? 'ring-2 ring-teal-400 ' : ''}${bad ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950'
                      : ev ? 'border-teal-500 bg-teal-50 dark:bg-teal-950' : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'}`}>
                    {t.label}{ev ? ` · ${ev.type === 'rewarded' ? 'RW' : 'INT'}` : ''}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-neutral-400">Matcher chưa dò được touchable cho màn này.</p>
          )}
        </div>
      </div>

      {/* phải: event editor + output */}
      <div className="min-w-0 flex-1 space-y-4">
        {selTouch && (
          <EventEditor t={T[selTouch]} ev={events[selTouch]}
            onSet={(ty) => setEvent(selTouch, ty)} onField={(k, v) => setEventField(selTouch, k, v)} onClose={() => setSelTouch(null)} />
        )}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2 dark:border-neutral-900">
            <h4 className="text-sm font-semibold">ad-plan (output)</h4>
            <span className="font-mono text-xs text-neutral-400">{plan.placements.length} placement · {plan.events.length} event</span>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">{JSON.stringify(plan, null, 2)}</pre>
          <div className="space-y-1.5 px-4 pb-4">
            {issues.length
              ? issues.map((m, i) => (<div key={i} className={`rounded-md px-3 py-1.5 text-xs ${m.level === 'err' ? 'bg-red-50 text-red-700 dark:bg-red-950' : 'bg-amber-50 text-amber-700 dark:bg-amber-950'}`}>{m.level === 'err' ? '✕' : '!'} {m.msg}</div>))
              : <div className="rounded-md bg-teal-50 px-3 py-1.5 text-xs text-teal-700 dark:bg-teal-950 dark:text-teal-200">✓ ad-plan hợp lệ.</div>}
          </div>
        </div>
        {!manifest.touchables.length && <p className="text-xs text-neutral-400">matcher chưa dò được touchable cho màn này.</p>}
      </div>
    </div>
  )
}

function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s }

/** vị trí phủ zone lên ảnh màn thật, theo archetype (không toạ-độ chính xác — neo dọc gần đúng). */
function archPos(a: string): React.CSSProperties {
  switch (a) {
    case 'below-header': return { top: '9%' }
    case 'content-flow': return { top: '46%' }
    case 'in-feed': return { top: '64%' }
    case 'scaffold-bottom-dock': return { bottom: '3%' }
    default: return { top: '50%' }
  }
}

function FeedRow({ amt, c }: { amt: string; c: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="h-6 w-6 flex-none rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <span className="flex-1"><span className="block h-2 w-3/5 rounded bg-neutral-300 dark:bg-neutral-700" /><span className="mt-1 block h-1.5 w-2/5 rounded bg-neutral-200 dark:bg-neutral-800" /></span>
      <span className={`text-[11px] font-bold ${c}`}>{amt}</span>
    </div>
  )
}

type SlotShared = {
  placements: Record<string, Placement>; armed: string | null
  onPlace: (zid: string, fmt?: string) => void; onRemove: (zid: string) => void; onField: (zid: string, k: keyof Placement, v: string) => void
}
/** zone tại một vị trí ngữ cảnh trong phone — không có zone thì không render gì. */
function ZoneOrGap({ z, inline, sharedLabel, ...s }: { z?: Zone; inline?: boolean; sharedLabel?: boolean } & SlotShared) {
  if (!z) return null
  return (
    <div className={inline ? 'my-1' : ''}>
      {sharedLabel && <div className="pb-0.5 text-center font-mono text-[9px] text-neutral-400">— scaffold · dùng chung mọi biến thể —</div>}
      <ZoneSlot z={z} p={s.placements[z.id]} armed={s.armed} onPlace={s.onPlace} onRemove={s.onRemove} onField={s.onField} />
    </div>
  )
}

function ZoneSlot({ z, p, armed, onPlace, onRemove, onField }: {
  z: Zone; p?: Placement; armed: string | null
  onPlace: (zid: string, fmt?: string) => void; onRemove: (zid: string) => void; onField: (zid: string, k: keyof Placement, v: string) => void
}) {
  if (!p) {
    const canDrop = armed && z.accepts.includes(armed)
    return (
      <div onClick={() => armed && onPlace(z.id)} onDragOver={(e) => { if (canDrop) e.preventDefault() }} onDrop={() => armed && onPlace(z.id, armed)} title={z.evidence}
        className={`cursor-pointer rounded-lg border-[1.5px] border-dashed p-2 text-center text-[9.5px] ${canDrop ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950' : 'border-neutral-300 text-neutral-400 dark:border-neutral-700'}`}>
        <span className="font-mono font-semibold">{z.id}</span> · {z.archetype} — kéo/thả {z.accepts.join('/')}
      </div>
    )
  }
  const bad = z.archetype === 'in-feed' && !(Number(p.everyN) >= 2)
  return (
    <div className={`rounded-lg border-[1.5px] p-1.5 ${bad ? 'border-red-500 bg-red-50 dark:bg-red-950' : 'border-teal-500 bg-teal-50 dark:bg-teal-950'}`}>
      <div className="flex items-center gap-1.5">
        <span className={`grid h-4 w-4 place-items-center rounded font-mono text-[9px] text-white ${bad ? 'bg-red-500' : 'bg-teal-600'}`}>{z.id}</span>
        <span className={`flex-1 truncate font-mono text-[9.5px] font-semibold ${bad ? 'text-red-600' : 'text-teal-700 dark:text-teal-300'}`}>{p.format}:{p.name}</span>
        <button onClick={() => onRemove(z.id)} className="px-1 text-neutral-400 hover:text-red-500">✕</button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        <input value={p.name} onChange={(e) => onField(z.id, 'name', e.target.value)} className="w-24 rounded border border-neutral-300 px-1 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900" />
        <select value={p.template} onChange={(e) => onField(z.id, 'template', e.target.value)} className="rounded border border-neutral-300 px-0.5 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900">
          <option>small</option><option>full</option><option>adaptive</option>
        </select>
        {z.archetype === 'in-feed'
          ? <input type="number" min={2} value={p.everyN ?? ''} onChange={(e) => onField(z.id, 'everyN', e.target.value)} title="everyN" className="w-12 rounded border border-neutral-300 px-1 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900" />
          : <input type="number" min={0} step={1000} value={p.refreshMs ?? 0} onChange={(e) => onField(z.id, 'refreshMs', e.target.value)} title="refreshMs" className="w-14 rounded border border-neutral-300 px-1 py-0.5 font-mono text-[9.5px] dark:border-neutral-700 dark:bg-neutral-900" />}
      </div>
    </div>
  )
}

function EventEditor({ t, ev, onSet, onField, onClose }: {
  t?: Touchable; ev?: AdEvent
  onSet: (ty: 'interstitial' | 'rewarded' | 'none') => void; onField: (k: keyof AdEvent, v: string | boolean) => void; onClose: () => void
}) {
  if (!t) return null
  const msgs = checkEvent(t, ev)
  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold">{t.label}</span>
        <span className="rounded border border-neutral-300 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:border-neutral-700">{t.semantics}</span>
        <button onClick={onClose} className="ml-auto text-neutral-400 hover:text-neutral-700">✕</button>
      </div>
      <div className="mb-3 flex gap-2">
        {(['interstitial', 'rewarded', 'none'] as const).map((ty) => (
          <button key={ty} onClick={() => onSet(ty)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${(ev?.type === ty) || (!ev && ty === 'none') ? 'border-teal-500 bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-200' : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'}`}>
            {ty === 'none' ? 'Không' : ty === 'interstitial' ? 'Interstitial' : 'Rewarded'}
          </button>
        ))}
      </div>
      {ev?.type && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] tracking-wide text-neutral-400 uppercase">placement name</span>
            <input value={ev.name} onChange={(e) => onField('name', e.target.value)} className="rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" />
          </label>
          {ev.type === 'interstitial' ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] tracking-wide text-neutral-400 uppercase">frequency cap (ms)</span>
                <input type="number" step={1000} value={ev.capMs ?? 30000} onChange={(e) => onField('capMs', e.target.value)} className="rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                <input type="checkbox" checked={!!ev.firstShow} onChange={(e) => onField('firstShow', e.target.checked)} /> show ngay lần click đầu
              </label>
            </>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] tracking-wide text-neutral-400 uppercase">reward item (bắt buộc)</span>
              <input value={ev.rewardItem ?? ''} placeholder="vd: unlock_theme / +5_budget" onChange={(e) => onField('rewardItem', e.target.value)} className="rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
          )}
          <div className="mt-1 space-y-1">
            {msgs.length
              ? msgs.map((m, i) => (<div key={i} className={`rounded-md px-2.5 py-1.5 text-xs ${m.level === 'err' ? 'bg-red-50 text-red-700 dark:bg-red-950' : 'bg-amber-50 text-amber-700 dark:bg-amber-950'}`}>{m.level === 'err' ? '✕' : '!'} {m.msg}</div>))
              : <div className="rounded-md bg-teal-50 px-2.5 py-1.5 text-xs text-teal-700 dark:bg-teal-950 dark:text-teal-200">✓ Hợp lệ.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
