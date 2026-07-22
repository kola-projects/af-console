import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { run, runBugs, runDecisions, runPhases } from '../lib/queries'
import type { Bug, Decision, Run, RunPhase } from '../lib/types'
import { Badge, CategoryBadge, Empty, ErrorBox, Loading, Mono } from '../components/ui'
import BlueprintTab from './blueprint/BlueprintTab'

type Tab = 'timeline' | 'blueprint'

/** Thay cho việc đọc AI_DECISION_LOG.md bằng mắt: timeline phase01→06, dưới mỗi
 *  phase là quyết định và lỗi thuộc về phase đó. Tab Blueprint (v3.3) đọc hồ sơ
 *  thiết kế/spec từ bảng blueprint_files. */
export default function RunDetail() {
  const id = Number(useParams().id)
  const r = useQuery({ queryKey: ['run', id], queryFn: () => run(id) })
  const [tab, setTab] = useState<Tab>('timeline')

  if (r.isLoading) return <Loading />
  if (r.error) return <ErrorBox error={r.error} />
  if (!r.data) return <Empty>Không thấy run này.</Empty>

  // Con trỏ blueprint (extra.blueprint_run = run_name đã push). Không có → không hiện tab.
  const blueprintRun =
    typeof r.data.extra?.blueprint_run === 'string' ? (r.data.extra.blueprint_run as string) : null

  return (
    <div>
      <Link to="/runs" className="text-sm text-neutral-500 underline underline-offset-2">
        ← Runs
      </Link>
      <h1 className="mt-2 text-lg">
        <Mono className="text-base">{r.data.run_name ?? `#${r.data.id}`}</Mono>
      </h1>
      <div className="mt-1 flex flex-wrap gap-2 text-sm text-neutral-500">
        <span>{r.data.apps?.name ?? '—'}</span>
        <span>·</span>
        <Mono>af {r.data.af_version ?? '—'}</Mono>
        <span>·</span>
        <Mono>code_base {r.data.code_base_version ?? '—'}</Mono>
        <span>·</span>
        <span>{r.data.host ?? '—'}</span>
      </div>

      <div className="mt-4 flex gap-1 text-sm">
        {(
          [
            ['timeline', 'Timeline'],
            ['blueprint', 'Blueprint'],
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

      <div className="mt-6">
        {tab === 'timeline' ? (
          <Timeline run={r.data} />
        ) : blueprintRun ? (
          <BlueprintTab runName={blueprintRun} />
        ) : (
          <Empty>Run này chưa push blueprint.</Empty>
        )}
      </div>
    </div>
  )
}

/** Timeline phase01→06 (nội dung tab mặc định — tách ra để tab Blueprint dùng chung khung). */
function Timeline({ run: r }: { run: Run }) {
  const phases = useQuery({ queryKey: ['run-phases', r.id], queryFn: () => runPhases(r.id) })
  const decisions = useQuery({ queryKey: ['run-decisions', r.id], queryFn: () => runDecisions(r.id) })
  const bugs = useQuery({ queryKey: ['run-bugs', r.id], queryFn: () => runBugs(r.id) })

  if (phases.isLoading) return <Loading />
  const err = phases.error || decisions.error || bugs.error
  if (err) return <ErrorBox error={err} />

  const orphanDecisions = (decisions.data ?? []).filter((d) => !d.phase_id)
  const orphanBugs = (bugs.data ?? []).filter((b) => !b.phase_id)

  return (
    <div className="space-y-4">
      {(phases.data ?? []).map((p: RunPhase) => {
        const ds = (decisions.data ?? []).filter((d) => d.phase_id === p.id)
        const bs = (bugs.data ?? []).filter((b) => b.phase_id === p.id)
        return (
          <div key={p.id} className="border-l-2 border-neutral-200 pl-4 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <Mono className="text-sm">{p.phase}</Mono>
              {p.status === 'completed' ? (
                <Badge tone="good">{p.status}</Badge>
              ) : p.status === 'failed' ? (
                <Badge tone="bad">{p.status}</Badge>
              ) : (
                <Badge>{p.status}</Badge>
              )}
            </div>
            {p.summary && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{p.summary}</p>}
            <Items decisions={ds} bugs={bs} />
          </div>
        )
      })}

      {(orphanDecisions.length > 0 || orphanBugs.length > 0) && (
        <div className="border-l-2 border-dashed border-neutral-200 pl-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Không gắn phase</div>
          <Items decisions={orphanDecisions} bugs={orphanBugs} />
        </div>
      )}

      {!phases.data?.length && !decisions.data?.length && !bugs.data?.length && (
        <Empty>Run này chưa ghi phase, quyết định hay lỗi nào.</Empty>
      )}
    </div>
  )
}

function Items({ decisions, bugs }: { decisions: Decision[]; bugs: Bug[] }) {
  return (
    <div className="mt-2 space-y-2">
      {decisions.map((d) => (
        <div key={`d${d.id}`} className="text-sm">
          <Mono className="text-neutral-500">{d.kind}</Mono> {d.title}
          {d.tradeoff && (
            <div className="text-xs text-neutral-500">đánh đổi: {d.tradeoff}</div>
          )}
          {d.revisit_if && (
            <div className="text-xs text-neutral-500">xem lại nếu: {d.revisit_if}</div>
          )}
        </div>
      ))}
      {bugs.map((b) => (
        <div key={`b${b.id}`} className="text-sm">
          <CategoryBadge category={b.category} /> {b.title}
          {b.error_signature && (
            <div>
              <Mono className="text-neutral-500">{b.error_signature}</Mono>
            </div>
          )}
          {b.fix && <div className="text-xs text-neutral-500">fix: {b.fix}</div>}
        </div>
      ))}
    </div>
  )
}
