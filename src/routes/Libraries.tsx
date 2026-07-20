import { useQuery } from '@tanstack/react-query'
import { libraries } from '../lib/queries'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table } from '../components/ui'

/** Tính khả thi là DỮ LIỆU tích qua nhiều app, không phải ý kiến một lần. */
export default function Libraries() {
  const q = useQuery({ queryKey: ['libraries'], queryFn: libraries })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length) return <Empty>Chưa có thư viện nào được ghi nhận.</Empty>

  return (
    <div>
      <h1 className="text-lg">Libraries</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Tỉ lệ chạy được tính từ kết quả thật của từng run, không phải từ đánh giá chủ quan.
      </p>

      <div className="mt-4">
        <Table head={['Tính năng', 'Thư viện', 'Trạng thái', 'Dùng', 'OK', 'Tỉ lệ', 'Version cuối']}>
          {q.data.map((l) => (
            <Row key={l.id}>
              <Cell>{l.feature_key}</Cell>
              <Cell>
                <Mono>{l.coordinates ?? '—'}</Mono>
              </Cell>
              <Cell>
                {l.status === 'verified' ? (
                  <Badge tone="good">verified</Badge>
                ) : l.status === 'rejected' ? (
                  <Badge tone="bad">rejected</Badge>
                ) : (
                  <Badge tone="warn">directional</Badge>
                )}
              </Cell>
              <Cell>{l.total_uses}</Cell>
              <Cell>{l.ok_uses}</Cell>
              <Cell
                className={
                  l.ok_pct !== null && l.ok_pct < 100 ? 'text-amber-700 dark:text-amber-300' : ''
                }
              >
                {l.ok_pct === null ? '—' : `${l.ok_pct}%`}
              </Cell>
              <Cell>
                <Mono className="text-neutral-500">{l.last_version ?? '—'}</Mono>
              </Cell>
            </Row>
          ))}
        </Table>
      </div>
    </div>
  )
}
