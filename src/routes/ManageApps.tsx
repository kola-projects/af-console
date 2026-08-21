import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { appsWithRuns, setAppHidden } from '../lib/queries'
import { appCodeOf } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import { AppIcon, PackageName, appLastUpdate, blueprintRuns } from '../components/appMeta'

type SortKey = 'last_update' | 'created' | 'name' | 'code'

/** /manage-apps — QUẢN LÝ APP (admin). Đầy đủ nội bộ: runs, blueprint, last update,
 *  và ẩn/hiện app khỏi danh mục sản phẩm của user thường. */
export default function ManageApps() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['apps-manage'], queryFn: appsWithRuns })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('last_update')
  const hide = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) => setAppHidden(id, hidden),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apps-manage'] })
      qc.invalidateQueries({ queryKey: ['apps-product'] })
    },
  })

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (q.data ?? []).filter(
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
  }, [q.data, search, sort])

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
        <span className="text-xs text-neutral-500">
          {rows.length}/{q.data?.length ?? 0} app
        </span>
      </div>

      {hide.error && (
        <div className="mt-3">
          <ErrorBox error={hide.error} />
        </div>
      )}

      <div className="mt-4">
        {!rows.length ? (
          <Empty>{search ? 'Không app nào khớp tìm kiếm.' : 'Chưa có app nào.'}</Empty>
        ) : (
          <Table
            head={['Code', 'App', 'Package', 'Nguồn', 'Runs', 'Blueprints', 'Tạo lúc', 'Last update', 'Ẩn']}
          >
            {rows.map((a) => {
              const bp = blueprintRuns(a).length
              return (
                <Row key={a.id}>
                  <Cell>
                    {appCodeOf(a) ? (
                      <Mono className="font-semibold">{appCodeOf(a)}</Mono>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </Cell>
                  <Cell>
                    <Link
                      to={`/manage-apps/${a.id}`}
                      className="flex items-center gap-2.5 underline underline-offset-2"
                    >
                      <AppIcon app={a} size={32} />
                      {a.name}
                      {a.is_hidden && <Badge tone="warn">ẩn</Badge>}
                    </Link>
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
                      onClick={() => hide.mutate({ id: a.id, hidden: !a.is_hidden })}
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
