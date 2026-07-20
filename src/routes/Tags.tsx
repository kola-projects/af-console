import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { approveTag, mergeTag, tags } from '../lib/queries'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table } from '../components/ui'

/** Chống loạn từ vựng. Không có màn này thì sau ~20 build sẽ có compose /
 *  jetpack-compose là hai tag khác nhau và cả kho tra cứu mất giá trị. */
export default function Tags() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['tags'], queryFn: tags })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tags'] })
  const approve = useMutation({ mutationFn: approveTag, onSuccess: invalidate })
  const merge = useMutation({
    mutationFn: ({ id, into }: { id: number; into: number }) => mergeTag(id, into),
    onSuccess: invalidate,
  })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length) return <Empty>Chưa có tag nào.</Empty>

  const live = q.data.filter((t) => t.status !== 'merged')
  const newOnes = live.filter((t) => t.status === 'new')

  return (
    <div>
      <h1 className="text-lg">Tags</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {newOnes.length > 0
          ? `${newOnes.length} tag mới do agent tự đặt, chờ duyệt hoặc gộp.`
          : 'Không có tag mới nào chờ duyệt.'}
      </p>

      <div className="mt-4">
        <Table head={['Tag', 'Loại', 'Trạng thái', '']}>
          {live.map((t) => (
            <Row key={t.id}>
              <Cell>
                <Mono>{t.name}</Mono>
              </Cell>
              <Cell className="text-neutral-500">{t.kind ?? '—'}</Cell>
              <Cell>
                {t.status === 'new' ? <Badge tone="warn">mới</Badge> : <Badge tone="good">ok</Badge>}
              </Cell>
              <Cell>
                {t.status === 'new' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => approve.mutate(t.id)}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
                    >
                      Giữ
                    </button>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const into = Number(e.target.value)
                        if (into) merge.mutate({ id: t.id, into })
                      }}
                      className="rounded border border-neutral-300 px-1 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <option value="">gộp vào…</option>
                      {live
                        .filter((o) => o.id !== t.id && o.status === 'ok')
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </Cell>
            </Row>
          ))}
        </Table>
      </div>
    </div>
  )
}
