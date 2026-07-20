import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveLesson,
  lessonsDead,
  lessonsHot,
  promotionCandidates,
  rejectLesson,
} from '../lib/queries'
import { GRADUATION_TARGETS, type LessonHot, type PromotionCandidate } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table } from '../components/ui'

type Tab = 'queue' | 'all' | 'dead'

export default function Lessons() {
  const [tab, setTab] = useState<Tab>('queue')
  const qc = useQueryClient()

  const queue = useQuery({ queryKey: ['promotion'], queryFn: promotionCandidates })
  const all = useQuery({ queryKey: ['lessons-hot'], queryFn: lessonsHot, enabled: tab !== 'queue' })
  const dead = useQuery({ queryKey: ['lessons-dead'], queryFn: lessonsDead, enabled: tab === 'dead' })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['promotion'] })
    qc.invalidateQueries({ queryKey: ['lessons-hot'] })
  }
  const approve = useMutation({
    mutationFn: ({ id, target }: { id: number; target: string }) => approveLesson(id, target),
    onSuccess: invalidate,
  })
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectLesson(id, reason),
    onSuccess: invalidate,
  })

  return (
    <div>
      <h1 className="text-lg">Lessons</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Duyệt ở đây chỉ <em>đánh dấu</em>. Việc sửa file trong <Mono>instructions/</Mono> và commit do{' '}
        <Mono>af_db graduate</Mono> làm — không có bước đó thì DB nói đã tốt nghiệp mà file chưa hề đổi.
      </p>

      <div className="mt-4 flex gap-1 text-sm">
        {(
          [
            ['queue', `Chờ duyệt${queue.data?.length ? ` (${queue.data.length})` : ''}`],
            ['all', 'Tất cả'],
            ['dead', 'Không ai dùng'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded px-2.5 py-1 ${
              tab === k
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'queue' &&
          (queue.isLoading ? (
            <Loading />
          ) : queue.error ? (
            <ErrorBox error={queue.error} />
          ) : !queue.data?.length ? (
            <Empty>
              Chưa lesson nào đủ ngưỡng ≥3 app distinct.
              <br />
              <span className="text-xs">Hàng đợi rỗng là trạng thái tốt — không phải lỗi.</span>
            </Empty>
          ) : (
            <div className="space-y-3">
              {queue.data.map((l) => (
                <GateCard
                  key={l.id}
                  lesson={l}
                  onApprove={(target) => approve.mutate({ id: l.id, target })}
                  onReject={(reason) => reject.mutate({ id: l.id, reason })}
                  busy={approve.isPending || reject.isPending}
                />
              ))}
            </div>
          ))}

        {tab === 'all' &&
          (all.isLoading ? (
            <Loading />
          ) : all.error ? (
            <ErrorBox error={all.error} />
          ) : (
            <AllLessons rows={all.data ?? []} />
          ))}

        {tab === 'dead' &&
          (dead.isLoading ? (
            <Loading />
          ) : dead.error ? (
            <ErrorBox error={dead.error} />
          ) : !dead.data?.length ? (
            <Empty>Chưa có lesson nào bị truy ra nhiều lần mà không ai dùng.</Empty>
          ) : (
            <>
              <p className="mb-3 text-sm text-neutral-500">
                Bị truy ra ≥5 lần mà <strong>chưa lần nào</strong> được dùng. Đây là rác đang bơm vào
                context mỗi phase — cân nhắc chuyển sang <Mono>rejected</Mono>.
              </p>
              <Table head={['Lesson', 'Truy ra', 'Được dùng', 'Lần cuối']}>
                {dead.data.map((d) => (
                  <Row key={d.id}>
                    <Cell>
                      <div>{d.title}</div>
                      <Mono className="text-neutral-500">{d.slug}</Mono>
                    </Cell>
                    <Cell>{d.times_retrieved}</Cell>
                    <Cell className="text-red-700 dark:text-red-300">{d.times_used}</Cell>
                    <Cell className="text-neutral-500">
                      {d.last_retrieved_at?.slice(0, 10) ?? '—'}
                    </Cell>
                  </Row>
                ))}
              </Table>
            </>
          ))}
      </div>
    </div>
  )
}

function GateCard({
  lesson,
  onApprove,
  onReject,
  busy,
}: {
  lesson: PromotionCandidate
  onApprove: (target: string) => void
  onReject: (reason: string) => void
  busy: boolean
}) {
  const [target, setTarget] = useState<string>(GRADUATION_TARGETS[0])
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <div className="rounded-xl border border-neutral-200 px-5 py-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="good">{lesson.distinct_apps} app distinct</Badge>
        {lesson.prevented_count > 0 && (
          <Badge tone="good">đã cứu build {lesson.prevented_count}×</Badge>
        )}
        {lesson.recurred_count > 0 && <Badge>gặp lại {lesson.recurred_count}×</Badge>}
        {lesson.supporting_evidence > 0 && (
          <Badge tone="warn">+{lesson.supporting_evidence} bằng chứng hỗ trợ</Badge>
        )}
        <Mono className="ml-auto text-neutral-500">scope: {lesson.scope ?? '—'}</Mono>
      </div>

      <div className="mt-2 text-[15px]">{lesson.title}</div>
      <Mono className="text-neutral-500">{lesson.slug}</Mono>

      {!rejecting ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            {GRADUATION_TARGETS.map((t) => (
              <option key={t} value={t}>
                {t.replace('instructions/', '')}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() => onApprove(target)}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Duyệt lên skills
          </button>
          <button
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700"
          >
            Từ chối
          </button>
          <span className="text-xs text-neutral-500">
            Duyệt xong chạy <Mono>./tools/af_db.sh graduate</Mono>
          </span>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Vì sao không nên thành luật?"
            className="min-w-64 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            disabled={busy || !reason.trim()}
            onClick={() => onReject(reason.trim())}
            className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Xác nhận từ chối
          </button>
          <button
            onClick={() => setRejecting(false)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          >
            Huỷ
          </button>
        </div>
      )}
    </div>
  )
}

function AllLessons({ rows }: { rows: LessonHot[] }) {
  if (!rows.length) return <Empty>Kho lessons còn trống.</Empty>
  return (
    <Table head={['Lesson', 'Trạng thái', 'App', 'Cứu build', 'Gặp lại', 'Trust']}>
      {rows.map((l) => (
        <Row key={l.id}>
          <Cell>
            <div className="flex items-center gap-2">
              {l.title}
              {!l.verified_in_our_stack && <Badge tone="warn">chưa kiểm chứng</Badge>}
            </div>
            <Mono className="text-neutral-500">{l.slug}</Mono>
          </Cell>
          <Cell>
            <Mono>{l.status}</Mono>
          </Cell>
          <Cell>{l.distinct_apps}</Cell>
          <Cell
            className={l.prevented_count > 0 ? 'text-green-700 dark:text-green-300' : undefined}
          >
            {l.prevented_count}
          </Cell>
          <Cell>{l.recurred_count}</Cell>
          <Cell className="text-neutral-500">{l.trust_level}</Cell>
        </Row>
      ))}
    </Table>
  )
}
