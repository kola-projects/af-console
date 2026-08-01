import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { appsWithRuns } from '../lib/queries'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import { AppIcon, PackageName, appLastUpdate, blueprintRuns } from '../components/appMeta'

type SortKey = 'last_update' | 'created' | 'name'

/** Trang Apps — lối vào theo APP thay vì theo run: một app sinh nhiều lần thì
 *  người tìm blueprint không phải mò trong danh sách run dài. */
export default function Apps() {
  const q = useQuery({ queryKey: ['apps'], queryFn: appsWithRuns })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('last_update')

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (q.data ?? []).filter(
      (a) =>
        !needle ||
        a.name.toLowerCase().includes(needle) ||
        (a.package_name ?? '').toLowerCase().includes(needle),
    )
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'created') return b.created_at.localeCompare(a.created_at)
      return appLastUpdate(b).localeCompare(appLastUpdate(a))
    })
  }, [q.data, search, sort])

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />

  return (
    <div>
      <h1 className="text-lg">Apps</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Mỗi dòng là MỘT app (xuyên nhiều lần sinh lại). Bấm vào để xem run, blueprint và
        lessons của app đó.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo tên / package…"
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
        </select>
        <span className="text-xs text-neutral-500">
          {rows.length}/{q.data?.length ?? 0} app
        </span>
      </div>

      <div className="mt-4">
        {!rows.length ? (
          <Empty>{search ? 'Không app nào khớp tìm kiếm.' : 'Chưa có app nào được ghi.'}</Empty>
        ) : (
          <Table head={['App', 'Package', 'Nguồn', 'Runs', 'Blueprints', 'Tạo lúc', 'Last update']}>
            {rows.map((a) => {
              const bp = blueprintRuns(a).length
              return (
                <Row key={a.id}>
                  <Cell>
                    <Link
                      to={`/apps/${a.id}`}
                      className="flex items-center gap-2.5 underline underline-offset-2"
                    >
                      <AppIcon app={a} size={32} />
                      {a.name}
                    </Link>
                  </Cell>
                  <Cell>
                    <PackageName app={a} />
                  </Cell>
                  <Cell>
                    <Mono className="text-neutral-500">{a.source_kind}</Mono>
                  </Cell>
                  <Cell>{a.runs.length}</Cell>
                  <Cell>{bp > 0 ? <Badge tone="good">{bp}</Badge> : <span className="text-neutral-400">0</span>}</Cell>
                  <Cell className="text-neutral-500">{localTime(a.created_at)}</Cell>
                  <Cell className="text-neutral-500">{localTime(appLastUpdate(a))}</Cell>
                </Row>
              )
            })}
          </Table>
        )}
      </div>
    </div>
  )
}
