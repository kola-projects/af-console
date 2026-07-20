import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { runs } from '../lib/queries'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'

export default function Runs() {
  const q = useQuery({ queryKey: ['runs'], queryFn: runs })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length) return <Empty>Chưa có run nào được ghi.</Empty>

  return (
    <div>
      <h1 className="text-lg">Runs</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Mỗi dòng là một lần chạy job — không chỉ build: <Mono>harvest</Mono> và <Mono>research</Mono>{' '}
        sau này cũng nằm ở đây.
      </p>

      <div className="mt-4">
        <Table head={['Run', 'Job', 'App', 'af_version', 'code_base', 'Trạng thái', 'Bắt đầu']}>
          {q.data.map((r) => (
            <Row key={r.id}>
              <Cell>
                <Link to={`/runs/${r.id}`} className="underline underline-offset-2">
                  <Mono>{r.run_name ?? `#${r.id}`}</Mono>
                </Link>
              </Cell>
              <Cell>
                <Mono className="text-neutral-500">{r.job_kind}</Mono>
              </Cell>
              <Cell>{r.apps?.name ?? '—'}</Cell>
              <Cell>
                <Mono>{r.af_version ?? '—'}</Mono>
              </Cell>
              <Cell>
                <Mono className="text-neutral-500">{r.code_base_version ?? '—'}</Mono>
              </Cell>
              <Cell>
                {r.status === 'completed' ? (
                  <Badge tone="good">completed</Badge>
                ) : r.status === 'failed' ? (
                  <Badge tone="bad">failed</Badge>
                ) : (
                  <Badge>{r.status}</Badge>
                )}
                {r.status === 'completed' && !r.outbox_flushed && (
                  <span className="ml-1">
                    <Badge tone="warn">outbox chưa sạch</Badge>
                  </span>
                )}
              </Cell>
              <Cell className="text-neutral-500">{localTime(r.started_at)}</Cell>
            </Row>
          ))}
        </Table>
      </div>
    </div>
  )
}
