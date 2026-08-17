import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { appDetail, appLearning, appNewLessons } from '../lib/queries'
import { appCodeOf } from '../lib/types'
import type { AppRow, RunLearningRow } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import { AppIcon, PackageName, appLastUpdate, blueprintRuns as blueprintRunsOf } from '../components/appMeta'

/** Hồ sơ MỘT app: mọi run, blueprint của từng run, lessons quá khứ đã áp vào
 *  (prefetch + phán quyết, gom cross-run) và lessons app này sinh ra mới.
 *  Toàn bộ đọc từ bảng/view sẵn có — trang này không cần schema mới. */
export default function AppDetail() {
  const id = Number(useParams().id)
  const q = useQuery({ queryKey: ['app', id], queryFn: () => appDetail(id) })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data) return <Empty>Không thấy app này.</Empty>

  return <Detail app={q.data} />
}

function Detail({ app }: { app: AppRow }) {
  const runIds = useMemo(() => app.runs.map((r) => r.id), [app])
  const learning = useQuery({
    queryKey: ['app-learning', app.id],
    queryFn: () => appLearning(runIds),
  })
  const fresh = useQuery({
    queryKey: ['app-new-lessons', app.id],
    queryFn: () => appNewLessons(runIds),
  })
  const runName = useMemo(
    () => new Map(app.runs.map((r) => [r.id, r.run_name ?? `#${r.id}`])),
    [app],
  )

  const blueprintRuns = blueprintRunsOf(app)

  return (
    <div>
      <Link to="/apps" className="text-sm text-neutral-500 underline underline-offset-2">
        ← Apps
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <AppIcon app={app} size={48} />
        <div>
          <h1 className="flex items-center gap-2 text-lg">
            {appCodeOf(app) && (
              <Mono className="rounded bg-neutral-200 px-1.5 py-0.5 text-sm font-semibold dark:bg-neutral-800">
                {appCodeOf(app)}
              </Mono>
            )}
            {app.name}
          </h1>
          <div className="flex flex-wrap gap-2 text-sm text-neutral-500">
            <PackageName app={app} />
            <span>·</span>
            <Mono>{app.source_kind}</Mono>
            <span>·</span>
            <span>tạo {localTime(app.created_at)}</span>
            <span>·</span>
            <span>last update {localTime(appLastUpdate(app))}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-8">
        <section>
          <h2 className="text-sm font-medium text-neutral-500">Runs ({app.runs.length})</h2>
          {!app.runs.length ? (
            <Empty>App này chưa có run nào.</Empty>
          ) : (
            <div className="mt-2">
              <Table head={['Run', 'Job', 'af_version', 'Trạng thái', 'Blueprint', 'Bắt đầu']}>
                {app.runs.map((r) => (
                  <Row key={r.id}>
                    <Cell>
                      <Link to={`/runs/${r.id}`} className="underline underline-offset-2">
                        <Mono>{r.run_name ?? `#${r.id}`}</Mono>
                      </Link>
                    </Cell>
                    <Cell>
                      <Mono className="text-neutral-500">{r.job_kind}</Mono>
                    </Cell>
                    <Cell>
                      <Mono>{r.af_version ?? '—'}</Mono>
                    </Cell>
                    <Cell>
                      {r.status === 'completed' ? (
                        <Badge tone="good">completed</Badge>
                      ) : r.status === 'failed' ? (
                        <Badge tone="bad">failed</Badge>
                      ) : (
                        <Badge>{r.status}</Badge>
                      )}
                    </Cell>
                    <Cell>
                      {typeof r.extra?.blueprint_run === 'string' ? (
                        <Link
                          to={`/runs/${r.id}?tab=blueprint`}
                          className="underline underline-offset-2"
                        >
                          xem
                        </Link>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </Cell>
                    <Cell className="text-neutral-500">{localTime(r.started_at)}</Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-500">
            Blueprints ({blueprintRuns.length})
          </h2>
          {!blueprintRuns.length ? (
            <p className="mt-1 text-sm text-neutral-500">
              (chưa run nào push blueprint — <Mono>af_db blueprint-push</Mono> ở cuối phase06)
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {blueprintRuns.map((r) => (
                <div key={r.id} className="text-sm">
                  <Link to={`/runs/${r.id}?tab=blueprint`} className="underline underline-offset-2">
                    <Mono>{String(r.extra?.blueprint_run)}</Mono>
                  </Link>{' '}
                  <span className="text-xs text-neutral-500">({localTime(r.started_at)})</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <LearningSections
          learning={learning.data}
          learningError={learning.error}
          learningLoading={learning.isLoading}
          freshRows={fresh.data}
          freshError={fresh.error}
          runName={runName}
        />
      </div>
    </div>
  )
}

/** Gom (run × lesson) của MỌI run thành theo-LESSON: một lesson bơm vào 3 run của
 *  app thì hiện MỘT dòng với 3 phán quyết — đúng câu hỏi "app này đã học gì từ quá khứ". */
function LearningSections({
  learning,
  learningError,
  learningLoading,
  freshRows,
  freshError,
  runName,
}: {
  learning: RunLearningRow[] | undefined
  learningError: unknown
  learningLoading: boolean
  freshRows: import('../lib/types').AppNewLesson[] | undefined
  freshError: unknown
  runName: Map<number, string>
}) {
  const byLesson = useMemo(() => {
    const m = new Map<number, RunLearningRow[]>()
    for (const row of learning ?? []) {
      const arr = m.get(row.lesson_id) ?? []
      arr.push(row)
      m.set(row.lesson_id, arr)
    }
    return [...m.entries()]
  }, [learning])

  if (learningLoading) return <Loading />
  const err = learningError || freshError
  if (err) return <ErrorBox error={err} />

  return (
    <>
      <section>
        <h2 className="text-sm font-medium text-neutral-500">
          Lessons quá khứ đã áp vào app ({byLesson.length})
        </h2>
        {!byLesson.length ? (
          <p className="mt-1 text-sm text-neutral-500">
            (chưa có retrieval nào — run trước v3.8, hoặc prefetch chưa chạy)
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {byLesson.map(([lessonId, rows]) => (
              <div key={lessonId} className="text-sm">
                <Mono className="text-neutral-500">#{lessonId}</Mono> {rows[0].title}{' '}
                <span className="text-xs text-neutral-400">
                  (<Mono className="text-xs">{rows[0].slug}</Mono>)
                </span>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                  {rows.map((r) => (
                    <span key={r.run_id}>
                      <DispositionBadge d={r.disposition} />{' '}
                      <Mono className="text-xs">{runName.get(r.run_id) ?? `#${r.run_id}`}</Mono>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">
          Lessons app này sinh ra mới ({freshRows?.length ?? 0})
        </h2>
        {!(freshRows ?? []).length ? (
          <p className="mt-1 text-sm text-neutral-500">(không có)</p>
        ) : (
          <div className="mt-2 space-y-1">
            {(freshRows ?? []).map((o) => (
              <div key={`${o.run_id}-${o.lesson_id}`} className="text-sm">
                <Mono className="text-neutral-500">#{o.lesson_id}</Mono> {o.lessons?.title ?? '—'}{' '}
                {o.lessons && <Badge>{o.lessons.status}</Badge>}
                <span className="ml-1 text-xs text-neutral-400">
                  từ <Mono className="text-xs">{o.run_id ? (runName.get(o.run_id) ?? `#${o.run_id}`) : '—'}</Mono>
                </span>
                {o.note && <div className="text-xs text-neutral-500">{o.note}</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function DispositionBadge({ d }: { d: RunLearningRow['disposition'] }) {
  return d === 'applied_prevented' ? (
    <Badge tone="good">applied</Badge>
  ) : d === 'contradicted' ? (
    <Badge tone="bad">contradicted</Badge>
  ) : d === 'not_relevant' ? (
    <Badge>not relevant</Badge>
  ) : (
    <Badge tone="warn">MISSING</Badge>
  )
}
