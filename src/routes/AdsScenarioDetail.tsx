import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ScenarioDefinitionView from '../components/ScenarioDefinitionView'
import { adsScenarioUsageHistory, adsScenarioVersion } from '../lib/queries'
import { Badge, Empty, ErrorBox, Loading, Mono, localTime } from '../components/ui'

/** Chi tiết một bản scenario@version — definition đầy đủ + app đã dùng. */
export default function AdsScenarioDetail() {
  const { id = '', version: versionRaw = '' } = useParams()
  const scenarioId = decodeURIComponent(id)
  const version = Number(versionRaw)
  const catalog = useQuery({
    queryKey: ['ads-scenario', scenarioId, version],
    queryFn: () => adsScenarioVersion(scenarioId, version),
    enabled: !!scenarioId && Number.isFinite(version) && version >= 1,
  })
  const usages = useQuery({
    queryKey: ['ads-usage-scenario', scenarioId, version],
    queryFn: () =>
      adsScenarioUsageHistory({ scenarioId, scenarioVersion: version }),
    enabled: !!scenarioId && Number.isFinite(version) && version >= 1,
  })

  if (!scenarioId || !Number.isFinite(version) || version < 1) {
    return <Empty>Tham chiếu scenario không hợp lệ.</Empty>
  }
  if (catalog.isLoading) return <Loading />
  if (catalog.error) return <ErrorBox error={catalog.error} />
  if (!catalog.data) return <Empty>Không thấy bản scenario này trong catalog.</Empty>

  const s = catalog.data
  const usedBy = usages.data ?? []

  return (
    <div>
      <Link to="/ads" className="text-sm text-neutral-500 underline underline-offset-2">
        ← Ads
      </Link>
      <h1 className="mt-2 text-lg">
        <Mono className="text-base">
          {s.scenario_id}@v{s.scenario_version}
        </Mono>
      </h1>
      <div className="mt-1 flex flex-wrap gap-2 text-sm text-neutral-500">
        <Badge tone={s.status === 'active' ? 'good' : s.status === 'deprecated' ? 'bad' : 'warn'}>
          {s.status}
        </Badge>
        <span>verified {localTime(s.verified_at)}</span>
        <span>
          {s.summary?.placement_count ?? '—'} placement · {s.summary?.screen_count ?? '—'} màn ·{' '}
          {s.summary?.flow_count ?? '—'} flow
        </span>
      </div>

      {s.description && (
        <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">{s.description}</p>
      )}

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          content_sha: <Mono className="break-all">{s.content_sha}</Mono>
        </div>
        <div>
          source: <Mono>{s.source_path}</Mono>
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-1">
          <span>requires:</span>
          {(s.requires_capabilities ?? []).length
            ? s.requires_capabilities.map((c) => <Badge key={c}>{c}</Badge>)
            : '—'}
        </div>
      </div>

      <div className="mt-8">
        <ScenarioDefinitionView definition={s.definition} />
      </div>

      <h2 className="mt-10 text-sm text-neutral-500">App đã dùng ({usedBy.length})</h2>
      {usages.isLoading ? (
        <Loading />
      ) : !usedBy.length ? (
        <div className="mt-2">
          <Empty>Chưa có usage nào gắn bản này.</Empty>
        </div>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {usedBy.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2">
              <Link
                to={`/ads/apps/${encodeURIComponent(u.app)}`}
                className="underline underline-offset-2"
              >
                {u.app}
              </Link>
              <Badge tone={u.outcome === 'works' ? 'good' : u.outcome === 'failed' ? 'bad' : 'warn'}>
                {u.outcome}
              </Badge>
              <Mono className="text-neutral-500">{u.profile_id}</Mono>
              <Mono className="text-neutral-500">{u.lib_version ?? '—'}</Mono>
              <span className="text-neutral-400">{localTime(u.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
