import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Filter,
  GitBranch,
  LayoutDashboard,
  Pencil,
  SlidersHorizontal,
} from 'lucide-react'
import { appsWithRuns, saveAppMeta, setAppHidden, setAppTeam, storeOptionsFull } from '../lib/queries'
import { EditAppMeta, type MetaPatch } from '../components/EditAppMeta'
import { appCodeOf, TEAMS, type AppRow } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import { AppIcon, AppNameLabel, PackageName, appLastUpdate, blueprintRuns } from '../components/appMeta'
import { FunnelCell, HostCell, AsoCell, LegalCell, LandingCell, GitCell } from '../components/Integration'

type SortKey = 'last_update' | 'created' | 'name' | 'code'

/** Một cột của bảng quản lý app — id ổn định (dùng cho show/hide/order), label hiển thị,
 *  render dựng nội dung ô từ một AppRow. */
type Col = { id: string; label: string; render: (a: AppRow) => React.ReactNode }

type ColPref = { id: string; visible: boolean }
const COLS_KEY = 'manage-apps-columns'

/** Filter theo TỪNG cột. `text` = contains, case-insensitive trên giá trị text của cột.
 *  `select` = khớp chính xác qua predicate. Cột không có trong map = không lọc được
 *  (icon/ngày/số) → hàng filter để trống ô đó. Key = Col.id. */
type ColFilterSpec =
  | { kind: 'text'; get: (a: AppRow) => string }
  | { kind: 'select'; options: { value: string; label: string }[]; match: (a: AppRow, v: string) => boolean }

const isScanned = (a: AppRow) => !!a.integration?.checked_at
const adsStatusOf = (a: AppRow) => a.integration?.ads?.status ?? 'none'
const hostOnOf = (a: AppRow) => {
  const ads = a.integration?.ads
  return adsStatusOf(a) === 'full' || !!ads?.host_wired || ads?.host === 'true' || ads?.adsMode === 'FULL'
}

const COL_FILTERS: Record<string, ColFilterSpec> = {
  code: { kind: 'text', get: (a) => appCodeOf(a) ?? '' },
  app: { kind: 'text', get: (a) => a.name },
  family: { kind: 'text', get: (a) => a.family_code ?? '' },
  package: { kind: 'text', get: (a) => a.package_name ?? '' },
  source: { kind: 'text', get: (a) => `${a.extra?.source_url ?? ''} ${a.extra?.source_desc ?? ''}` },
  platform: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'android', label: '🤖 Android' },
      { value: 'ios', label: ' iOS' },
    ],
    match: (a, v) => (a.platform ?? 'android') === v,
  },
  team: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      ...TEAMS.map((t) => ({ value: t, label: t })),
      { value: '__none__', label: '(chưa gán)' },
    ],
    match: (a, v) => (v === '__none__' ? !a.team : a.team === v),
  },
  golive: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'yes', label: 'đã go-live' },
      { value: 'no', label: 'chưa' },
    ],
    match: (a, v) => (v === 'yes' ? !!a.go_live : !a.go_live),
  },
  funnel: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'full', label: 'full' },
      { value: 'funnel', label: 'chỉ funnel' },
      { value: 'none', label: 'chưa' },
      { value: 'unscanned', label: 'chưa quét' },
    ],
    match: (a, v) => (v === 'unscanned' ? !isScanned(a) : isScanned(a) && adsStatusOf(a) === v),
  },
  hostAds: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'on', label: '🟢 Có' },
      { value: 'off', label: 'Tắt' },
    ],
    match: (a, v) => (v === 'on' ? hostOnOf(a) : !hostOnOf(a)),
  },
  aso: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'yes', label: 'có ASO' },
      { value: 'no', label: 'chưa' },
    ],
    match: (a, v) => (v === 'yes' ? !!a.integration?.aso : !a.integration?.aso),
  },
  legal: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'none', label: 'none' },
      { value: 'built', label: 'built' },
      { value: 'staged', label: 'staged' },
      { value: 'live', label: 'live' },
    ],
    match: (a, v) => (a.integration?.legal ?? 'none') === v,
  },
  landing: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'none', label: 'chưa' },
      { value: 'built', label: 'built' },
      { value: 'live', label: 'live' },
    ],
    match: (a, v) => (v === 'none' ? !a.integration?.landing : a.integration?.landing === v),
  },
  hidden: {
    kind: 'select',
    options: [
      { value: '', label: 'tất cả' },
      { value: 'shown', label: 'đang hiện' },
      { value: 'hidden', label: 'đã ẩn' },
    ],
    match: (a, v) => (v === 'hidden' ? !!a.is_hidden : !a.is_hidden),
  },
}

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
  const [editApp, setEditApp] = useState<AppRow | null>(null)
  const [colPanelOpen, setColPanelOpen] = useState(false)
  // Filter theo từng cột (per Col.id). Ô trống bị gỡ khỏi object để đếm "đang lọc" dễ.
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const setColFilter = (id: string, v: string) =>
    setColFilters((f) => {
      if (!v) {
        const { [id]: _drop, ...rest } = f
        return rest
      }
      return { ...f, [id]: v }
    })
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
  const stores = useQuery({ queryKey: ['v_stores', 'full'], queryFn: storeOptionsFull })
  const meta = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: MetaPatch }) => saveAppMeta(id, patch),
    onSuccess: () => {
      invalidate()
      setEditApp(null)
    },
  })

  // ─── Định nghĩa TẤT CẢ cột (render đóng trên các mutation/handler ở trên) ──
  const columns: Col[] = [
    {
      id: 'code',
      label: 'Code',
      render: (a) =>
        appCodeOf(a) ? (
          <Mono className="font-semibold">{appCodeOf(a)}</Mono>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
    },
    {
      id: 'app',
      label: 'App',
      render: (a) => (
        <span className="flex items-center gap-2.5 underline underline-offset-2">
          <AppIcon app={a} size={32} />
          <AppNameLabel app={a} />
          {a.is_hidden && <Badge tone="warn">ẩn</Badge>}
        </span>
      ),
    },
    {
      id: 'family',
      label: 'Family',
      render: (a) =>
        a.family_code ? (
          <span className="flex items-center gap-1.5">
            <Mono>{a.family_code}</Mono>
            <Badge tone={a.family_role === 'master' ? 'good' : undefined}>
              {a.family_role === 'master' ? 'master' : `#${a.family_seq ?? '?'}`}
            </Badge>
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
    },
    {
      id: 'golive',
      label: 'Go-live',
      render: (a) => {
        const icon = (
          <ArrowUpRight
            className={`h-4 w-4 ${
              a.go_live
                ? 'text-green-600 dark:text-green-400'
                : 'text-neutral-300 dark:text-neutral-700'
            }`}
          />
        )
        const title = a.go_live ? 'đã go-live' : 'chưa go-live'
        const url = a.extra?.store_url
        return url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title={`${title} — mở Play`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex"
          >
            {icon}
          </a>
        ) : (
          <span title={title} className="inline-flex">
            {icon}
          </span>
        )
      },
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      render: (a) =>
        a.extra?.dashboard_url ? (
          <a
            href={a.extra.dashboard_url}
            target="_blank"
            rel="noreferrer"
            title="Mở dashboard"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex"
          >
            <LayoutDashboard className="h-4 w-4 text-primary-600" />
          </a>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
    },
    {
      id: 'meta',
      label: 'Metadata',
      render: (a) => (
        <span className="flex items-center gap-1.5">
          <span className={a.extra?.discord_channel ? '' : 'text-neutral-400'}>
            {a.extra?.discord_channel ?? '—'}
          </span>
          <button
            title="Sửa metadata"
            onClick={(e) => {
              e.stopPropagation()
              setEditApp(a)
            }}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </span>
      ),
    },
    {
      id: 'platform',
      label: 'Platform',
      render: (a) =>
        (a.platform ?? 'android') === 'ios' ? (
          <Badge> iOS</Badge>
        ) : (
          <Badge tone="good">🤖 Android</Badge>
        ),
    },
    { id: 'funnel', label: 'Funnel', render: (a) => <FunnelCell integ={a.integration} /> },
    { id: 'hostAds', label: 'Host ads', render: (a) => <HostCell integ={a.integration} /> },
    { id: 'aso', label: 'ASO', render: (a) => <AsoCell integ={a.integration} /> },
    { id: 'legal', label: 'Legal', render: (a) => <LegalCell integ={a.integration} /> },
    { id: 'landing', label: 'Landing', render: (a) => <LandingCell integ={a.integration} /> },
    { id: 'git', label: 'Git', render: (a) => <GitCell integ={a.integration} /> },
    {
      id: 'team',
      label: 'Team',
      render: (a) => (
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
      ),
    },
    { id: 'package', label: 'Package', render: (a) => <PackageName app={a} /> },
    {
      id: 'source',
      label: 'Nguồn',
      render: (a) => {
        const url = a.extra?.source_url
        const desc = a.extra?.source_desc
        if (url) {
          return (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title={desc || url}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex"
            >
              <GitBranch className="h-4 w-4 text-green-600 dark:text-green-400" />
            </a>
          )
        }
        if (desc) {
          return (
            <span title={desc} className="inline-flex">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
            </span>
          )
        }
        return <span className="text-neutral-400">—</span>
      },
    },
    { id: 'runs', label: 'Runs', render: (a) => a.runs.length },
    {
      id: 'blueprints',
      label: 'Blueprints',
      render: (a) => {
        const bp = blueprintRuns(a).length
        return bp > 0 ? <Badge tone="good">{bp}</Badge> : <span className="text-neutral-400">0</span>
      },
    },
    {
      id: 'created',
      label: 'Tạo lúc',
      render: (a) => <span className="text-neutral-500">{localTime(a.created_at)}</span>,
    },
    {
      id: 'lastUpdate',
      label: 'Last update',
      render: (a) => <span className="text-neutral-500">{localTime(appLastUpdate(a))}</span>,
    },
    {
      id: 'hidden',
      label: 'Ẩn',
      render: (a) => (
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
      ),
    },
  ]
  const idKey = columns.map((c) => c.id).join(',')

  // ─── Cột show/hide/order: khởi từ localStorage, MERGE với cột hiện có ──────
  const [colPrefs, setColPrefs] = useState<ColPref[]>(() => {
    try {
      const s = localStorage.getItem(COLS_KEY)
      if (s) return JSON.parse(s)
    } catch { /* blocked */ }
    return []
  })
  // Đồng bộ prefs với tập cột hiện có: cột mới (chưa có prefs) → append visible, bỏ id không còn.
  useEffect(() => {
    const ids = idKey ? idKey.split(',') : []
    setColPrefs((prev) => {
      const known = new Set(prev.map((p) => p.id))
      const kept = prev.filter((p) => ids.includes(p.id))
      const appended = ids.filter((id) => !known.has(id)).map((id) => ({ id, visible: true }))
      const next = [...kept, ...appended]
      // Chỉ set khi thực sự đổi (tránh loop).
      if (next.length === prev.length && next.every((p, i) => prev[i]?.id === p.id && prev[i]?.visible === p.visible)) {
        return prev
      }
      return next
    })
  }, [idKey])
  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(colPrefs))
    } catch { /* ignore */ }
  }, [colPrefs])

  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [idKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibleCols = colPrefs
    .filter((p) => p.visible)
    .map((p) => byId.get(p.id))
    .filter((c): c is Col => !!c)

  const toggleCol = (id: string) =>
    setColPrefs((prev) => prev.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)))
  const moveCol = (idx: number, dir: -1 | 1) =>
    setColPrefs((prev) => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })

  // Control filter cho một cột (null = cột không lọc được → ô trống trong hàng filter).
  const colFilterControl = (id: string): React.ReactNode => {
    const spec = COL_FILTERS[id]
    if (!spec) return null
    const val = colFilters[id] ?? ''
    const cls =
      'w-full min-w-[72px] rounded border border-neutral-300 bg-transparent px-1.5 py-1 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-400'
    if (spec.kind === 'text') {
      return (
        <input
          value={val}
          placeholder="lọc…"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setColFilter(id, e.target.value)}
          className={cls}
        />
      )
    }
    return (
      <select
        value={val}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setColFilter(id, e.target.value)}
        className={cls}
      >
        {spec.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

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
      // Filter theo từng cột (AND với nhau + với global search ở trên).
      .filter((a) =>
        Object.entries(colFilters).every(([id, raw]) => {
          const val = (raw ?? '').trim()
          if (!val) return true
          const spec = COL_FILTERS[id]
          if (!spec) return true
          return spec.kind === 'text'
            ? spec.get(a).toLowerCase().includes(val.toLowerCase())
            : spec.match(a, val)
        }),
      )
    return [...filtered].sort((a, b) => {
      if (sort === 'code') return (appCodeOf(b) ?? '').localeCompare(appCodeOf(a) ?? '')
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'created') return b.created_at.localeCompare(a.created_at)
      return appLastUpdate(b).localeCompare(appLastUpdate(a))
    })
  }, [q.data, search, sort, teamFilter, platformFilter, avail, adsFilter, colFilters])

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
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          title="Bật/tắt hàng filter theo từng cột"
          className={`flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
            filtersOpen || Object.keys(colFilters).length
              ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-500 dark:bg-primary-950 dark:text-primary-300'
              : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900'
          }`}
        >
          <Filter className="h-4 w-4" />
          Lọc cột
          {Object.keys(colFilters).length > 0 && (
            <span className="ml-0.5 rounded-full bg-primary-600 px-1.5 text-[10px] text-white">
              {Object.keys(colFilters).length}
            </span>
          )}
        </button>
        {Object.keys(colFilters).length > 0 && (
          <button
            onClick={() => setColFilters({})}
            title="Xoá tất cả filter theo cột (giữ global search)"
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Xoá lọc
          </button>
        )}
        <div className="relative">
          <button
            onClick={() => setColPanelOpen((v) => !v)}
            title="Quản lý cột (show/hide/thứ tự)"
            className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Cột
          </button>
          {colPanelOpen && (
            <ColumnPanel
              prefs={colPrefs}
              byId={byId}
              onToggle={toggleCol}
              onMove={moveCol}
              onClose={() => setColPanelOpen(false)}
            />
          )}
        </div>
        <span className="text-xs text-neutral-500">
          {rows.length}/{q.data?.length ?? 0} app
        </span>
      </div>

      {(hide.error || team.error || meta.error) && (
        <div className="mt-3">
          <ErrorBox error={hide.error || team.error || meta.error} />
        </div>
      )}

      <div className="mt-4">
        {!rows.length ? (
          <Empty>{search ? 'Không app nào khớp tìm kiếm.' : 'Chưa có app nào.'}</Empty>
        ) : (
          <Table
            head={visibleCols.map((c) => c.label)}
            filterRow={filtersOpen ? visibleCols.map((c) => colFilterControl(c.id)) : undefined}
          >
            {rows.map((a) => (
              <Row key={a.id} onClick={() => navigate(`/manage-apps/${a.id}`)}>
                {visibleCols.map((c) => (
                  <Cell key={c.id}>{c.render(a)}</Cell>
                ))}
              </Row>
            ))}
          </Table>
        )}
      </div>

      {editApp && (
        <EditAppMeta
          app={editApp}
          stores={stores.data ?? []}
          pending={meta.isPending}
          onClose={() => setEditApp(null)}
          onSave={(patch) => meta.mutate({ id: editApp.id, patch })}
        />
      )}
    </div>
  )
}

/** Popover quản lý cột — mỗi cột 1 checkbox (show/hide) + ↑/↓ đổi thứ tự. */
function ColumnPanel({
  prefs,
  byId,
  onToggle,
  onMove,
  onClose,
}: {
  prefs: ColPref[]
  byId: Map<string, Col>
  onToggle: (id: string) => void
  onMove: (idx: number, dir: -1 | 1) => void
  onClose: () => void
}) {
  return (
    <>
      {/* bắt click ngoài để đóng */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 z-50 mt-1 max-h-96 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
        <div className="px-1 pb-1 text-xs font-medium text-neutral-500">Cột hiển thị &amp; thứ tự</div>
        {prefs.map((p, i) => {
          const col = byId.get(p.id)
          if (!col) return null
          return (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={p.visible} onChange={() => onToggle(p.id)} />
                {col.label}
              </label>
              <span className="flex items-center">
                <button
                  disabled={i === 0}
                  onClick={() => onMove(i, -1)}
                  title="Lên"
                  className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  disabled={i === prefs.length - 1}
                  onClick={() => onMove(i, 1)}
                  title="Xuống"
                  className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
