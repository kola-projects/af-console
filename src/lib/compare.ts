// Port TS của tools/compare_build.py — để trang /compare tính ma trận CLIENT-SIDE khi chọn app ad-hoc.
// Bản lưu (compare.sh --push) đã có sẵn data cùng shape; hàm này tạo data tương đương từ session.
import type { CompetitorSession, CmpApp, CompareData, CmpFeatureRow, Competitor } from './types'

function evScopeOf(s: CompetitorSession): string {
  const cm = ((s.extra ?? {}) as Record<string, unknown>).coverage_manifest as Record<string, unknown> | undefined
  const sc = cm?.ev_scope as string | undefined
  if (sc) return sc
  const t = cm?.tier as string | undefined
  if (t === 'A') return 'full'
  if (t === 'B') return 'store_only'
  return s.install_status === 'installed' ? 'full' : 'store_only'
}

function monetOf(s: CompetitorSession): CmpApp['monet'] {
  const mon = (s.monetization ?? {}) as Record<string, unknown>
  const m2 = (mon.monet ?? {}) as Record<string, unknown>
  const nets = mon.ad_networks
  let names: string[] = []
  if (Array.isArray(nets)) names = nets as string[]
  else if (nets && typeof nets === 'object')
    names = Object.entries(nets as Record<string, { count?: number }>)
      .sort((a, b) => (b[1]?.count ?? 0) - (a[1]?.count ?? 0))
      .map(([k]) => k)
  const bidding = (mon.bidding ?? {}) as Record<string, unknown>
  return {
    ad_supported: mon.ad_supported as boolean | undefined,
    offers_iap: mon.offers_iap as boolean | undefined,
    iap_range: (mon.iap_range as string) ?? null,
    ad_networks: names,
    mediation_primary: (m2.mediation_primary as string) ?? (bidding.mediation_primary as string) ?? null,
    ad_formats: (m2.ad_formats as string[]) ?? [],
    bidding_sources: ((m2.bidding_sources as { name: string }[]) ?? []).map((b) => b.name),
    consent_cmp: (m2.consent_cmp as string[]) ?? [],
    billing: ((m2.billing as Record<string, unknown>)?.library as string) ?? null,
  }
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [])

export function sessionToApp(s: CompetitorSession, comp?: Competitor): CmpApp {
  const listing = (s.listing ?? {}) as Record<string, unknown>
  const summ = (s.summary ?? {}) as Record<string, unknown>
  const ex = (s.extra ?? {}) as Record<string, unknown>
  const featsArr = (Array.isArray(ex.features) ? ex.features : Array.isArray(summ.features) ? summ.features : []) as {
    key?: string
    label?: string
    status?: string
    access?: string
    notes?: string
  }[]
  const features: CmpApp['features'] = {}
  for (const f of featsArr) if (f.key) features[f.key] = f
  const pick = (k: string) => (typeof summ[k] === 'string' ? (summ[k] as string) : null)
  return {
    eval_id: (ex.eval_id as string) ?? `S${s.id}`,
    session_id: s.id,
    name: s.competitor_name ?? (listing.title as string) ?? null,
    package: s.package_name,
    developer: s.developer,
    icon_url: comp?.icon_url ?? null,
    store_url: comp?.store_url ?? (listing.url as string) ?? null,
    version: s.app_version,
    install_status: s.install_status,
    ev_scope: evScopeOf(s),
    evaluated_at: s.evaluated_at,
    tags: s.tags ?? comp?.tags ?? [],
    category: comp?.category_play ?? (listing.genre as string) ?? null,
    rating: (listing.score as number) ?? null,
    ratings: (listing.ratings as number) ?? null,
    reviews: (listing.reviews as number) ?? null,
    installs: (listing.installs as string) ?? null,
    updated: (listing.updated as string) ?? null,
    scores: (s.scores ?? {}) as Record<string, number>,
    coverage_overall: (s.coverage ?? {})._overall ?? null,
    summary: {
      positioning: pick('positioning'),
      target_user: pick('target_user'),
      core_value: pick('core_value'),
      activation: pick('activation'),
      monetization_model: pick('monetization_model'),
      paywall_strategy: pick('paywall_strategy'),
      ads_strategy: pick('ads_strategy'),
      retention: pick('retention'),
    },
    strengths: strArr(summ.strengths),
    weaknesses: strArr(summ.weaknesses),
    pain_points: strArr(summ.pain_points),
    monet: monetOf(s),
    features,
  }
}

export function buildCompare(apps: CmpApp[], name = ''): CompareData {
  const installed = apps.filter((a) => Object.keys(a.features).length > 0)
  const keys: string[] = []
  const seen = new Set<string>()
  const labels: Record<string, string> = {}
  for (const a of apps)
    for (const [k, f] of Object.entries(a.features)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
      if (!labels[k]) labels[k] = f.label ?? k
    }

  const n = installed.length
  const feature_matrix: CmpFeatureRow[] = keys.map((k) => {
    const cells: CmpFeatureRow['cells'] = {}
    let present = 0
    for (const a of apps) {
      const f = a.features[k]
      if (f) {
        const st = f.status ?? 'present'
        cells[a.eval_id] = { status: st, access: f.access ?? null, notes: f.notes ?? null }
        if (st === 'present') present++
      } else {
        cells[a.eval_id] = { status: Object.keys(a.features).length === 0 ? 'unknown' : 'absent' }
      }
    }
    const klass: CmpFeatureRow['klass'] =
      n && present === n ? 'table_stake' : present === 1 ? 'differentiator' : present === 0 ? 'absent_all' : 'contested'
    return { key: k, label: labels[k], present_count: present, klass, cells }
  })

  const differentiators: Record<string, string[]> = {}
  for (const row of feature_matrix)
    if (row.klass === 'differentiator')
      for (const [ev, cell] of Object.entries(row.cells))
        if (cell.status === 'present') (differentiators[ev] ??= []).push(row.label)
  const table_stakes = feature_matrix.filter((r) => r.klass === 'table_stake').map((r) => r.label)
  const contested = feature_matrix.filter((r) => r.klass === 'contested').map((r) => r.label)

  const tagsets = apps.filter((a) => a.tags.length).map((a) => new Set(a.tags))
  const common_tags = tagsets.length
    ? [...tagsets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))))].sort()
    : []
  const categories = [...new Set(apps.map((a) => a.category).filter(Boolean) as string[])].sort()
  const store_only = apps.filter((a) => a.ev_scope === 'store_only').map((a) => a.eval_id)

  const agg = (field: 'pain_points' | 'weaknesses') => {
    const c = new Map<string, number>()
    for (const a of apps) for (const x of a[field]) if (x?.trim()) c.set(x.trim(), (c.get(x.trim()) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([text, nn]) => ({ text, n: nn }))
  }

  const monet_aggressiveness = apps
    .map((a) => ({
      eval_id: a.eval_id,
      name: a.name,
      pressure: a.scores.monetization_pressure ?? null,
      friction: a.scores.onboarding_friction ?? null,
      ad_networks: a.monet.ad_networks.length,
    }))
    .sort((a, b) => (b.pressure ?? 0) - (a.pressure ?? 0) || (b.friction ?? 0) - (a.friction ?? 0))

  return {
    apps,
    feature_matrix,
    feature_summary: { n_with_features: n, table_stakes, contested, differentiators },
    coherence: { common_tags, categories, store_only },
    pain_points: agg('pain_points'),
    weaknesses: agg('weaknesses'),
    monet_aggressiveness,
    meta: { name, generated_at: new Date().toISOString(), eval_ids: apps.map((a) => a.eval_id) },
  }
}
