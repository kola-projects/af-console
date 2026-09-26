import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  competitorByPackage,
  competitorSessions,
  competitorFindings,
  competitorEvidence,
  competitorImageUrl,
} from '../lib/queries'
import { Badge, Mono, Empty, Loading, ErrorBox, localTime, Table, Row, Cell } from '../components/ui'
import MarkdownView from './blueprint/MarkdownView'
import type { CompetitorSession, CompetitorFinding } from '../lib/types'

type Tab = 'overview' | 'coverage' | 'monet' | 'features' | 'screens' | 'findings' | 'voc' | 'opportunities' | 'report'
const TABS: [Tab, string][] = [
  ['overview', 'Tổng quan'],
  ['coverage', 'Độ phủ'],
  ['monet', 'Kiếm tiền'],
  ['features', 'Tính năng'],
  ['screens', 'Màn hình'],
  ['findings', 'Findings'],
  ['voc', 'Người dùng nói gì'],
  ['opportunities', 'Cơ hội'],
  ['report', 'Báo cáo'],
]
type ManifestRow = { id: string; name: string; block: string; status: string; reason?: string | null }
type CoverageManifest = { ae_version?: string; af_version?: string; tier?: string; verdict?: string; pass?: number; blocked?: number; na?: number; missing?: number; manifest?: ManifestRow[] }
type FeatureRow = { key?: string; label?: string; status?: string; access?: string; notes?: string }

const KIND: Record<string, { label: string; cls: string }> = {
  FACT: { label: 'FACT', cls: 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' },
  USER_SIGNAL: { label: 'USER SIGNAL', cls: 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300' },
  INFERENCE: { label: 'INFERENCE', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  RECOMMENDATION: { label: 'RECOMMENDATION', cls: 'border border-dashed border-neutral-400 text-neutral-600 dark:text-neutral-300' },
}

function num(o: Record<string, unknown> | null | undefined, k: string): string {
  const v = (o ?? {})[k]
  return v === undefined || v === null ? '—' : String(v)
}

/** Ảnh evidence: nạp signed URL async theo storage_key. */
function EvImg({ storageKey, alt, onClick, className }: { storageKey: string; alt: string; onClick?: () => void; className?: string }) {
  const q = useQuery({
    queryKey: ['comp-img', storageKey],
    queryFn: () => competitorImageUrl(storageKey),
    staleTime: 50 * 60_000,
  })
  if (!q.data)
    return <span className={`block animate-pulse bg-neutral-200 dark:bg-neutral-800 ${className ?? ''}`} style={{ aspectRatio: '9/19' }} />
  return <img src={q.data} alt={alt} onClick={onClick} className={className} />
}

function ScoreRow({ scores }: { scores: Record<string, number> }) {
  const order: [string, string][] = [
    ['product_value', 'Giá trị sản phẩm'],
    ['ui_ux', 'UI/UX'],
    ['content', 'Nội dung'],
    ['monetization_pressure', 'Áp lực kiếm tiền (5=gắt)'],
    ['onboarding_friction', 'Ma sát onboarding (5=nặng)'],
  ]
  return (
    <div className="flex flex-col gap-2">
      {order.map(([k, label]) => {
        const v = Number(scores[k] ?? 0)
        const hard = k === 'monetization_pressure' || k === 'onboarding_friction'
        return (
          <div key={k} className="text-xs">
            <div className="flex justify-between">
              <span>{label}</span>
              <b>{v || '—'}</b>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
              <span className={`block h-full ${hard ? 'bg-amber-500' : 'bg-primary-600'}`} style={{ width: `${(v / 5) * 100}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function CompetitorDetail() {
  const pkg = decodeURIComponent(useParams().package ?? '')
  const [params] = useSearchParams()
  const initTab = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(TABS.some(([t]) => t === initTab) ? (initTab as Tab) : 'overview')
  const [zoom, setZoom] = useState<string | null>(null)
  const [sessId, setSessId] = useState<number | null>(null)
  const [findCat, setFindCat] = useState('')
  const [findType, setFindType] = useState('')

  const compQ = useQuery({ queryKey: ['competitor', pkg], queryFn: () => competitorByPackage(pkg), enabled: !!pkg })
  const sessQ = useQuery({ queryKey: ['competitor-sessions', pkg], queryFn: () => competitorSessions(pkg), enabled: !!pkg })

  const sessions = useMemo(() => sessQ.data ?? [], [sessQ.data])
  const sess: CompetitorSession | undefined = useMemo(
    () => sessions.find((s) => s.id === sessId) ?? sessions[0],
    [sessions, sessId],
  )

  const findQ = useQuery({ queryKey: ['competitor-findings', sess?.id], queryFn: () => competitorFindings(sess!.id), enabled: !!sess })
  const evQ = useQuery({ queryKey: ['competitor-evidence', sess?.id], queryFn: () => competitorEvidence(sess!.id), enabled: !!sess })

  if (compQ.isLoading || sessQ.isLoading) return <Loading />
  if (compQ.error) return <ErrorBox error={compQ.error} />
  const c = compQ.data
  if (!c) return <Empty>Không thấy đối thủ này.</Empty>

  const listing = (sess?.listing ?? {}) as Record<string, unknown>
  const summary = (sess?.summary ?? {}) as Record<string, unknown>
  const mon = (sess?.monetization ?? {}) as Record<string, unknown>
  const cov = (sess?.coverage ?? {}) as Record<string, number>
  const metrics = (sess?.metrics ?? {}) as Record<string, unknown>
  const findings = findQ.data ?? []
  const evidence = evQ.data ?? []
  const evByCode = new Map(evidence.map((e) => [e.code ?? '', e]))
  const scores = (sess?.scores ?? {}) as Record<string, number>
  const extra = (sess?.extra ?? {}) as Record<string, unknown>
  const reviewImp = (extra.review_improvement ?? null) as
    | {
        status?: string
        reason?: string
        kept_count?: number
        dropped_counts?: Record<string, number>
        kept?: Array<{ score?: number; version?: string; text?: string; n?: number; theme?: string }>
      }
    | null
  const manifest = (extra.coverage_manifest ?? null) as CoverageManifest | null
  const features = ((extra.features ?? (summary.features as unknown) ?? []) as FeatureRow[])
  const evalId = (extra.eval_id as string | undefined) ?? (sess ? `S${sess.id}` : '')
  const adNetworks = mon.ad_networks as Record<string, { count?: number }> | string[] | undefined
  const adUnits = (mon.ad_units ?? {}) as Record<string, number>
  const adPlacements = findings.filter((f) => f.category === 'ad_placement')
  const iapFindings = findings.filter((f) => f.category === 'pricing' || f.category === 'paywall')

  const listArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
  // ad_networks/iap_sdks/trackers được lưu dạng OBJECT {name: {...}} — lấy tên; hỗ trợ cả array cũ
  const keyList = (v: unknown): string[] =>
    Array.isArray(v) ? (v as string[]) : v && typeof v === 'object' ? Object.keys(v as object) : []
  const findCats = [...new Set(findings.map((f) => f.category))].sort()
  const shownFindings = findings.filter((f) => (!findCat || f.category === findCat) && (!findType || f.type === findType))
  const opportunities = findings.filter((f) => f.category === 'opportunity')

  // ảnh feature app-owned (loại ad + store), có top_act nếu cần — dùng screens có evidence code S##
  const screenShots = evidence.filter((e) => e.kind === 'screenshot')

  return (
    <div className="max-w-5xl">
      <div className="text-xs text-neutral-500">
        <Link to="/competitors" className="no-underline hover:underline">
          Competitors
        </Link>{' '}
        / <Mono>{pkg}</Mono>
      </div>

      {/* HERO */}
      <div className="mt-3 flex items-start gap-4">
        {c.icon_url ? (
          <img src={c.icon_url} alt="" referrerPolicy="no-referrer" className="h-16 w-16 flex-none rounded-2xl border border-neutral-200 object-cover dark:border-neutral-800" />
        ) : (
          <span className="h-16 w-16 flex-none rounded-2xl bg-gradient-to-br from-primary-200 to-primary-50 dark:from-primary-900 dark:to-primary-950" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold">{c.name ?? pkg}</h1>
            {evalId && (
              <span className="rounded bg-primary-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary-800 dark:bg-primary-950 dark:text-primary-300" title="Mã đánh giá (dùng để tham chiếu)">
                {evalId}
              </span>
            )}
            <span className="text-sm text-neutral-500">{c.developer}</span>
            <Mono className="text-xs text-neutral-500">{pkg}</Mono>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {manifest?.verdict && (
              <span
                className={`rounded px-1.5 py-0.5 font-semibold ${
                  manifest.verdict === 'VALID'
                    ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                    : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                }`}
                title="Kết quả kiểm độ phủ 36 tiêu chí"
              >
                {manifest.verdict === 'VALID' ? '✓' : '✗'} {manifest.verdict} · Tier {manifest.tier}
              </span>
            )}
            {c.category_play && <Badge>{c.category_play}</Badge>}
            {(c.tags ?? []).map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
            <span className="text-neutral-500">
              {listing.score ? `${Number(listing.score).toFixed(1)}★` : ''} · {String(listing.installs ?? '')}
            </span>
          </div>
          {manifest?.ae_version && (
            <div className="mt-1 text-[11px] text-neutral-400">
              Quy trình: {manifest.ae_version} · {manifest.pass} PASS · {manifest.blocked} BLOCKED · {manifest.na} N/A · {manifest.missing} THIẾU
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
            {c.store_url && (
              <a href={c.store_url} target="_blank" rel="noreferrer">
                Google Play ↗
              </a>
            )}
            {typeof listing.privacyPolicy === 'string' && (
              <a href={listing.privacyPolicy} target="_blank" rel="noreferrer">
                Privacy policy ↗
              </a>
            )}
            {(c.related_app_codes ?? []).length > 0 && (
              <span className="text-neutral-500">App AF liên quan: {(c.related_app_codes ?? []).join(', ')}</span>
            )}
          </div>
        </div>
      </div>

      {/* STAT TILES */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          [String(findings.length), 'findings'],
          [String(screenShots.length), 'ảnh màn'],
          [num(listing, 'reviews'), 'review store'],
          [
            String(Array.isArray(mon.ad_networks) ? mon.ad_networks.length : Object.keys((mon.ad_networks ?? {}) as object).length),
            'mạng ads',
          ],
          [`${Number(cov._overall ?? 0)}%`, 'coverage'],
          [`${Number(metrics.cold_start_median_ms ?? 0) || '—'}`, 'cold start (ms)'],
        ].map(([v, l], i) => (
          <div key={i} className="flex min-w-[96px] flex-col rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
            <b className="text-lg tabular-nums">{v}</b>
            <span className="text-[10px] uppercase tracking-wide text-neutral-500">{l}</span>
          </div>
        ))}
      </div>

      {/* SESSION SELECTOR */}
      {sessions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Phiên đánh giá:</span>
          {sessions.map((s) => {
            const active = s.id === (sess?.id ?? -1)
            return (
              <button
                key={s.id}
                onClick={() => setSessId(s.id)}
                className={`rounded-lg border px-3 py-1.5 text-left text-xs ${
                  active
                    ? 'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300'
                    : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900'
                }`}
              >
                <span className="block font-semibold">
                  <Mono>{s.app_version ?? '?'}</Mono>
                  {s.install_status && s.install_status !== 'installed' ? ` · ${s.install_status}` : ''}
                </span>
                <span className="block">
                  {localTime(s.evaluated_at)} · {s.research_type} · {s.device ?? ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* TABS */}
      <nav className="mt-4 flex flex-wrap gap-1 border-b border-neutral-200 text-sm dark:border-neutral-800">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 ${
              tab === t
                ? 'border-primary-600 font-medium text-primary-700 dark:text-primary-300'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            {label}
            {t === 'findings' ? ` (${findings.length})` : t === 'opportunities' ? ` (${opportunities.length})` : ''}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'overview' && (
          <div className="grid gap-4 md:grid-cols-3">
            <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800 md:col-span-2">
              <h2 className="mb-2 text-sm font-semibold">Executive summary</h2>
              <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                {[
                  ['positioning', 'Positioning'],
                  ['target_user', 'Target user'],
                  ['core_value', 'Core value'],
                  ['activation', 'Activation'],
                  ['monetization_model', 'Monetization'],
                  ['paywall_strategy', 'Paywall'],
                  ['ads_strategy', 'Ads'],
                  ['retention', 'Retention'],
                ].map(([k, label]) => (
                  <div key={k} className="contents">
                    <dt className="text-neutral-500">{label}</dt>
                    <dd>{typeof summary[k] === 'string' ? (summary[k] as string) : '—'}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ['strengths', 'Điểm mạnh', 'text-green-700 dark:text-green-400'],
                  ['weaknesses', 'Điểm yếu', 'text-red-700 dark:text-red-400'],
                  ['pain_points', 'Pain point', 'text-amber-700 dark:text-amber-400'],
                ].map(([k, label, cls]) => (
                  <div key={k}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide ${cls}`}>{label}</div>
                    <ul className="mt-1 list-disc pl-4 text-xs">
                      {listArr(summary[k]).length === 0 ? (
                        <li className="list-none pl-0 text-neutral-400">— (xem tab Findings)</li>
                      ) : (
                        listArr(summary[k])
                          .slice(0, 4)
                          .map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
            <div className="flex flex-col gap-4">
              <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Điểm rubric (INFERENCE)</h2>
                <ScoreRow scores={scores} />
              </section>
              <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Kiếm tiền (từ APK)</h2>
                <div className="flex flex-wrap gap-1">
                  {keyList(mon.ad_networks).length === 0 ? (
                    <span className="text-xs text-neutral-500">
                      {sess?.install_status === 'blocked' ? 'Không có APK (app bị chặn cài) → không quét được SDK.' : 'Không phát hiện mạng ads trong APK.'}
                    </span>
                  ) : (
                    keyList(mon.ad_networks).map((n) => (
                      <Badge key={n} tone="warn">
                        {n}
                      </Badge>
                    ))
                  )}
                </div>
                <div className="mt-2 text-xs text-neutral-500">
                  IAP: {keyList(mon.iap_sdks).join(', ') || '—'} · Tracker: {keyList(mon.trackers).join(', ') || '—'}
                </div>
              </section>
              <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Coverage</h2>
                <div className="flex flex-col gap-1 text-xs">
                  {Object.entries(cov)
                    .filter(([k]) => !k.startsWith('_'))
                    .map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[110px_1fr_32px] items-center gap-2">
                        <span className="text-neutral-500">{k}</span>
                        <span className="h-1.5 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                          <span className={`block h-full ${v < 60 ? 'bg-amber-500' : 'bg-primary-600'}`} style={{ width: `${v}%` }} />
                        </span>
                        <b className="text-right">{v}%</b>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          </div>
        )}

        {tab === 'coverage' && (
          <div>
            {!manifest ? (
              <Empty>Phiên này chưa có bảng độ phủ (đánh giá bằng bản ae.sh cũ).</Empty>
            ) : (
              <>
                <div
                  className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                    manifest.verdict === 'VALID'
                      ? 'border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950'
                      : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950'
                  }`}
                >
                  <b>VERDICT: {manifest.verdict}</b> — Tier {manifest.tier} · {manifest.pass} PASS · {manifest.blocked} BLOCKED · {manifest.na} N/A · {manifest.missing} THIẾU
                  <div className="mt-0.5 text-[11px] text-neutral-500">Quy trình: {manifest.ae_version} · AF {manifest.af_version}</div>
                </div>
                <p className="mb-2 text-xs text-neutral-500">
                  36 tiêu chí cố định. Tiêu chí bị chặn luôn nêu rõ lý do (không bỏ trống). ✅ PASS · ⛔ BLOCKED · ➖ N/A · ❌ THIẾU.
                </p>
                <Table head={['#', 'Tiêu chí', 'Khối', 'Trạng thái', 'Lý do']}>
                  {(manifest.manifest ?? []).map((m) => (
                    <Row key={m.id}>
                      <Cell><Mono className="text-[11px]">{m.id}</Mono></Cell>
                      <Cell>{m.name}</Cell>
                      <Cell><span className="text-[11px] text-neutral-500">{m.block}</span></Cell>
                      <Cell>
                        <span
                          className={
                            m.status === 'PASS'
                              ? 'text-green-700 dark:text-green-400'
                              : m.status === 'BLOCKED'
                                ? 'text-amber-700 dark:text-amber-400'
                                : m.status === 'THIẾU'
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-neutral-500'
                          }
                        >
                          {m.status === 'PASS' ? '✅' : m.status === 'BLOCKED' ? '⛔' : m.status === 'N/A' ? '➖' : '❌'} {m.status}
                        </span>
                      </Cell>
                      <Cell><span className="text-[11px] text-neutral-500">{m.reason ?? ''}</span></Cell>
                    </Row>
                  ))}
                </Table>
              </>
            )}
          </div>
        )}

        {tab === 'monet' && (
          (() => {
            const nets: [string, number][] = Array.isArray(adNetworks)
              ? (adNetworks as string[]).map((n) => [n, 0])
              : Object.entries((adNetworks ?? {}) as Record<string, { count?: number }>).map(([n, v]) => [n, v?.count ?? 0])
            nets.sort((a, b) => b[1] - a[1])
            const units = Object.entries(adUnits).sort((a, b) => (b[1] as number) - (a[1] as number))
            const blocked = sess?.install_status === 'blocked'
            return (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  {[
                    [mon.ad_supported ? '✓ Có' : '—', 'Ads'],
                    [mon.offers_iap === false ? 'Không' : mon.offers_iap ? '✓ Có' : '—', 'IAP'],
                    [String(nets.length), 'mạng ads'],
                    [String(units.length), 'ad unit'],
                    [String(mon.iap_range ?? '—'), 'dải giá IAP'],
                  ].map(([v, l], i) => (
                    <div key={i} className="flex min-w-[92px] flex-col rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
                      <b className="text-sm tabular-nums">{v}</b>
                      <span className="text-[10px] uppercase tracking-wide text-neutral-500">{l}</span>
                    </div>
                  ))}
                </div>

                <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <h2 className="mb-2 text-sm font-semibold">Mạng quảng cáo (mediation, từ census APK)</h2>
                  {nets.length === 0 ? (
                    <p className="text-xs text-neutral-500">{blocked ? 'App bị chặn cài → không có APK để quét SDK.' : 'Không phát hiện mạng ads trong APK.'}</p>
                  ) : (
                    <Table head={['Mạng', 'Số tham chiếu trong code']}>
                      {nets.map(([n, cnt]) => (
                        <Row key={n}>
                          <Cell><Badge tone="warn">{n}</Badge></Cell>
                          <Cell><span className="tabular-nums text-neutral-600 dark:text-neutral-300">{cnt || '—'}</span></Cell>
                        </Row>
                      ))}
                    </Table>
                  )}
                </section>

                <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <h2 className="mb-1 text-sm font-semibold">Ad unit (AdMob) tìm thấy trong APK</h2>
                  <p className="mb-2 text-[11px] text-neutral-500">ID unit + số lần tham chiếu (APK chỉ chứa ID, không có tên đặt trên dashboard; loại inter/banner/rewarded suy từ tab Vị trí bên dưới).</p>
                  {units.length === 0 ? (
                    <p className="text-xs text-neutral-500">{blocked ? 'Không có APK (app bị chặn cài).' : 'Không tách được ad unit từ static analysis.'}</p>
                  ) : (
                    <Table head={['Ad unit ID', 'Ref']}>
                      {units.map(([u, cnt]) => (
                        <Row key={u}>
                          <Cell><Mono className="text-[11px]">{u}</Mono></Cell>
                          <Cell><span className="tabular-nums text-neutral-500">{cnt}</span></Cell>
                        </Row>
                      ))}
                    </Table>
                  )}
                </section>

                <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <h2 className="mb-2 text-sm font-semibold">Vị trí / thời điểm quảng cáo QUAN SÁT ({adPlacements.length})</h2>
                  {adPlacements.length === 0 ? (
                    <p className="text-xs text-neutral-500">{blocked ? 'Không trải nghiệm được (app bị chặn cài).' : 'Chưa ghi nhận vị trí ad.'}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {adPlacements.map((f) => (
                        <li key={f.id} className="text-xs">
                          <Mono className="text-[10px] text-neutral-400">{f.code}</Mono> <b>{f.title}</b>
                          <span className="block text-neutral-600 dark:text-neutral-400">{f.description}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                  <h2 className="mb-2 text-sm font-semibold">IAP / Gói trả phí ({iapFindings.length})</h2>
                  <p className="mb-2 text-xs text-neutral-500">
                    offersIAP: <b>{mon.offers_iap === false ? 'Không' : mon.offers_iap ? 'Có' : '—'}</b>
                    {mon.iap_range ? <> · dải giá store: <b>{String(mon.iap_range)}</b></> : null}
                  </p>
                  {mon.offers_iap === false ? (
                    <p className="text-xs text-neutral-500">App không bán IAP (mô hình chỉ quảng cáo / rewarded).</p>
                  ) : iapFindings.length === 0 ? (
                    <p className="text-xs text-neutral-500">{blocked ? 'Không quan sát được gói (app bị chặn cài); chỉ có dải giá store ở trên.' : 'Chưa ghi nhận gói cụ thể (xem dải giá store).'}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {iapFindings.map((f) => (
                        <li key={f.id} className="text-xs">
                          <Mono className="text-[10px] text-neutral-400">{f.code}</Mono> <b>{f.title}</b>
                          <span className="block text-neutral-600 dark:text-neutral-400">{f.description}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )
          })()
        )}

        {tab === 'features' && (
          <div>
            {features.length === 0 ? (
              <Empty>Phiên này chưa có danh sách tính năng chuẩn hoá.</Empty>
            ) : (
              <>
                <p className="mb-2 text-xs text-neutral-500">
                  Danh sách tính năng CHUẨN HOÁ (key dùng chung để so sánh chéo các app cùng dòng). {features.length} tính năng.
                </p>
                <Table head={['Feature key', 'Tên', 'Có?', 'Truy cập', 'Ghi chú']}>
                  {features.map((f, i) => (
                    <Row key={f.key ?? i}>
                      <Cell><Mono className="text-[11px]">{f.key}</Mono></Cell>
                      <Cell>{f.label}</Cell>
                      <Cell>
                        <span
                          className={
                            f.status === 'present'
                              ? 'text-green-700 dark:text-green-400'
                              : f.status === 'absent'
                                ? 'text-neutral-400'
                                : 'text-amber-700 dark:text-amber-400'
                          }
                        >
                          {f.status === 'present' ? '✓ có' : f.status === 'absent' ? '— không' : '? chưa rõ'}
                        </span>
                      </Cell>
                      <Cell><span className="text-[11px] text-neutral-500">{f.access}</span></Cell>
                      <Cell><span className="text-[11px] text-neutral-500">{f.notes}</span></Cell>
                    </Row>
                  ))}
                </Table>
              </>
            )}
          </div>
        )}

        {tab === 'screens' && (
          <div>
            {screenShots.length === 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950">
                <b>⛔ Không có ảnh trải nghiệm</b>
                <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                  Lý do: {sess?.install_status === 'blocked' ? 'app không cài được từ Play (Tier B store-only) nên không có ảnh trải nghiệm thiết bị.' : 'phiên này chưa gắn ảnh màn.'}
                </div>
              </div>
            ) : (
              <>
            <p className="mb-3 text-xs text-neutral-500">Ảnh THẬT các màn đã trải nghiệm (chạm để phóng to). {screenShots.length} ảnh.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {screenShots.map((e) => (
                <figure key={e.id} className="m-0">
                  <button
                    className="block w-full overflow-hidden rounded-xl border border-neutral-200 bg-black p-0 text-left dark:border-neutral-800"
                    onClick={async () => setZoom(await competitorImageUrl(e.storage_key!))}
                  >
                    <EvImg storageKey={e.storage_key!} alt={e.caption ?? ''} className="aspect-[9/19] w-full object-cover object-top" />
                  </button>
                  <figcaption className="mt-1 truncate text-[11px] text-neutral-500" title={e.caption ?? ''}>
                    <Mono>{e.code}</Mono> {e.screen_name ?? ''}
                  </figcaption>
                </figure>
              ))}
            </div>
              </>
            )}
          </div>
        )}

        {tab === 'findings' && (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <select className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950" value={findType} onChange={(e) => setFindType(e.target.value)}>
                <option value="">Mọi loại</option>
                <option value="FACT">FACT</option>
                <option value="USER_SIGNAL">USER SIGNAL</option>
                <option value="INFERENCE">INFERENCE</option>
                <option value="RECOMMENDATION">RECOMMENDATION</option>
              </select>
              <select className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950" value={findCat} onChange={(e) => setFindCat(e.target.value)}>
                <option value="">Mọi category</option>
                {findCats.map((c2) => (
                  <option key={c2} value={c2}>
                    {c2}
                  </option>
                ))}
              </select>
              <span className="ml-auto self-center text-xs text-neutral-500">
                {shownFindings.length} / {findings.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {shownFindings.map((f) => (
                <FindingCard key={f.id} f={f} evByCode={evByCode} onZoom={setZoom} />
              ))}
            </div>
          </div>
        )}

        {tab === 'voc' && (
          <div>
            {(() => {
              const kept = reviewImp?.kept ?? []
              const dc = reviewImp?.dropped_counts ?? {}
              const dropped = (dc.seeding ?? 0) + (dc.generic_ads ?? 0) + (dc.generic_negative ?? 0)
              if (kept.length === 0) {
                const reason =
                  reviewImp?.reason ??
                  (reviewImp?.status === 'NO_REVIEWS' || reviewImp?.status === 'NOT_OBSERVED'
                    ? 'Store không trả review để phân tích (app mới / in-development / locale).'
                    : 'Chưa lọc được review đóng góp cải tiến.')
                return (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950">
                    <b>⛔ Không có Voice of Customer</b>
                    <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">Lý do: {reason}</div>
                    {dropped > 0 && (
                      <div className="mt-0.5 text-[11px] text-neutral-500">
                        (Đã lọc bỏ {dropped}: seeding {dc.seeding ?? 0}, ads-chung {dc.generic_ads ?? 0}, tiêu cực rỗng {dc.generic_negative ?? 0})
                      </div>
                    )}
                  </div>
                )
              }
              const byTheme = new Map<string, typeof kept>()
              for (const r of kept) {
                const k = r.theme ?? 'khác'
                byTheme.set(k, [...(byTheme.get(k) ?? []), r])
              }
              return (
                <>
                  <p className="mb-3 text-xs text-neutral-500">
                    Chỉ giữ review ĐÓNG GÓP CẢI TIẾN: <b>{kept.length}</b> review (đã bỏ {dropped}: seeding {dc.seeding ?? 0}, ads-chung{' '}
                    {dc.generic_ads ?? 0}, tiêu cực rỗng {dc.generic_negative ?? 0}).
                  </p>
                  <div className="flex flex-col gap-3">
                    {[...byTheme.entries()].map(([theme, rs]) => (
                      <div key={theme} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <b className="text-sm">{theme.replace(/_/g, ' ')}</b>
                          <Badge>{rs.length} review</Badge>
                        </div>
                        {rs.slice(0, 5).map((r, j) => (
                          <blockquote
                            key={j}
                            className="mt-2 rounded border-l-2 border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                          >
                            “{r.text}”
                            <span className="mt-0.5 block text-[10px] text-neutral-500">
                              ★{r.score ?? '?'} · v{r.version ?? '?'} · review #{r.n ?? '?'}
                            </span>
                          </blockquote>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {tab === 'opportunities' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {opportunities.length === 0 ? (
              <Empty>Chưa có cơ hội.</Empty>
            ) : (
              opportunities.map((o) => {
                const d = (o.data ?? {}) as Record<string, unknown>
                const tq = (d.three_questions ?? {}) as Record<string, unknown>
                return (
                  <div key={o.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                    <h3 className="text-sm font-semibold">
                      <Mono className="text-xs text-neutral-500">{o.code}</Mono> {o.title}
                    </h3>
                    <p className="mt-1 text-xs">{o.description}</p>
                    {Boolean(tq.competitor_problem) && (
                      <div className="mt-2 text-[11px] text-neutral-500">
                        <div>
                          <b>Đối thủ:</b> {String(tq.competitor_problem)}
                        </div>
                        <div>
                          <b>Metric:</b> {String(tq.metric ?? '')}
                        </div>
                        <div>
                          <b>User của ta:</b> {String(tq.our_user_problem ?? '')}
                        </div>
                      </div>
                    )}
                    {Boolean(d.impact) && (
                      <div className="mt-2 text-[11px] text-neutral-500">
                        Impact {String(d.impact)} · Effort {String(d.effort ?? '?')} · {String(d.next_action ?? o.status ?? '')}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {tab === 'report' && (sess?.report_md ? <MarkdownView text={sess.report_md} /> : <Empty>Phiên này chưa có report.md.</Empty>)}
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}

function FindingCard({
  f,
  evByCode,
  onZoom,
}: {
  f: CompetitorFinding
  evByCode: Map<string, { storage_key: string | null; caption: string | null }>
  onZoom: (u: string) => void
}) {
  const [open, setOpen] = useState(false)
  const k = KIND[f.type] ?? { label: f.type, cls: '' }
  const evImgs = (f.evidence_ids ?? []).map((c) => evByCode.get(c)).filter((e): e is NonNullable<typeof e> => !!e && !!e.storage_key)
  const data = (f.data ?? {}) as Record<string, unknown>
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex flex-wrap items-start gap-2">
        <Mono className="text-[11px] text-neutral-500">{f.code}</Mono>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${k.cls}`}>{k.label}</span>
        {f.confidence && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">{f.confidence}</span>}
        {f.status && <span className="rounded border border-dashed border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-700">{f.status}</span>}
        <span className="text-[11px] text-neutral-400">{f.category}</span>
      </div>
      <div className="mt-1 text-sm font-medium">{f.title}</div>
      <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300">{f.description}</div>
      {(f.evidence_ids ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {(f.evidence_ids ?? []).map((c) => (
            <Mono key={c} className="rounded bg-primary-50 px-1 text-[10px] text-primary-700 dark:bg-primary-950 dark:text-primary-300">
              {c}
            </Mono>
          ))}
          {(f.source_codes ?? []).length > 0 && <span className="text-[10px] text-neutral-400">từ {(f.source_codes ?? []).join(', ')}</span>}
          {(evImgs.length > 0 || Object.keys(data).length > 0) && (
            <button className="ml-auto text-[11px] text-neutral-500 underline" onClick={() => setOpen((v) => !v)}>
              {open ? 'ẩn' : 'chi tiết'}
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-900">
          {evImgs.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto">
              {evImgs.map((e, i) => (
                <button key={i} className="flex-none overflow-hidden rounded border border-neutral-200 dark:border-neutral-800" onClick={async () => onZoom(await competitorImageUrl(e.storage_key!))}>
                  <EvImg storageKey={e.storage_key!} alt={e.caption ?? ''} className="h-40 w-auto" />
                </button>
              ))}
            </div>
          )}
          {Object.entries(data).map(([kk, vv]) => (
            <div key={kk} className="text-[11px] text-neutral-500">
              <b>{kk}:</b> {typeof vv === 'object' ? JSON.stringify(vv) : String(vv)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
