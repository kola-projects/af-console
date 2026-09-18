import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { appsWithRuns, setAppHidden, setAppStoreUrl, setAppTeam } from '../lib/queries'
import { appCodeOf, TEAMS, type AppRow } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import { AppIcon, AppNameLabel, PackageName, appLastUpdate, blueprintRuns } from '../components/appMeta'
import { FunnelCell, HostCell, AsoCell, LegalCell, LandingCell, GitCell } from '../components/Integration'

type SortKey = 'last_update' | 'created' | 'name' | 'code'

/** /manage-apps — QUẢN LÝ APP (admin). Đầy đủ nội bộ: runs, blueprint, last update,
 *  và ẩn/hiện app khỏi danh mục sản phẩm của user thường. */
export default function ManageApps() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['apps-manage'], queryFn: appsWithRuns })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('last_update')
  const [teamFilter, setTeamFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')          // '' | 'android' | 'ios'
  // Hiển thị theo trạng thái kinh doanh (is_hidden là boolean → 2 checkbox). MẶC ĐỊNH ẩn
  // app đã ẩn (chỉ 'Đang kinh doanh'); nhớ lựa chọn qua localStorage để F5 không reset.
  const [avail, setAvail] = useState<{ active: boolean; hidden: boolean }>(() => {
    try {
      const s = localStorage.getItem('manage-apps-avail')
      if (s) return JSON.parse(s)
    } catch { /* private mode / blocked */ }
    return { active: true, hidden: false }
  })
  useEffect(() => {
    try {
      localStorage.setItem('manage-apps-avail', JSON.stringify(avail))
    } catch { /* ignore */ }
  }, [avail])
  const [adsFilter, setAdsFilter] = useState('')                    // '' | full | funnel | none | unscanned
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['apps-manage'] })
    qc.invalidateQueries({ queryKey: ['apps-product'] })
  }
  const hide = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) => setAppHidden(id, hidden),
    onSuccess: invalidate,
  })
  const team = useMutation({
    mutationFn: ({ id, team }: { id: number; team: string }) => setAppTeam(id, team),
    onSuccess: invalidate,
  })
  const store = useMutation({
    mutationFn: ({ id, extra, url }: { id: number; extra: AppRow['extra']; url: string }) =>
      setAppStoreUrl(id, extra, url),
    onSuccess: invalidate,
  })

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (q.data ?? [])
      .filter((a) => !teamFilter || (teamFilter === '__none__' ? !a.team : a.team === teamFilter))
      .filter((a) => !platformFilter || (a.platform ?? 'android') === platformFilter)
      .filter((a) => (a.is_hidden ? avail.hidden : avail.active))
      .filter((a) => {
        if (!adsFilter) return true
        const scanned = !!a.integration?.checked_at
        if (adsFilter === 'unscanned') return !scanned
        return scanned && (a.integration?.ads?.status ?? 'none') === adsFilter
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
      if (sort === 'created') return b.created_at.localeCompare(a.created_at)
      return appLastUpdate(b).localeCompare(appLastUpdate(a))
    })
  }, [q.data, search, sort, teamFilter, platformFilter, avail, adsFilter])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />

  return (
    <div>
      <h1 className="text-lg">Quản lý app</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Xem run, blueprint, lessons của từng app; ẩn/hiện app khỏi danh mục sản phẩm của user thường.
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
          <option value="last_update">Sắp xếp: last update ↓</option>
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
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Platform: tất cả</option>
          <option value="android">🤖 Android</option>
          <option value="ios"> iOS</option>
        </select>
        <span className="flex items-center gap-3 rounded border border-neutral-300 px-2.5 py-1.5 text-sm dark:border-neutral-700">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={avail.active}
              onChange={(e) => setAvail((v) => ({ ...v, active: e.target.checked }))}
            />
            Đang kinh doanh
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={avail.hidden}
              onChange={(e) => setAvail((v) => ({ ...v, hidden: e.target.checked }))}
            />
            Ngừng kinh doanh
          </label>
        </span>
        <select
          value={adsFilter}
          onChange={(e) => setAdsFilter(e.target.value)}
          className="rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Ads: tất cả</option>
          <option value="full">Ads: full</option>
          <option value="funnel">Ads: chỉ funnel</option>
          <option value="none">Ads: chưa tích hợp</option>
          <option value="unscanned">Ads: chưa quét</option>
        </select>
        <span className="text-xs text-neutral-500">
          {rows.length}/{q.data?.length ?? 0} app
        </span>
      </div>

      {(hide.error || team.error) && (
        <div className="mt-3">
          <ErrorBox error={hide.error || team.error} />
        </div>
      )}

      <div className="mt-4">
        {!rows.length ? (
          <Empty>{search ? 'Không app nào khớp tìm kiếm.' : 'Chưa có app nào.'}</Empty>
        ) : (
          <Table
            head={['Code', 'App', 'Family', 'Store (golive)', 'Platform', 'Funnel', 'Host ads', 'ASO', 'Legal', 'Landing', 'Git', 'Team', 'Package', 'Nguồn', 'Runs', 'Blueprints', 'Tạo lúc', 'Last update', 'Ẩn']}
          >
            {rows.map((a) => {
              const bp = blueprintRuns(a).length
              return (
                <Row key={a.id} onClick={() => navigate(`/manage-apps/${a.id}`)}>
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
                      {a.is_hidden && <Badge tone="warn">ẩn</Badge>}
                    </span>
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
                  <Cell>
                    <StoreLinkCell
                      app={a}
                      pending={store.isPending}
                      onSave={(url) => store.mutate({ id: a.id, extra: a.extra, url })}
                    />
                  </Cell>
                  <Cell>
                    {(a.platform ?? 'android') === 'ios'
                      ? <Badge> iOS</Badge>
                      : <Badge tone="good">🤖 Android</Badge>}
                  </Cell>
                  <Cell><FunnelCell integ={a.integration} /></Cell>
                  <Cell><HostCell integ={a.integration} /></Cell>
                  <Cell><AsoCell integ={a.integration} /></Cell>
                  <Cell><LegalCell integ={a.integration} /></Cell>
                  <Cell><LandingCell integ={a.integration} /></Cell>
                  <Cell><GitCell integ={a.integration} /></Cell>
                  <Cell>
                    <select
                      value={a.team ?? ''}
                      disabled={team.isPending}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => team.mutate({ id: a.id, team: e.target.value })}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <option value="">—</option>
                      {TEAMS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </Cell>
                  <Cell>
                    <PackageName app={a} />
                  </Cell>
                  <Cell>
                    <Mono className="text-neutral-500">{a.source_kind}</Mono>
                  </Cell>
                  <Cell>{a.runs.length}</Cell>
                  <Cell>
                    {bp > 0 ? <Badge tone="good">{bp}</Badge> : <span className="text-neutral-400">0</span>}
                  </Cell>
                  <Cell className="text-neutral-500">{localTime(a.created_at)}</Cell>
                  <Cell className="text-neutral-500">{localTime(appLastUpdate(a))}</Cell>
                  <Cell>
                    <button
                      disabled={hide.isPending}
                      onClick={(e) => {
                        e.stopPropagation()
                        hide.mutate({ id: a.id, hidden: !a.is_hidden })
                      }}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                    >
                      {a.is_hidden ? 'Hiện' : 'Ẩn'}
                    </button>
                  </Cell>
                </Row>
              )
            })}
          </Table>
        )}
      </div>
    </div>
  )
}

/** Ô nhập link golive (store_url). Bấm/blur đổi giá trị → lưu vào apps.extra.
 *  placeholder gợi ý URL Play suy từ packageName. stopPropagation để không mở trang chi tiết. */
function StoreLinkCell({
  app,
  pending,
  onSave,
}: {
  app: AppRow
  pending: boolean
  onSave: (url: string) => void
}) {
  const current = app.extra?.store_url ?? ''
  const [val, setVal] = useState(current)
  const pkg = app.integration?.applicationId || app.package_name || ''
  const derived = pkg ? `https://play.google.com/store/apps/details?id=${pkg}` : ''
  const commit = () => {
    if (val.trim() !== current) onSave(val)
  }
  return (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        value={val}
        disabled={pending}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        placeholder={derived ? 'golive… (auto theo package)' : 'link golive…'}
        title={derived ? `Bỏ trống → auto thử: ${derived}` : 'Dán link Play golive'}
        className="w-40 rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-xs outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
      />
      {(current || derived) && (
        <a
          href={current || derived}
          target="_blank"
          rel="noreferrer"
          title="Mở trang Play"
          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          ↗
        </a>
      )}
    </span>
  )
}
