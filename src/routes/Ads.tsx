import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adsProfileMatrix, adsScenarioByApp, adsScenarioVersions } from '../lib/queries'
import type { AdsScenarioSummary } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'

type Tab = 'apps' | 'catalog' | 'profiles'

function outcomeTone(outcome: string | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (outcome === 'works') return 'good'
  if (outcome === 'works_with_gotcha') return 'warn'
  if (outcome === 'failed') return 'bad'
  return 'neutral'
}

function SummaryCounts({ summary }: { summary: AdsScenarioSummary | null | undefined }) {
  if (!summary) return <span className="text-neutral-400">—</span>
  const parts = [
    summary.placement_count != null ? `${summary.placement_count} placement` : null,
    summary.screen_count != null ? `${summary.screen_count} màn` : null,
    summary.flow_count != null ? `${summary.flow_count} flow` : null,
  ].filter(Boolean)
  return <span className="text-neutral-500">{parts.join(' · ') || '—'}</span>
}

/** Ads scenarios theo app + catalog version + profile matrix (AF schema ≥ 12). */
export default function Ads() {
  const [tab, setTab] = useState<Tab>('apps')
  const apps = useQuery({ queryKey: ['ads-by-app'], queryFn: adsScenarioByApp })
  const catalog = useQuery({ queryKey: ['ads-scenario-versions'], queryFn: adsScenarioVersions })
  const profiles = useQuery({ queryKey: ['ads-profile-matrix'], queryFn: adsProfileMatrix })

  return (
    <div>
      <h1 className="text-lg">Ads</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Kịch bản ads theo app — lịch sử usage và chi tiết version (profile / lib / AF / content_sha).
        Definition sống ở git; DB giữ catalog snapshot + usage.
      </p>

      <div className="mt-4 flex gap-1 text-sm">
        {(
          [
            ['apps', 'Apps'],
            ['catalog', 'Catalog'],
            ['profiles', 'Profiles'],
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
        {tab === 'apps' && <AppsTab q={apps} />}
        {tab === 'catalog' && <CatalogTab q={catalog} />}
        {tab === 'profiles' && <ProfilesTab q={profiles} />}
      </div>
    </div>
  )
}

function AppsTab({
  q,
}: {
  q: ReturnType<typeof useQuery<Awaited<ReturnType<typeof adsScenarioByApp>>>>
}) {
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length) {
    return (
      <Empty>
        Chưa có app nào ghi <Mono>ads_scenario_usages</Mono>. Chạy ads/phase05 rồi{' '}
        <Mono>af_db ads-scenario-usage</Mono>.
      </Empty>
    )
  }

  return (
    <Table
      head={[
        'App',
        'Scenario mới nhất',
        'Profile',
        'Lib',
        'Outcome',
        'Lần dùng',
        'Versions',
        'Lần cuối',
      ]}
    >
      {q.data.map((a) => (
        <Row key={a.app}>
          <Cell>
            <Link
              to={`/ads/apps/${encodeURIComponent(a.app)}`}
              className="underline underline-offset-2"
            >
              {a.app}
            </Link>
          </Cell>
          <Cell>
            {a.latest_scenario_id ? (
              <Mono>
                {a.latest_scenario_id}@v{a.latest_scenario_version}
              </Mono>
            ) : (
              '—'
            )}
          </Cell>
          <Cell>
            <Mono className="text-neutral-500">{a.latest_profile_id ?? '—'}</Mono>
          </Cell>
          <Cell>
            <Mono className="text-neutral-500">{a.latest_lib_version ?? '—'}</Mono>
          </Cell>
          <Cell>
            {a.latest_outcome ? (
              <Badge tone={outcomeTone(a.latest_outcome)}>{a.latest_outcome}</Badge>
            ) : (
              '—'
            )}
          </Cell>
          <Cell>{a.usage_count}</Cell>
          <Cell>{a.scenario_versions_used}</Cell>
          <Cell className="text-neutral-500">{localTime(a.last_used_at)}</Cell>
        </Row>
      ))}
    </Table>
  )
}

function CatalogTab({
  q,
}: {
  q: ReturnType<typeof useQuery<Awaited<ReturnType<typeof adsScenarioVersions>>>>
}) {
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length) {
    return (
      <Empty>
        Catalog trống — chạy <Mono>af_db ads-scenario-sync --pull</Mono>.
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      {q.data.map((s) => (
        <div
          key={`${s.scenario_id}@${s.scenario_version}`}
          className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              to={`/ads/scenarios/${encodeURIComponent(s.scenario_id)}/${s.scenario_version}`}
              className="underline underline-offset-2"
            >
              <Mono className="text-sm">
                {s.scenario_id}@v{s.scenario_version}
              </Mono>
            </Link>
            <Badge
              tone={
                s.status === 'active' ? 'good' : s.status === 'deprecated' ? 'bad' : 'warn'
              }
            >
              {s.status}
            </Badge>
            <SummaryCounts summary={s.summary} />
          </div>
          {s.description && (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{s.description}</p>
          )}
          <div className="mt-3 grid gap-1 text-xs text-neutral-500 sm:grid-cols-2">
            <div>
              content_sha: <Mono>{s.content_sha}</Mono>
            </div>
            <div>
              source: <Mono>{s.source_path}</Mono>
            </div>
            <div>
              verified: {localTime(s.verified_at)}
            </div>
            <div>
              capabilities:{' '}
              {(s.requires_capabilities ?? []).length
                ? s.requires_capabilities.join(', ')
                : '—'}
            </div>
          </div>
          {Array.isArray(s.summary?.screens) && s.summary.screens.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {s.summary.screens.map((id) => (
                <Badge key={id}>{id}</Badge>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Link
              to={`/ads/scenarios/${encodeURIComponent(s.scenario_id)}/${s.scenario_version}`}
              className="text-xs underline underline-offset-2"
            >
              Xem kịch bản đầy đủ (screens / flow / placements)
            </Link>
          </div>
        </div>
      ))}
    </div>
  )
}

function ProfilesTab({
  q,
}: {
  q: ReturnType<typeof useQuery<Awaited<ReturnType<typeof adsProfileMatrix>>>>
}) {
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length) return <Empty>Chưa có profile matrix.</Empty>

  return (
    <Table
      head={[
        'Profile',
        'Lib',
        'UI',
        'GMA',
        'Native API',
        'Capabilities',
        'Status',
        'Verified',
      ]}
    >
      {q.data.map((p) => (
        <Row key={`${p.profile_id}:${p.version}`}>
          <Cell>
            <Mono>{p.profile_id}</Mono>
          </Cell>
          <Cell>
            <Mono>{p.version}</Mono>
          </Cell>
          <Cell className="text-neutral-500">{p.ui_stack ?? '—'}</Cell>
          <Cell>
            <Mono className="text-neutral-500">
              {p.gma_artifact ?? '—'}
              {p.gma_version ? `@${p.gma_version}` : ''}
            </Mono>
          </Cell>
          <Cell>
            <Mono className="text-neutral-500">{p.native_render_api ?? '—'}</Mono>
          </Cell>
          <Cell className="max-w-[220px] truncate text-neutral-500">
            {(p.capabilities ?? []).join(', ') || '—'}
          </Cell>
          <Cell>
            <Badge tone={p.status === 'active' ? 'good' : 'neutral'}>{p.status ?? '—'}</Badge>
          </Cell>
          <Cell className="text-neutral-500">{localTime(p.verified_at)}</Cell>
        </Row>
      ))}
    </Table>
  )
}
