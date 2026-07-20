import { useQuery } from '@tanstack/react-query'
import { observationStats, retrievalStats, runHealth } from '../lib/queries'
import { Cell, Empty, ErrorBox, Loading, Mono, Row, Stat, Table } from '../components/ui'

export default function Dashboard() {
  const health = useQuery({ queryKey: ['run-health'], queryFn: runHealth })
  const retr = useQuery({ queryKey: ['retrievals'], queryFn: retrievalStats })
  const obs = useQuery({ queryKey: ['observations'], queryFn: observationStats })

  if (health.isLoading || retr.isLoading || obs.isLoading) return <Loading />
  const err = health.error || retr.error || obs.error
  if (err) return <ErrorBox error={err} />

  const rows = health.data ?? []
  const totalRuns = rows.reduce((s, r) => s + r.runs, 0)
  const totalBugs = rows.reduce((s, r) => s + r.bugs, 0)
  const prevented = obs.data?.applied_prevented ?? 0
  const recurred = obs.data?.recurred ?? 0
  const usedPct = retr.data?.total ? Math.round((retr.data.used / retr.data.total) * 100) : 0

  return (
    <div>
      <h1 className="text-lg">Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Một câu hỏi duy nhất: <strong>AF có thông minh hơn sau mỗi build không?</strong> Hai số đầu
        phải đi ngược chiều nhau — cứu build tăng, gặp lại giảm. Nếu cùng tăng thì vòng học chưa chạy,
        chỉ đang tích dữ liệu.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Lesson đã cứu build"
          value={prevented}
          hint="applied_prevented — càng tăng càng tốt"
          tone={prevented > 0 ? 'good' : undefined}
        />
        <Stat
          label="Lỗi tái diễn"
          value={recurred}
          hint="recurred — càng giảm càng tốt"
          tone={recurred > prevented ? 'bad' : undefined}
        />
        <Stat
          label="Đọc-trước có ích"
          value={`${usedPct}%`}
          hint={`${retr.data?.used ?? 0}/${retr.data?.total ?? 0} lần truy vấn được dùng`}
        />
        <Stat
          label="Bug / run"
          value={totalRuns ? (totalBugs / totalRuns).toFixed(2) : '—'}
          hint={`${totalBugs} bug qua ${totalRuns} run`}
        />
      </div>

      <h2 className="mt-8 text-sm text-neutral-500">Theo phiên bản AF</h2>
      <p className="mb-2 text-xs text-neutral-500">
        Bản kit mới có làm build tệ đi không — và cột cuối là loại lỗi đắt nhất: compile xanh, chỉ chết
        khi người dùng bấm.
      </p>
      {rows.length === 0 ? (
        <Empty>Chưa có run nào. Chạy generate rồi quay lại.</Empty>
      ) : (
        <Table
          head={['af_version', 'code_base', 'Run', 'Xong', 'Bug', 'Bug/run', 'logic_compile_ok']}
        >
          {rows.map((r, i) => (
            <Row key={i}>
              <Cell>
                <Mono>{r.af_version ?? '—'}</Mono>
              </Cell>
              <Cell>
                <Mono className="text-neutral-500">{r.code_base_version ?? '—'}</Mono>
              </Cell>
              <Cell>{r.runs}</Cell>
              <Cell>{r.completed_runs}</Cell>
              <Cell>{r.bugs}</Cell>
              <Cell>{r.bugs_per_run ?? '—'}</Cell>
              <Cell
                className={
                  r.logic_compile_ok_bugs > 0 ? 'text-red-700 dark:text-red-300' : undefined
                }
              >
                {r.logic_compile_ok_bugs}
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  )
}
