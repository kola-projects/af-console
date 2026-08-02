import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ScenarioDefinitionView from '../components/ScenarioDefinitionView'
import { adsScenarioUsageHistory } from '../lib/queries'
import type { AdsScenarioUsageHistory } from '../lib/types'
import { Badge, Empty, ErrorBox, Loading, Mono, localTime } from '../components/ui'

function outcomeTone(outcome: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (outcome === 'works') return 'good'
  if (outcome === 'works_with_gotcha') return 'warn'
  if (outcome === 'failed') return 'bad'
  return 'neutral'
}

function shaShort(sha: string | null | undefined) {
  if (!sha) return '—'
  if (sha.startsWith('sha256:') && sha.length > 20) return `${sha.slice(0, 19)}…`
  return sha
}

function UsageCard({
  u,
  showDefinition,
  onToggleDefinition,
}: {
  u: AdsScenarioUsageHistory
  showDefinition: boolean
  onToggleDefinition: () => void
}) {
  const shaMismatch =
    u.scenario_content_sha &&
    u.catalog_content_sha &&
    u.scenario_content_sha !== u.catalog_content_sha &&
    u.catalog_content_sha !== 'sha256:pending-sync'

  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline gap-2">
        <Link
          to={`/ads/scenarios/${encodeURIComponent(u.scenario_id)}/${u.scenario_version}`}
          className="underline underline-offset-2"
        >
          <Mono className="text-sm">{u.scenario_ref}</Mono>
        </Link>
        <Badge tone={outcomeTone(u.outcome)}>{u.outcome}</Badge>
        <span className="text-xs text-neutral-500">{localTime(u.created_at)}</span>
      </div>

      {u.scenario_description && (
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {u.scenario_description}
        </p>
      )}

      <div className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          Profile: <Mono>{u.profile_id}</Mono>
          {u.ui_stack && <span className="text-neutral-500"> · {u.ui_stack}</span>}
        </div>
        <div>
          Lib: <Mono>{u.lib_version ?? '—'}</Mono>
          {u.gma_version && (
            <span className="text-neutral-500">
              {' '}
              · GMA <Mono>{u.gma_version}</Mono>
            </span>
          )}
        </div>
        <div>
          AF: <Mono>{u.effective_af_version ?? '—'}</Mono>
        </div>
        <div>
          code_base: <Mono>{u.effective_code_base_version ?? '—'}</Mono>
        </div>
        <div>
          Run:{' '}
          <Link to={`/runs/${u.run_id}`} className="underline underline-offset-2">
            <Mono>{u.run_name ?? `#${u.run_id}`}</Mono>
          </Link>
          {u.job_kind && <span className="text-neutral-500"> · {u.job_kind}</span>}
        </div>
        <div>
          Native API: <Mono className="text-neutral-500">{u.native_render_api ?? '—'}</Mono>
        </div>
        <div className="sm:col-span-2">
          content_sha (lúc dùng): <Mono>{shaShort(u.scenario_content_sha)}</Mono>
          {shaMismatch && (
            <span className="ml-2">
              <Badge tone="warn">khác catalog hiện tại</Badge>
            </span>
          )}
        </div>
      </div>

      {u.notes && (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{u.notes}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleDefinition}
          className="rounded bg-neutral-900 px-2.5 py-1 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          {showDefinition ? 'Ẩn kịch bản' : 'Xem kịch bản (screens / flow / placements)'}
        </button>
        <Link
          to={`/ads/scenarios/${encodeURIComponent(u.scenario_id)}/${u.scenario_version}`}
          className="rounded px-2.5 py-1 text-xs text-neutral-600 underline underline-offset-2 dark:text-neutral-400"
        >
          Trang catalog đầy đủ
        </Link>
      </div>

      {showDefinition && (
        <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <ScenarioDefinitionView
            definition={u.catalog_definition ?? undefined}
          />
        </div>
      )}
    </div>
  )
}

/** Lịch sử scenario ads của một app — kèm nút xem definition. */
export default function AdsAppDetail() {
  const app = decodeURIComponent(useParams().app ?? '')
  const q = useQuery({
    queryKey: ['ads-usage', app],
    queryFn: () => adsScenarioUsageHistory({ app }),
    enabled: !!app,
  })
  const [openId, setOpenId] = useState<number | null>(null)

  if (!app) return <Empty>Thiếu tên app.</Empty>
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />

  // Mặc định mở kịch bản của usage mới nhất để khỏi phải bấm thêm.
  const latestId = q.data?.[0]?.id ?? null
  const effectiveOpen = openId ?? latestId

  return (
    <div>
      <Link to="/ads" className="text-sm text-neutral-500 underline underline-offset-2">
        ← Ads
      </Link>
      <h1 className="mt-2 text-lg">{app}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Lịch sử gắn kịch bản ads — mở thẻ để xem screens / slots / flow / placements.
      </p>

      {!q.data?.length ? (
        <div className="mt-6">
          <Empty>App này chưa có usage scenario.</Empty>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {q.data.map((u) => (
            <UsageCard
              key={u.id}
              u={u}
              showDefinition={effectiveOpen === u.id}
              onToggleDefinition={() =>
                setOpenId((cur) => {
                  const current = cur ?? latestId
                  return current === u.id ? -1 : u.id
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
