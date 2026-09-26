import type { CompareData } from '../lib/types'
import { Badge, Mono } from './ui'
import MarkdownView from '../routes/blueprint/MarkdownView'

const FICON: Record<string, string> = { present: '✓', absent: '—', partial: '◐', unknown: '?' }
const KLASS: Record<string, { label: string; cls: string }> = {
  table_stake: { label: 'nền', cls: 'text-neutral-400' },
  differentiator: { label: 'khác biệt', cls: 'text-primary-700 dark:text-primary-300 font-medium' },
  contested: { label: 'tranh chấp', cls: 'text-amber-700 dark:text-amber-400' },
  absent_all: { label: 'không ai', cls: 'text-neutral-400' },
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`border-b border-neutral-200 px-2 py-1.5 text-left font-medium text-neutral-500 dark:border-neutral-800 ${className}`}>{children}</th>
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`border-b border-neutral-100 px-2 py-1.5 align-top dark:border-neutral-900 ${className}`}>{children}</td>
}

export default function ComparisonView({ data, analysis }: { data: CompareData; analysis?: string | null }) {
  const A = data.apps ?? []
  const evs = A.map((a) => a.eval_id)
  const fs = data.feature_summary
  const coh = data.coherence

  return (
    <div className="flex flex-col gap-6">
      {/* Cảnh báo */}
      {(coh.categories.length > 1 || coh.common_tags.length === 0) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950">
          <b>⚠ Khác dòng sản phẩm</b> — cohort trải nhiều category ({coh.categories.join(', ') || '—'}) / ít tag chung ({coh.common_tags.join(', ') || '—'}).
          Ma trận tính năng chỉ có nghĩa trong CÙNG dòng — cân nhắc tách nhóm.
        </div>
      )}
      {coh.store_only.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          ℹ {coh.store_only.length} app <b>store_only</b> (không cài được) → cột feature = <Mono>?</Mono>: {coh.store_only.join(', ')}
        </div>
      )}
      {(coh.no_features?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          ℹ {coh.no_features!.length} app đánh giá bằng <b>ae.sh cũ</b> (chưa có feature matrix) → cột feature = <Mono>?</Mono>; định vị / monetization / pain-point vẫn dùng được: {coh.no_features!.join(', ')}
        </div>
      )}

      {/* ① App */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">① App trong so sánh ({A.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr><Th>eval_id</Th><Th>App</Th><Th>Ver</Th><Th>Mức</Th><Th>Rating · Installs</Th><Th>Tags</Th></tr></thead>
            <tbody>
              {A.map((a) => (
                <tr key={a.eval_id}>
                  <Td><Mono className="text-[11px] text-primary-700 dark:text-primary-300">{a.eval_id}</Mono></Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      {a.icon_url && <img src={a.icon_url} alt="" referrerPolicy="no-referrer" className="h-6 w-6 flex-none rounded-md" />}
                      <span className="font-medium">{a.name ?? a.package}</span>
                    </span>
                  </Td>
                  <Td><Mono className="text-[11px]">{a.version ?? '?'}</Mono></Td>
                  <Td>{a.ev_scope === 'full' ? <Badge>Đầy đủ</Badge> : <Badge tone="warn">Chỉ store</Badge>}</Td>
                  <Td className="whitespace-nowrap">{a.rating ? `${a.rating.toFixed(1)}★` : '—'} · {a.installs ?? '—'}</Td>
                  <Td><span className="flex flex-wrap gap-1">{a.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ② Feature matrix */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">② Ma trận tính năng</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th className="sticky left-0 bg-neutral-50 dark:bg-neutral-950">Feature</Th>
                {A.map((a) => <Th key={a.eval_id} className="text-center"><Mono className="text-[10px]">{a.eval_id}</Mono></Th>)}
                <Th>Loại</Th>
              </tr>
            </thead>
            <tbody>
              {data.feature_matrix.map((row) => {
                const k = KLASS[row.klass]
                return (
                  <tr key={row.key} className={row.klass === 'differentiator' ? 'bg-primary-50/40 dark:bg-primary-950/20' : ''}>
                    <Td className="sticky left-0 bg-white font-medium dark:bg-neutral-900">{row.label}</Td>
                    {evs.map((ev) => {
                      const cell = row.cells[ev] ?? {}
                      const mark = FICON[cell.status ?? 'unknown'] ?? '?'
                      const good = cell.status === 'present'
                      return (
                        <Td key={ev} className="text-center">
                          <span className={good ? 'text-green-700 dark:text-green-400' : 'text-neutral-300 dark:text-neutral-600'}>{mark}</span>
                          {good && cell.access && <span className="block text-[9px] text-neutral-400">{cell.access}</span>}
                        </Td>
                      )
                    })}
                    <Td><span className={`text-[11px] ${k.cls}`}>{k.label}</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-col gap-1 text-xs">
          <div><b>Table-stakes</b> (ai cũng có → baseline dòng): {fs.table_stakes.join(', ') || '—'}</div>
          {Object.entries(fs.differentiators).map(([ev, feats]) => (
            <div key={ev}><b className="text-primary-700 dark:text-primary-300">Khác biệt của {ev}</b>: {feats.join(', ')}</div>
          ))}
          {fs.contested.length > 0 && <div className="text-amber-700 dark:text-amber-400"><b>Tranh chấp</b>: {fs.contested.join(', ')}</div>}
        </div>
      </section>

      {/* ③ Định vị */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">③ Định vị</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {([['positioning', 'Positioning'], ['target_user', 'Target user'], ['core_value', 'Core value'], ['activation', 'Activation']] as [string, string][]).map(([f, lab]) => (
            <div key={f} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{lab}</div>
              <ul className="flex flex-col gap-1.5 text-xs">
                {A.map((a) => a.summary[f] && (
                  <li key={a.eval_id}><Mono className="text-[10px] text-neutral-400">{a.eval_id}</Mono> {a.summary[f]}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ④ Rubric */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">④ Điểm rubric (INFERENCE, 0–5)</h2>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><Th>App</Th>{['Giá trị SP', 'UI/UX', 'Nội dung', 'Áp lực monet', 'Ma sát onboard'].map((h) => <Th key={h} className="text-center">{h}</Th>)}</tr></thead>
            <tbody>
              {A.map((a) => (
                <tr key={a.eval_id}>
                  <Td className="font-medium">{a.name ?? a.eval_id}</Td>
                  {(['product_value', 'ui_ux', 'content', 'monetization_pressure', 'onboarding_friction'] as const).map((k) => {
                    const v = a.scores[k]
                    const hard = k === 'monetization_pressure' || k === 'onboarding_friction'
                    return <Td key={k} className="text-center"><span className={hard && (v ?? 0) >= 4 ? 'font-bold text-amber-600 dark:text-amber-400' : ''}>{v ?? '—'}</span></Td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ⑤ Monet */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">⑤ Monetization</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr>{['App', 'Model', 'Mediation chính', 'Ad formats', 'IAP range', 'Bidding'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
            <tbody>
              {A.map((a) => {
                const m = a.monet
                const model = [m.ad_supported && 'ads', m.offers_iap && 'IAP'].filter(Boolean).join('/')
                return (
                  <tr key={a.eval_id}>
                    <Td className="font-medium">{a.name ?? a.eval_id}</Td>
                    <Td>{model || '—'}</Td>
                    <Td>{m.mediation_primary ?? '—'}</Td>
                    <Td className="text-[11px]">{m.ad_formats.join(', ') || '—'}</Td>
                    <Td>{m.iap_range ?? '—'}</Td>
                    <Td className="text-[11px]">{m.bidding_sources.join(', ') || '—'}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs">
          <b>Xếp hạng độ gắt monet</b> (áp lực + ma sát):
          <ol className="mt-1 list-decimal pl-5">
            {data.monet_aggressiveness.map((r) => (
              <li key={r.eval_id}>{r.name ?? r.eval_id} — pressure <b>{r.pressure ?? '—'}</b> · friction <b>{r.friction ?? '—'}</b> · {r.ad_networks} mạng ads</li>
            ))}
          </ol>
        </div>
      </section>

      {/* ⑥ Pain/weakness */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold">⑥ Pain-point chung của dòng</h2>
          <p className="mb-1 text-[11px] text-neutral-500">Xuất hiện nhiều app = vấn đề user đã kiểm chứng.</p>
          <ul className="flex flex-col gap-1 text-xs">
            {data.pain_points.slice(0, 12).map((p, i) => (
              <li key={i}>{p.text}{p.n > 1 && <Badge tone="warn"> {p.n} app</Badge>}</li>
            ))}
            {data.pain_points.length === 0 && <li className="text-neutral-400">—</li>}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Điểm yếu chung</h2>
          <ul className="flex flex-col gap-1 text-xs">
            {data.weaknesses.slice(0, 12).map((w, i) => (
              <li key={i}>{w.text}{w.n > 1 && <Badge tone="warn"> {w.n} app</Badge>}</li>
            ))}
            {data.weaknesses.length === 0 && <li className="text-neutral-400">—</li>}
          </ul>
        </div>
      </section>

      {/* Diễn giải agent */}
      {analysis && (
        <section className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 dark:border-primary-900 dark:bg-primary-950/20">
          <h2 className="mb-2 text-sm font-semibold">Diễn giải (agent) — whitespace · định vị · đề xuất khác biệt</h2>
          <MarkdownView text={analysis} />
        </section>
      )}
    </div>
  )
}
