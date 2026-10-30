import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { appsPublic, partnersList } from '../lib/queries'
import { appCodeOf, TEAMS } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import { AppIcon, AppNameLabel, PackageName } from '../components/appMeta'
import { IntegrationChips } from '../components/Integration'

type SortKey = 'created' | 'name' | 'code'

/** /apps — DANH MỤC SẢN PHẨM (mọi user). Bản curated: mỗi app xem được ASO /
 *  design preview / legal (RLS 0023). App ẩn (admin đặt) không hiện với non-admin.
 *  Quản lý nội bộ (runs/blueprint/ẩn) ở trang riêng /manage-apps (chỉ admin). */
export default function Apps() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['apps-product'], queryFn: appsPublic })
  const pq = useQuery({ queryKey: ['partners'], queryFn: partnersList })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('created')
  const [teamFilter, setTeamFilter] = useState('')
  const [partnerFilter, setPartnerFilter] = useState('')

  const partnerMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of pq.data ?? []) m.set(p.partner_code, p.name)
    return m
  }, [pq.data])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (q.data ?? [])
      .filter((a) => !a.is_hidden)
      .filter((a) => !teamFilter || (teamFilter === '__none__' ? !a.team : a.team === teamFilter))
      .filter((a) => {
        if (!partnerFilter) return true
        const pc = (a.extra as Record<string, unknown> | null)?.partner_code as string | undefined
        return partnerFilter === '__none__' ? !pc : pc === partnerFilter
      })
      .filter(
        (a) =>
          !needle ||
          a.name.toLowerCase().includes(needle) ||
          (appCodeOf(a) ?? '').toLowerCase().includes(needle) ||
          (a.package_name ?? '').toLowerCase().includes(needle),
      )
    return [...filtered].sort((a, b) => {
      if (sort === 'code') return (appCodeOf(b) ?? '').localeCompare(appCodeOf(a) ?? '')
      if (sort === 'name') return a.name.localeCompare(b.name)
      return b.created_at.localeCompare(a.created_at)
    })
  }, [q.data, search, sort, teamFilter, partnerFilter])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />

  return (
    <div>
      <h1 className="text-lg">Apps</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Danh mục sản phẩm. Bấm vào một app để xem ASO, design preview và legal.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo mã / tên / package…"
          className="w-64 rounded border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:focus:border-neutral-400"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="created">Sắp xếp: tạo mới nhất ↓</option>
          <option value="name">Sắp xếp: tên A→Z</option>
          <option value="code">Sắp xếp: app code ↓</option>
        </select>
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Team: tất cả</option>
          {TEAMS.map((t) => (
            <option key={t} value={t}>
              Team: {t}
            </option>
          ))}
          <option value="__none__">Team: (chưa gán)</option>
        </select>
        <select
          value={partnerFilter}
          onChange={(e) => setPartnerFilter(e.target.value)}
          className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Partner: tất cả</option>
          {(pq.data ?? []).map((p) => (
            <option key={p.partner_code} value={p.partner_code}>
              Partner: {p.name}
            </option>
          ))}
          <option value="__none__">Partner: (chưa gán)</option>
        </select>
        <span className="text-xs text-neutral-500">
          {rows.length}/{q.data?.length ?? 0} app
        </span>
      </div>

      <div className="mt-4">
        {!rows.length ? (
          <Empty>{search ? 'Không app nào khớp tìm kiếm.' : 'Chưa có app nào.'}</Empty>
        ) : (
          <Table head={['Code', 'App', 'Partner', 'Tích hợp', 'Family', 'Team', 'Package', 'Tạo lúc']}>
            {rows.map((a) => (
              <Row key={a.id} onClick={() => navigate(`/apps/${a.id}`)}>
                <Cell>
                  {appCodeOf(a) ? (
                    <Mono className="font-semibold">{appCodeOf(a)}</Mono>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </Cell>
                <Cell>
                  <span className="flex items-center gap-2.5 underline underline-offset-2">
                    <AppIcon app={a} size={32} />
                    <AppNameLabel app={a} />
                  </span>
                </Cell>
                <Cell>
                  {(() => {
                    const pc = (a.extra as Record<string, unknown> | null)?.partner_code as string | undefined
                    return pc ? <Badge>{partnerMap.get(pc) ?? pc}</Badge> : <span className="text-neutral-400">—</span>
                  })()}
                </Cell>
                <Cell>
                  <IntegrationChips integ={a.integration} />
                </Cell>
                <Cell>
                  {a.family_code ? (
                    <span className="flex items-center gap-1.5">
                      <Mono>{a.family_code}</Mono>
                      <Badge tone={a.family_role === 'master' ? 'good' : undefined}>
                        {a.family_role === 'master' ? 'master' : `#${a.family_seq ?? '?'}`}
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </Cell>
                <Cell>{a.team ? <Badge>{a.team}</Badge> : <span className="text-neutral-400">—</span>}</Cell>
                <Cell>
                  <PackageName app={a} />
                </Cell>
                <Cell className="text-neutral-500">{localTime(a.created_at)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </div>
  )
}
