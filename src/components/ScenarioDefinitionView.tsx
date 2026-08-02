import { Badge, Cell, Mono, Row, Table } from './ui'
import type { AdsScenarioDefinition } from '../lib/types'

function fmtAction(a: Record<string, unknown>): string {
  const t = String(a.type ?? '?')
  if (t === 'preload') {
    const ps = Array.isArray(a.placements) ? a.placements.join(', ') : '—'
    return `preload [${ps}]`
  }
  if (t === 'show_inter') return `show_inter ${a.placement ?? '—'}`
  if (t === 'navigate') return `navigate → ${a.target ?? '—'}`
  return t
}

function fmtTrigger(t: Record<string, unknown> | undefined): string {
  if (!t) return '—'
  const type = String(t.type ?? '?')
  return t.target ? `${type}:${t.target}` : type
}

function slotLoad(sl: Record<string, unknown>): string {
  const load = (sl.load as Record<string, unknown>) || {}
  const mode = String(load.mode ?? '—')
  return load.warmed_by ? `${mode} ← ${load.warmed_by}` : mode
}

function slotRefresh(sl: Record<string, unknown>): string {
  const refresh = (sl.refresh as Record<string, unknown>) || {}
  const reload = (sl.reload as Record<string, unknown>) || {}
  const parts: string[] = []
  if (refresh.interval_ms) parts.push(`refresh ${refresh.interval_ms}ms`)
  if (reload.on_resume) parts.push(`resume→${reload.placement ?? '?'}`)
  return parts.join(', ') || '—'
}

function slotRender(sl: Record<string, unknown>): string {
  const render = (sl.render as Record<string, unknown>) || {}
  const src = String(render.source ?? '—')
  const tpl = render.template
  return tpl ? `${src}:${tpl}` : src
}

/** Render kịch bản ads từ definition jsonb (scenario.json). */
export default function ScenarioDefinitionView({
  definition,
}: {
  definition: AdsScenarioDefinition | null | undefined
}) {
  if (!definition || !Object.keys(definition).length) {
    return (
      <p className="text-sm text-neutral-500">
        Chưa có definition trong catalog — chạy <Mono>af_db ads-scenario-sync --pull</Mono>.
      </p>
    )
  }

  const globals = definition.globals ?? {}
  const gates = definition.gates ?? []
  const placements = definition.placements ?? []
  const screens = definition.screens ?? []
  const flow = definition.flow ?? []
  const verify = definition.verify ?? []

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm text-neutral-500">Globals</h2>
        <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <div>
            load_strategy: <Mono>{String(globals.load_strategy ?? '—')}</Mono>
          </div>
          <div>
            timeout: <Mono>{String(globals.timeout_ms ?? '—')}</Mono> ms
          </div>
          <div>
            inter_interval: <Mono>{String(globals.inter_ad_interval_ms ?? '—')}</Mono> ms
          </div>
          <div>
            click_cooldown: <Mono>{String(globals.ad_click_cooldown_ms ?? '—')}</Mono> ms
          </div>
          <div>
            owner: <Mono>{String(globals.owner ?? '—')}</Mono>
          </div>
          <div className="sm:col-span-2">
            skip_interval:{' '}
            {Array.isArray(globals.skip_interval_placements) &&
            globals.skip_interval_placements.length
              ? globals.skip_interval_placements.map((p) => (
                  <Badge key={String(p)}>{String(p)}</Badge>
                ))
              : '—'}
          </div>
        </div>
      </section>

      {gates.length > 0 && (
        <section>
          <h2 className="text-sm text-neutral-500">Gates ({gates.length})</h2>
          <div className="mt-2">
            <Table head={['Id', 'Decision', 'Fail']}>
              {gates.map((g) => (
                <Row key={String(g.id)}>
                  <Cell>
                    <Mono>{String(g.id)}</Mono>
                  </Cell>
                  <Cell className="text-neutral-600 dark:text-neutral-400">
                    {String(g.decision ?? '—')}
                  </Cell>
                  <Cell>
                    <Badge>{String(g.fail_behavior ?? '—')}</Badge>
                  </Cell>
                </Row>
              ))}
            </Table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm text-neutral-500">
          Screens & slots ({screens.length} màn)
        </h2>
        <div className="mt-3 space-y-4">
          {screens.map((sc) => (
            <div
              key={String(sc.id)}
              className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Mono className="text-sm">{String(sc.id)}</Mono>
                {sc.optional ? <Badge tone="warn">optional</Badge> : null}
                <span className="text-xs text-neutral-500">
                  {(sc.slots ?? []).length} slot
                </span>
              </div>
              <div className="mt-2 overflow-x-auto">
                <Table head={['Slot', 'Anchor', 'Placements', 'Render', 'Load', 'Refresh/reload']}>
                  {(sc.slots ?? []).map((sl) => (
                    <Row key={String(sl.id)}>
                      <Cell>
                        <Mono>{String(sl.id)}</Mono>
                      </Cell>
                      <Cell className="text-neutral-500">{String(sl.anchor ?? '—')}</Cell>
                      <Cell>
                        <Mono className="text-neutral-500">
                          {Array.isArray(sl.placements)
                            ? sl.placements.join(', ')
                            : '—'}
                        </Mono>
                      </Cell>
                      <Cell>
                        <Mono className="text-neutral-500">{slotRender(sl)}</Mono>
                      </Cell>
                      <Cell>
                        <Mono className="text-neutral-500">{slotLoad(sl)}</Mono>
                      </Cell>
                      <Cell className="text-neutral-500">{slotRefresh(sl)}</Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm text-neutral-500">Flow ({flow.length})</h2>
        <div className="mt-2 overflow-x-auto">
          <Table head={['Id', 'Screen', 'Trigger', 'Actions']}>
            {flow.map((f) => (
              <Row key={String(f.id)}>
                <Cell>
                  <Mono>{String(f.id)}</Mono>
                </Cell>
                <Cell>
                  <Mono className="text-neutral-500">{String(f.screen ?? '—')}</Mono>
                </Cell>
                <Cell>
                  <Mono className="text-neutral-500">
                    {fmtTrigger(f.trigger as Record<string, unknown> | undefined)}
                  </Mono>
                </Cell>
                <Cell className="max-w-md text-neutral-600 dark:text-neutral-400">
                  {(f.actions ?? [])
                    .map((a) => fmtAction(a as Record<string, unknown>))
                    .join(' → ')}
                </Cell>
              </Row>
            ))}
          </Table>
        </div>
      </section>

      <section>
        <h2 className="text-sm text-neutral-500">Placements ({placements.length})</h2>
        <div className="mt-2 overflow-x-auto">
          <Table head={['Name', 'Format', 'Role', 'Show', 'Organic']}>
            {placements.map((p) => (
              <Row key={String(p.name)}>
                <Cell>
                  <Mono>{String(p.name)}</Mono>
                </Cell>
                <Cell>
                  <Badge>{String(p.format ?? '—')}</Badge>
                </Cell>
                <Cell>
                  <Mono className="text-neutral-500">{String(p.unit_role ?? '—')}</Mono>
                </Cell>
                <Cell>{p.show ? 'yes' : 'no'}</Cell>
                <Cell>{p.organic_show ? 'yes' : 'no'}</Cell>
              </Row>
            ))}
          </Table>
        </div>
      </section>

      {verify.length > 0 && (
        <section>
          <h2 className="text-sm text-neutral-500">Verify ({verify.length})</h2>
          <div className="mt-2 space-y-3">
            {verify.map((v) => (
              <div
                key={String(v.id)}
                className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <Mono>{String(v.id)}</Mono>
                <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                  {String(v.steps ?? '')}
                </p>
                <p className="mt-1 text-neutral-500">Expect: {String(v.expect ?? '')}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
