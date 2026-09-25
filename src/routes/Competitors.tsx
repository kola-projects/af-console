import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { competitors } from '../lib/queries'
import { Table, Row, Cell, Badge, Mono, Empty, Loading, ErrorBox, localTime } from '../components/ui'
import type { Competitor } from '../lib/types'

const inputCls =
  'w-72 rounded border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:focus:border-neutral-400'
const selectCls =
  'rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950'

/** Icon đối thủ: ưu tiên icon_url (CDN Play), fallback ô màu. */
function CompIcon({ c, size = 32 }: { c: Competitor; size?: number }) {
  if (c.icon_url)
    return (
      <img
        src={c.icon_url}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="flex-none rounded-lg border border-neutral-200 object-cover dark:border-neutral-800"
        style={{ width: size, height: size }}
        onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
      />
    )
  return (
    <span
      className="flex-none rounded-lg bg-gradient-to-br from-primary-200 to-primary-50 dark:from-primary-900 dark:to-primary-950"
      style={{ width: size, height: size }}
    />
  )
}

/** 5 cột điểm rubric thu gọn: SP·UX·ND·KT·MS. */
function ScoreBars({ scores }: { scores: Competitor['latest_scores'] }) {
  if (!scores) return <span className="text-neutral-400">—</span>
  const order: [string, string][] = [
    ['product_value', 'SP'],
    ['ui_ux', 'UX'],
    ['content', 'ND'],
    ['monetization_pressure', 'KT'],
    ['onboarding_friction', 'MS'],
  ]
  return (
    <span className="inline-flex items-end gap-[3px]" title="Sản phẩm · UI/UX · Nội dung · Áp lực kiếm tiền · Ma sát onboarding">
      {order.map(([k]) => {
        const v = Number(scores[k] ?? 0)
        const hard = k === 'monetization_pressure' || k === 'onboarding_friction'
        return (
          <span key={k} className="flex flex-col justify-end" style={{ height: 14 }}>
            <span
              className={hard ? 'bg-amber-500' : 'bg-primary-600'}
              style={{ width: 5, height: Math.max(2, (v / 5) * 14), borderRadius: 1, display: 'block' }}
            />
          </span>
        )
      })}
    </span>
  )
}

function monFlags(mon: Competitor['latest_monetization']): { ads: boolean; iap: boolean; sub: boolean } {
  const m = (mon ?? {}) as Record<string, unknown>
  const nets = (m.ad_networks as string[] | undefined) ?? []
  const iapSdks = (m.iap_sdks as string[] | undefined) ?? []
  const listingSub = String(JSON.stringify(m)).toLowerCase()
  return {
    ads: nets.length > 0 || m.ad_supported === true,
    iap: iapSdks.length > 0 || m.offers_iap === true,
    sub: /subscription|weekly|monthly|trial/.test(listingSub),
  }
}

export default function Competitors() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['competitors'], queryFn: competitors })
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [tag, setTag] = useState('')
  const [mon, setMon] = useState('')
  const [sort, setSort] = useState<'recent' | 'name' | 'rating'>('recent')

  const cats = useMemo(
    () => [...new Set((q.data ?? []).map((c) => c.category_play).filter(Boolean))] as string[],
    [q.data],
  )
  const alltags = useMemo(
    () => [...new Set((q.data ?? []).flatMap((c) => c.tags ?? []))].sort(),
    [q.data],
  )

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (q.data ?? []).filter((c) => {
      if (cat && c.category_play !== cat) return false
      if (tag && !(c.tags ?? []).includes(tag)) return false
      if (mon) {
        const f = monFlags(c.latest_monetization)
        if (mon === 'ads' && !f.ads) return false
        if (mon === 'iap' && !f.iap) return false
        if (mon === 'sub' && !f.sub) return false
      }
      if (!needle) return true
      return (
        (c.name ?? '').toLowerCase().includes(needle) ||
        c.package_name.toLowerCase().includes(needle) ||
        (c.developer ?? '').toLowerCase().includes(needle) ||
        (c.category_play ?? '').toLowerCase().includes(needle) ||
        (c.tags ?? []).some((t) => t.toLowerCase().includes(needle))
      )
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return (a.name ?? '').localeCompare(b.name ?? '')
      if (sort === 'rating') {
        const ra = Number((a.latest_listing as Record<string, unknown>)?.score ?? 0)
        const rb = Number((b.latest_listing as Record<string, unknown>)?.score ?? 0)
        return rb - ra
      }
      return (b.last_evaluated_at ?? b.created_at).localeCompare(a.last_evaluated_at ?? a.created_at)
    })
  }, [q.data, search, cat, tag, mon, sort])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg">Competitors</h1>
          <p className="mt-1 text-sm text-neutral-500">
            App đối thủ đã trải nghiệm bằng <Mono>ae.sh</Mono> — gom theo package, mỗi phiên bản một lần đánh giá, không ghi đè lịch sử.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className={inputCls}
          type="search"
          placeholder="Tìm tên · package · developer · tag · category"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={selectCls} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Mọi category</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className={selectCls} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Mọi tag</option>
          {alltags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectCls} value={mon} onChange={(e) => setMon(e.target.value)}>
          <option value="">Mọi kiếm tiền</option>
          <option value="ads">Có Ads</option>
          <option value="iap">Có IAP</option>
          <option value="sub">Có Subscription</option>
        </select>
        <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="recent">Đánh giá gần nhất</option>
          <option value="name">Tên</option>
          <option value="rating">Rating</option>
        </select>
        <div className="ml-auto text-xs text-neutral-500">{rows.length} app</div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6">
          <Empty>Chưa có app đối thủ nào khớp bộ lọc.</Empty>
        </div>
      ) : (
        <div className="mt-4">
          <Table head={['App', 'Package', 'Category', 'Tag', 'Kiếm tiền', 'Rating · Installs', 'Điểm', 'Phiên']}>
            {rows.map((c) => {
              const f = monFlags(c.latest_monetization)
              const listing = (c.latest_listing ?? {}) as Record<string, unknown>
              return (
                <Row key={c.id} onClick={() => navigate(`/competitors/${encodeURIComponent(c.package_name)}`)}>
                  <Cell>
                    <span className="flex items-center gap-2.5">
                      <CompIcon c={c} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium underline underline-offset-2">
                          {c.name ?? c.package_name}
                        </span>
                        <span className="block truncate text-[11px] text-neutral-500">{c.developer ?? '—'}</span>
                      </span>
                    </span>
                  </Cell>
                  <Cell>
                    <Mono className="text-[11px] text-neutral-500">{c.package_name}</Mono>
                  </Cell>
                  <Cell>{c.category_play ? <Badge>{c.category_play}</Badge> : <span className="text-neutral-400">—</span>}</Cell>
                  <Cell>
                    <span className="flex flex-wrap gap-1">
                      {(c.tags ?? []).slice(0, 3).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </span>
                  </Cell>
                  <Cell>
                    <span className="flex gap-1 whitespace-nowrap">
                      {f.ads && <Badge tone="warn">Ads</Badge>}
                      {f.iap && <Badge>IAP</Badge>}
                      {f.sub && <Badge tone="bad">Sub</Badge>}
                    </span>
                  </Cell>
                  <Cell className="whitespace-nowrap text-neutral-600 dark:text-neutral-300">
                    {listing.score ? `${Number(listing.score).toFixed(1)}★` : '—'} · {String(listing.installs ?? '—')}
                  </Cell>
                  <Cell>
                    <ScoreBars scores={c.latest_scores} />
                  </Cell>
                  <Cell className="whitespace-nowrap text-neutral-500">
                    {c.sessions_count} · <Mono className="text-[11px]">{c.latest_app_version ?? '?'}</Mono>
                    <span className="block text-[11px]">{localTime(c.last_evaluated_at)}</span>
                  </Cell>
                </Row>
              )
            })}
          </Table>
        </div>
      )}
    </div>
  )
}
