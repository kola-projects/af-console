// [3.53.0] Bốn màn hoạt động của UA activity report (thiết kế chủ sản phẩm duyệt 2026-11-25):
//   Tổng quan — mỗi người một dòng: dải Workload 14 ngày, app tập trung, kết quả creative
//   Workload  — 8 tuần gần nhất, mỗi ô một ngày (creative lên + thao tác)
//   Phân bổ   — loại hoạt động và app tập trung của từng người; đổi được sang xem theo app
//   Kết quả   — creative mới → chi ≥ $10 → win, chi và ROAS quảng cáo (khớp màn Kho creative của ZooKeeper)
// Bấm tên một người ở bất kỳ đâu để mở trang riêng của người đó (PersonPage).
import { useMemo, useState } from 'react'
import {
  ACT_KINDS,
  ACT_KIND_LABEL,
  addDays,
  creativeRoas,
  dayVN,
  int,
  mondayOf,
  pct,
  shortDay,
  testedLabel,
  usd,
  type ActKind,
  type CreativeAgg,
  type CreativePerson,
  type PersonActivity,
  type UaApp,
} from '../../lib/uaReport'
import DataTable, { type Column, type TotalRow } from '../../components/DataTable'
import { Empty, Stat } from '../../components/ui'
import {
  AppIconImg,
  BTN,
  CreativeNote,
  CreativeStamp,
  DASH,
  DayStrip,
  HeatCell,
  HeatLegend,
  MUTED,
  PersonLink,
  ZERO_ACTIVITY,
  creativeOf,
  dayCountOf,
  sumDays,
  type RosterRow,
  type ViewProps,
} from './shared'

export const KIND_COLOR: Record<ActKind, string> = {
  upload: '#378ADD',
  create: '#1D9E75',
  status: '#EF9F27',
  budget: '#7F77DD',
  other: '#9CA3AF',
}
const WIN_COLOR = '#639922'

type Row = RosterRow & { act: PersonActivity; cr: CreativePerson | null }

function useRows({ roster, act, team }: ViewProps): Row[] {
  return useMemo(
    () => roster.map((r) => ({ ...r, act: act.get(r.key) ?? ZERO_ACTIVITY(r.key, r.name), cr: creativeOf(team, r.key) })),
    [roster, act, team],
  )
}

/** App tập trung của một người = các app người đó có creative mới trong kỳ, nhiều nhất đứng trước
 *  (không có creative mới thì lấy theo creative đang chạy). */
export function focusApps(cr: CreativePerson | null): { app: string; app_id: string | null; n: number; share: number }[] {
  if (!cr) return []
  const byNew = cr.apps.filter((a) => a.new > 0)
  const list = byNew.length ? byNew.map((a) => ({ app: a.app, app_id: a.app_id, n: a.new })) : cr.apps.filter((a) => a.creatives > 0).map((a) => ({ app: a.app, app_id: a.app_id, n: a.creatives }))
  const total = list.reduce((t, a) => t + a.n, 0) || 1
  return list.sort((a, b) => b.n - a.n).map((a) => ({ ...a, share: a.n / total }))
}
/** Bỏ phần mô tả sau dấu ":" / " - " của tên store để dòng gọn: "Kaleidra: Short Drama Series" → "Kaleidra". */
export const shortApp = (name: string) => name.split(/\s*[:–|]\s*|\s+-\s+/)[0] || name

const winText = (a: CreativeAgg, min: number) => `${int(a.win)} win / ${int(a.tested)} ${testedLabel(min)}`
/** Lời giải thích hiện khi rê chuột vào ROAS / chấm xanh. */
export const winTitle = (a: CreativeAgg, min: number | null | undefined) =>
  a.tested ? `${int(a.win)} creative win trong ${int(a.tested)} creative đã ${testedLabel(min)}` : `Chưa có creative nào ${testedLabel(min)}`

/** Chủ sản phẩm chốt (2026-11-25): không viết số win / ngưỡng chi ra màn hình — có creative win trong kỳ thì
 *  chỉ một chấm xanh nhỏ cạnh ROAS quảng cáo; số nằm ở tooltip và ở các cột ẩn sẵn (bật trong nút "Cột"). */
export function RoasWithDot({ a, min, dot = true }: { a: CreativeAgg; min: number | null | undefined; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={winTitle(a, min)}>
      {dot && a.win > 0 && <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: WIN_COLOR }} aria-label="có creative win" />}
      {pct(creativeRoas(a))}
    </span>
  )
}

function WinBar({ a }: { a: CreativeAgg }) {
  if (!a.tested) return DASH
  const r = a.win / a.tested
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
        <div className="h-full" style={{ width: `${(r * 100).toFixed(0)}%`, backgroundColor: WIN_COLOR }} />
      </div>
      <span className="min-w-16 whitespace-nowrap text-xs tabular-nums">{int(a.win)} · {(r * 100).toFixed(0)}%</span>
    </div>
  )
}

export function KindLegend({ kinds = ACT_KINDS }: { kinds?: ActKind[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[11px] w-[11px] rounded-[2px]" style={{ backgroundColor: KIND_COLOR[k] }} />
          {ACT_KIND_LABEL[k]}
        </span>
      ))}
    </div>
  )
}

/** Thanh chồng theo loại hoạt động. */
function KindBar({ act }: { act: PersonActivity }) {
  if (!act.total) return <div className="h-3 rounded bg-neutral-100 dark:bg-neutral-800" />
  return (
    <div className="flex h-3 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
      {ACT_KINDS.map((k) =>
        act.kinds[k] ? (
          <div key={k} title={`${ACT_KIND_LABEL[k]}: ${int(act.kinds[k])}`} style={{ width: `${((act.kinds[k] / act.total) * 100).toFixed(1)}%`, backgroundColor: KIND_COLOR[k] }} />
        ) : null,
      )}
    </div>
  )
}

/** Bốn ô số đầu trang cho cả đội (cùng bốn ô với trang từng UA). */
export function TeamStats({ act, team, creativeQ }: Pick<ViewProps, 'act' | 'team' | 'creativeQ'>) {
  const actions = [...act.values()].reduce((t, a) => t + a.actions, 0)
  const uploads = [...act.values()].reduce((t, a) => t + a.kinds.upload, 0)
  const waiting = creativeQ.data?.status === 'pending' || creativeQ.isLoading ? 'đang lấy từ ZooKeeper…' : undefined
  const t = team?.totals
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Creative mới" value={t ? int(t.new) : '—'} hint={waiting ?? (t ? `${int(t.creatives)} creative đang chạy trong kỳ` : `${int(uploads)} creative lên theo lịch`)} />
      <Stat label="Thao tác campaign" value={int(actions)} hint="tạo, bật / tắt, chỉnh ngân sách" />
      <Stat label="Chi quảng cáo" value={t ? usd(t.spend) : '—'} hint={waiting ?? (t ? `doanh thu Adjust ${usd(t.revenue)}` : undefined)} />
      <Stat label="ROAS quảng cáo" value={t ? pct(creativeRoas(t)) : '—'} hint={waiting ?? (t ? 'doanh thu Adjust / chi của creative' : undefined)} />
    </div>
  )
}

// ----------------------------------------------------------------------------- Tổng quan
export function Overview(p: ViewProps) {
  const rows = useRows(p)
  const { s, cal, go, creativeQ, team } = p
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(s.to, i - 13)), [s.to])
  const columns = useMemo<Column<Row>[]>(
    () => [
      { id: 'name', header: 'UA', locked: true, sortValue: (r) => r.name, cell: (r) => <PersonLink row={r} go={go} /> },
      {
        id: 'workload', header: `Workload 14 ngày (tới ${shortDay(s.to)})`, sortValue: (r) => sumDays(cal, r.key, days), csvValue: (r) => sumDays(cal, r.key, days),
        cell: (r) => <DayStrip cal={cal} personKey={r.key} days={days} onPick={(d) => go(r.key, d)} />,
      },
      {
        id: 'focus', header: 'App tập trung', sortValue: (r) => r.act.total,
        csvValue: (r) => focusApps(r.cr).slice(0, 3).map((a) => a.app).join('; '),
        cell: (r) => {
          const apps = focusApps(r.cr)
          return (
            <div className="text-xs">
              <div className="text-sm">{apps.length ? apps.slice(0, 2).map((a) => shortApp(a.app)).join(', ') : team ? DASH : <span className={MUTED}>…</span>}</div>
              <div className={MUTED}>{int(r.act.kinds.upload)} creative · {int(r.act.actions)} thao tác</div>
            </div>
          )
        },
      },
      {
        id: 'result', header: 'Kết quả creative', sortValue: (r) => r.cr?.win ?? null,
        csvValue: (r) => (r.cr ? `${winText(r.cr, team?.min_spend ?? 10)}; ROAS QC ${pct(creativeRoas(r.cr))}; chi ${usd(r.cr.spend)}` : ''),
        cell: (r) =>
          // Chủ sản phẩm chốt (2026-11-25): không viết số win / ngưỡng chi ở đây — có creative win trong kỳ thì
          // chỉ một chấm xanh nhỏ; số chi tiết hiện khi rê chuột và ở tab Kết quả.
          r.cr ? (
            r.cr.spend >= 1 ? (
              <div className="text-xs" title={winTitle(r.cr, team?.min_spend)}>
                <div className="flex items-center gap-1.5 text-sm">
                  {r.cr.win > 0 && <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ backgroundColor: WIN_COLOR }} aria-label="có creative win" />}
                  ROAS QC {pct(creativeRoas(r.cr))}
                </div>
                <div className={MUTED}>chi {usd(r.cr.spend)}</div>
              </div>
            ) : DASH
          ) : team ? DASH : <span className={MUTED}>…</span>,
      },
    ],
    [cal, days, go, s.to, team],
  )
  if (!rows.length) return <Empty>Chưa có hoạt động nào được ghi nhận.</Empty>
  return (
    <>
      <CreativeNote q={creativeQ} />
      <div className={team ? '' : 'mt-3'}>
        <DataTable tableId="ua-overview" columns={columns} rows={rows} rowKey={(r) => r.key} defaultSort={{ id: 'workload', dir: 'desc' }} csvName={`ua-tong-quan_${s.from}_${s.to}`} />
      </div>
      <p className={`mt-3 text-xs ${MUTED}`}>
        Mỗi ô của dải Workload là một ngày: càng đậm càng nhiều hoạt động (creative lên + thao tác campaign); rê chuột để xem số,
        bấm để mở ngày đó. App tập trung và Kết quả creative tính trong khoảng ngày đang chọn ({shortDay(s.from)} – {shortDay(s.to)}).
        ROAS QC = doanh thu Adjust / chi của creative; chấm xanh = có creative win trong kỳ (rê chuột để xem số, chi tiết ở tab Kết quả).
        Bấm tên để mở trang riêng. <CreativeStamp q={creativeQ} />
      </p>
    </>
  )
}

// ----------------------------------------------------------------------------- Workload
const CELL = 13
const WEEKS = 8

export function Workload(p: ViewProps) {
  const { roster, cal, go } = p
  const today = dayVN(0)
  const weeks = useMemo(() => {
    const first = addDays(mondayOf(today), -7 * (WEEKS - 1))
    return Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)))
  }, [today])
  const rows = useMemo(() => {
    const all = weeks.flat()
    return roster.map((r) => ({ ...r, total: sumDays(cal, r.key, all) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'vi'))
  }, [roster, cal, weeks])
  if (!rows.length) return <Empty>Chưa có hoạt động nào được ghi nhận.</Empty>
  const weekWidth = 7 * CELL + 6 * 2
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`mr-auto text-sm ${MUTED}`}>{WEEKS} tuần gần nhất, mỗi ô một ngày (tuần bắt đầu thứ Hai)</span>
        <HeatLegend />
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className={`py-1 pr-6 text-left text-xs font-normal ${MUTED}`}>UA</th>
              <th className="py-1 text-left">
                <div className="flex gap-[8px]">
                  {weeks.map((w) => <span key={w[0]} className={`inline-block text-[11px] font-normal ${MUTED}`} style={{ width: weekWidth }}>{shortDay(w[0])}</span>)}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-neutral-100 dark:border-neutral-900">
                <td className="whitespace-nowrap py-1.5 pr-6"><PersonLink row={r} go={go} /></td>
                <td className="py-1.5">
                  <div className="flex gap-[8px]">
                    {weeks.map((w) => (
                      <span key={w[0]} className="inline-flex gap-[2px]">
                        {w.map((d) => <HeatCell key={d} day={d} c={dayCountOf(cal, r.key, d)} size={CELL} blank={d > today} onClick={() => go(r.key, d)} />)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`mt-3 text-xs ${MUTED}`}>
        Mỗi ô = số creative lên + số thao tác campaign của ngày đó. Rê chuột vào ô để xem số, bấm để mở chi tiết ngày trên trang
        của người đó. Chỉ phản ánh việc đi qua ZooKeeper: sửa thẳng trong Ads Manager / Google Ads, hay thời gian dựng video,
        không hiện thành ô xanh. Màn này luôn tính tới hôm nay, không theo khoảng ngày đang chọn.
      </p>
    </>
  )
}

// ----------------------------------------------------------------------------- Phân bổ
type AppRow = {
  app: string
  app_id: string | null
  ua: UaApp | null
  people: { key: string; name: string; n: number }[]
  agg: CreativeAgg
}

function buildCreativeApps(p: ViewProps): AppRow[] {
  const appOf = new Map(p.s.apps.map((a) => [a.app_id, a]))
  const rows = new Map<string, AppRow>()
  for (const person of p.team?.people ?? []) {
    for (const a of person.apps) {
      let r = rows.get(a.app)
      if (!r) {
        r = { app: a.app, app_id: a.app_id, ua: a.app_id ? appOf.get(a.app_id) ?? null : null, people: [], agg: { creatives: 0, new: 0, live: 0, no_spend: 0, testing: 0, tested: 0, win: 0, not_ok: 0, inferred: 0, spend: 0, revenue: 0 } }
        rows.set(a.app, r)
      }
      for (const k of Object.keys(r.agg) as (keyof CreativeAgg)[]) r.agg[k] += a[k]
      if (person.person_key !== '_unknown' && (a.new > 0 || a.creatives > 0)) r.people.push({ key: person.person_key, name: person.name, n: a.new || a.creatives })
    }
  }
  for (const r of rows.values()) r.people.sort((a, b) => b.n - a.n)
  return [...rows.values()]
}

export function Allocation(p: ViewProps) {
  const [mode, setMode] = useState<'person' | 'app'>('person')
  const rows = useRows(p)
  const { s, go, creativeQ, team } = p
  const apps = useMemo(() => buildCreativeApps(p), [p.team, p.s.apps]) // eslint-disable-line react-hooks/exhaustive-deps
  const usedKinds = useMemo(() => ACT_KINDS.filter((k) => k !== 'other' || rows.some((r) => r.act.kinds.other > 0)), [rows])

  const personCols = useMemo<Column<Row>[]>(
    () => [
      { id: 'name', header: 'UA', locked: true, sortValue: (r) => r.name, cell: (r) => <PersonLink row={r} go={go} /> },
      {
        id: 'kinds', header: 'Loại hoạt động', sortValue: (r) => r.act.total, className: 'min-w-64',
        csvValue: (r) => ACT_KINDS.map((k) => `${ACT_KIND_LABEL[k]} ${r.act.kinds[k]}`).join('; '),
        cell: (r) => (
          <div>
            <KindBar act={r.act} />
            <div className={`mt-0.5 text-xs ${MUTED}`}>{int(r.act.total)} hoạt động</div>
          </div>
        ),
      },
      ...ACT_KINDS.map<Column<Row>>((k) => ({
        id: `k_${k}`, header: ACT_KIND_LABEL[k], align: 'right', defaultHidden: true,
        sortValue: (r) => r.act.kinds[k], cell: (r) => (r.act.kinds[k] ? int(r.act.kinds[k]) : ''),
      })),
      {
        id: 'apps', header: 'App tập trung (theo creative mới)', sortValue: (r) => focusApps(r.cr)[0]?.app ?? null,
        csvValue: (r) => focusApps(r.cr).map((a) => `${a.app} ${(a.share * 100).toFixed(0)}%`).join('; '),
        cell: (r) => {
          const list = focusApps(r.cr)
          if (!list.length) return team ? DASH : <span className={MUTED}>…</span>
          return (
            <span className="text-xs">
              {list.slice(0, 4).map((a, i) => (
                <span key={a.app} title={`${a.app}: ${int(a.n)} creative`}>
                  {i > 0 && <span className={MUTED}> · </span>}
                  <span className="text-sm">{shortApp(a.app)}</span> <span className={MUTED}>{(a.share * 100).toFixed(0)}%</span>
                </span>
              ))}
              {list.length > 4 && <span className={MUTED}> · +{list.length - 4} app</span>}
            </span>
          )
        },
      },
    ],
    [go, team],
  )
  const appCols = useMemo<Column<AppRow>[]>(
    () => [
      {
        id: 'app', header: 'App', locked: true, sortValue: (r) => r.ua?.app_name ?? r.app,
        cell: (r) => (
          <div className="flex items-center gap-2.5">
            <AppIconImg url={r.ua?.icon_url} name={r.ua?.app_name ?? r.app} size={24} />
            <span title={`Tên trên ZooKeeper: ${r.app}`}>{r.ua?.app_name ?? r.app}</span>
          </div>
        ),
      },
      {
        id: 'people', header: 'Người tham gia', sortValue: (r) => r.people[0]?.name ?? null,
        csvValue: (r) => r.people.map((x) => `${x.name} (${x.n})`).join('; '),
        cell: (r) =>
          r.people.length ? (
            <span className="text-xs">
              {r.people.slice(0, 4).map((x, i) => (
                <span key={x.key}>
                  {i > 0 && <span className={MUTED}> · </span>}
                  <PersonLink row={x} go={go} /> <span className={MUTED}>{int(x.n)}</span>
                </span>
              ))}
              {r.people.length > 4 && <span className={MUTED}> · +{r.people.length - 4}</span>}
            </span>
          ) : DASH,
      },
      { id: 'new', header: 'Creative mới', align: 'right', sortValue: (r) => r.agg.new, cell: (r) => (r.agg.new ? int(r.agg.new) : '') },
      { id: 'creatives', header: 'Đang chạy', align: 'right', sortValue: (r) => r.agg.creatives, cell: (r) => int(r.agg.creatives) },
      { id: 'win', header: `Win / ${testedLabel(team?.min_spend)}`, defaultHidden: true, sortValue: (r) => (r.agg.tested ? r.agg.win / r.agg.tested : null), csvValue: (r) => `${r.agg.win}/${r.agg.tested}`, className: 'min-w-40', cell: (r) => <WinBar a={r.agg} /> },
      { id: 'spend', header: 'Chi', align: 'right', sortValue: (r) => r.agg.spend, cell: (r) => usd(r.agg.spend) },
      { id: 'roas', header: 'ROAS QC', align: 'right', sortValue: (r) => creativeRoas(r.agg), csvValue: (r) => creativeRoas(r.agg), cell: (r) => <RoasWithDot a={r.agg} min={team?.min_spend} /> },
    ],
    [go, team?.min_spend],
  )

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex" role="group" aria-label="Cách xem phân bổ">
          {([['person', 'Theo người'], ['app', 'Theo app']] as const).map(([id, label], i) => (
            <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}
              className={`${BTN} ${i === 0 ? 'rounded-r-none' : '-ml-px rounded-l-none'} ${mode === id ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''}`}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'person' && <KindLegend kinds={usedKinds} />}
      </div>
      <CreativeNote q={creativeQ} what={mode === 'app' ? 'Số Kho creative' : 'App tập trung'} />
      <div className={team ? '' : 'mt-3'}>
        {mode === 'person' ? (
          rows.length ? (
            <DataTable key="person" tableId="ua-alloc-person" columns={personCols} rows={rows} rowKey={(r) => r.key} defaultSort={{ id: 'kinds', dir: 'desc' }} csvName={`ua-phan-bo-theo-nguoi_${s.from}_${s.to}`} />
          ) : <Empty>Chưa có hoạt động nào trong khoảng ngày này.</Empty>
        ) : apps.length ? (
          <DataTable key="app" tableId="ua-alloc-app-3" columns={appCols} rows={apps} rowKey={(r) => r.app} defaultSort={{ id: 'spend', dir: 'desc' }} csvName={`ua-phan-bo-theo-app_${s.from}_${s.to}`} />
        ) : team ? <Empty>Không có creative nào chạy trong khoảng ngày này.</Empty> : null}
      </div>
      <p className={`mt-3 text-xs ${MUTED}`}>
        {mode === 'person'
          ? <>Loại hoạt động đếm trong khoảng ngày đang chọn: creative đưa lên chạy và thao tác trên campaign qua ZooKeeper. App tập trung = tỉ lệ creative mới của người đó theo từng app.</>
          : <>Mỗi app: ai có creative trên app đó trong kỳ (số sau tên = số creative mới, không có creative mới thì là số đang chạy), cùng chi và ROAS quảng cáo của các creative đó. Tên app theo ZooKeeper.</>}{' '}
        <CreativeStamp q={creativeQ} />
      </p>
    </>
  )
}

// ----------------------------------------------------------------------------- Kết quả
/** known = có trang riêng (nằm trong danh sách người); tài khoản ZooKeeper khác chỉ hiện tên. */
type ResultRow = RosterRow & { cr: CreativeAgg; synthetic: boolean; known: boolean }
const RESULT_TOTAL = ['new', 'tested', 'winrate', 'spend', 'revenue', 'roas', 'creatives', 'not_ok', 'inferred']

export function Results(p: ViewProps) {
  const { s, roster, team, creativeQ, go } = p
  const rows = useMemo<ResultRow[]>(() => {
    if (!team) return []
    const inRoster = new Set(roster.map((r) => r.key))
    const out: ResultRow[] = []
    for (const r of roster) {
      const cr = creativeOf(team, r.key)
      if (cr) out.push({ ...r, cr, synthetic: false, known: true })
    }
    for (const cr of team.people) {
      if (inRoster.has(cr.person_key)) continue
      out.push({ key: cr.person_key, name: cr.person_key === '_unknown' ? 'Chưa rõ người lên' : cr.name, cr, synthetic: cr.person_key === '_unknown', known: false })
    }
    return out
  }, [roster, team])
  const columns = useMemo<Column<ResultRow>[]>(
    () => [
      { id: 'name', header: 'UA', locked: true, sortValue: (r) => r.name, cell: (r) => (r.known ? <PersonLink row={r} go={go} /> : <span className={r.synthetic ? MUTED : ''}>{r.name}</span>) },
      { id: 'new', header: 'Creative mới', align: 'right', sortValue: (r) => r.cr.new, cell: (r) => int(r.cr.new) },
      { id: 'tested', header: testedLabel(team?.min_spend).replace(/^c/, 'C'), align: 'right', defaultHidden: true, sortValue: (r) => r.cr.tested, cell: (r) => int(r.cr.tested) },
      { id: 'winrate', header: `Win / ${testedLabel(team?.min_spend)}`, className: 'min-w-44', defaultHidden: true, sortValue: (r) => (r.cr.tested ? r.cr.win / r.cr.tested : null), csvValue: (r) => `${r.cr.win}/${r.cr.tested}`, cell: (r) => <WinBar a={r.cr} /> },
      { id: 'spend', header: 'Chi', align: 'right', sortValue: (r) => r.cr.spend, cell: (r) => usd(r.cr.spend) },
      { id: 'revenue', header: 'Doanh thu Adjust', align: 'right', defaultHidden: true, sortValue: (r) => r.cr.revenue, cell: (r) => usd(r.cr.revenue) },
      {
        id: 'roas', header: 'ROAS QC', align: 'right', sortValue: (r) => creativeRoas(r.cr), csvValue: (r) => creativeRoas(r.cr),
        cell: (r) => <RoasWithDot a={r.cr} min={team?.min_spend} />,
        totalCell: (r) => <RoasWithDot a={r.cr} min={team?.min_spend} dot={false} />,
      },
      { id: 'creatives', header: 'Đang chạy', align: 'right', defaultHidden: true, sortValue: (r) => r.cr.creatives, cell: (r) => int(r.cr.creatives) },
      { id: 'not_ok', header: 'Dưới ngưỡng', align: 'right', defaultHidden: true, sortValue: (r) => r.cr.not_ok, cell: (r) => int(r.cr.not_ok) },
      { id: 'inferred', header: 'ZooKeeper suy ra', align: 'right', defaultHidden: true, sortValue: (r) => r.cr.inferred, cell: (r) => (r.cr.inferred ? int(r.cr.inferred) : '') },
    ],
    [go, team?.min_spend],
  )
  const total = useMemo<TotalRow<ResultRow> | undefined>(
    () => (team ? { row: { key: '_total', name: 'Tổng', cr: team.totals, synthetic: false, known: false }, columns: RESULT_TOTAL, label: 'Cả đội' } : undefined),
    [team],
  )
  return (
    <>
      <CreativeNote q={creativeQ} />
      {team && (rows.length ? (
        <DataTable tableId="ua-results-2" columns={columns} rows={rows} rowKey={(r) => r.key} defaultSort={{ id: 'spend', dir: 'desc' }}
          pinBottom={(r) => r.synthetic} totalRow={total} csvName={`ua-ket-qua_${s.from}_${s.to}`} />
      ) : <Empty>Không có creative nào chạy trong khoảng ngày này.</Empty>)}
      {team && (
        <p className={`mt-3 text-xs ${MUTED}`}>
          Creative mới = lên lần đầu trong kỳ. Chi và ROAS QC tính trên mọi creative của người đó có chạy trong kỳ (cả creative lên từ trước);
          ROAS QC = doanh thu Adjust / chi. Chấm xanh cạnh ROAS = có creative win trong kỳ, tức creative đã chi từ ${team.min_spend} và có
          ROAS quảng cáo từ {(team.roas_threshold * 100).toFixed(0)}%; rê chuột để xem số, hoặc bật hai cột ẩn sẵn trong nút "Cột".
          Số khớp màn Kho creative của ZooKeeper cho cùng khoảng ngày. Dòng Cả đội đếm mỗi creative một lần. Creative không ghi nhận được người
          lên được ZooKeeper gán cho người chạy app đó nhiều nhất; tên dạng email là tài khoản ZooKeeper chưa khai ở Thiết lập → Mapping người (bật cột "ZooKeeper suy ra" để xem bao nhiêu). Lãi theo app xem ở tab Tiền theo app.{' '}
          <CreativeStamp q={creativeQ} />
        </p>
      )}
    </>
  )
}
