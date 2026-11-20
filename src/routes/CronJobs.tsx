// [3.51.0] Cron jobs — UA Manager + admin XEM (input / từng bước / output / lỗi của mỗi lần chạy, để debug);
// chỉ ADMIN sửa cấu hình (lịch, tham số, bật/tắt) và chạy tay. Lịch chạy do pg_cron giữ; "Lưu" và
// "Chạy ngay" đi qua RPC — RPC tự kiểm admin, giao diện chỉ ẩn nút cho gọn.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cronJobs,
  cronRuns,
  dailyCronFromVN,
  dailyTimeVN,
  describeSchedule,
  durationText,
  scheduleKind,
  runCronJobNow,
  runSummary,
  saveCronJob,
  type CronJob,
  type CronRun,
} from '../lib/cron'
import { myProfile } from '../lib/queries'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'

const INPUT =
  'rounded border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const BTN =
  'rounded border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900'
const PRIMARY = 'rounded bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-40'
const PRE =
  'overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-50 px-3 py-2 font-mono text-xs dark:bg-neutral-900'

function StatusBadge({ status }: { status: CronRun['status'] }) {
  if (status === 'success') return <Badge tone="good">Xong</Badge>
  if (status === 'error') return <Badge tone="bad">Lỗi</Badge>
  return <Badge tone="warn">{status === 'queued' ? 'Đang chờ' : 'Đang chạy'}</Badge>
}

function parseJsonObject(text: string): Record<string, unknown> {
  const v: unknown = JSON.parse(text)
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Phải là một object JSON, vd {"money_lookback_days": 7}.')
  return v as Record<string, unknown>
}

function RunDetail({ run, onRerun, busy }: { run: CronRun; onRerun?: (input: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <div className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold">
          Lần chạy #{run.id} · {localTime(run.started_at)} · {run.trigger === 'cron' ? 'theo lịch' : 'chạy tay'}
        </h3>
        <StatusBadge status={run.status} />
        {onRerun && <button className={BTN} disabled={busy} onClick={() => onRerun(run.input)}>Chạy lại với input này</button>}
      </div>

      {run.error && (
        <div className="mt-3">
          <div className="mb-1 text-xs text-neutral-500">Lỗi</div>
          <pre className={`${PRE} text-red-800 dark:text-red-200`}>{run.error}</pre>
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-neutral-500">Input</div>
          <pre className={PRE}>{JSON.stringify(run.input, null, 2)}</pre>
        </div>
        <div>
          <div className="mb-1 text-xs text-neutral-500">Output</div>
          <pre className={PRE}>{run.output ? JSON.stringify(run.output, null, 2) : 'chưa có'}</pre>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-xs text-neutral-500">Các bước</div>
        {run.steps.length === 0 ? (
          <div className="text-xs text-neutral-400">Chưa bước nào chạy.</div>
        ) : (
          <Table head={['Bước', 'Kết quả', 'Thời gian', 'Ghi chú']}>
            {run.steps.map((s, i) => (
              <Row key={`${s.name}-${i}`}>
                <Cell><Mono>{s.name}</Mono></Cell>
                <Cell><Badge tone={s.status === 'ok' ? 'good' : 'bad'}>{s.status === 'ok' ? 'ok' : 'lỗi'}</Badge></Cell>
                <Cell className="whitespace-nowrap tabular-nums">{s.ms < 1000 ? `${s.ms}ms` : `${(s.ms / 1000).toFixed(1)}s`}</Cell>
                <Cell><Mono className="break-all text-[11px] text-neutral-600 dark:text-neutral-400">{s.note}</Mono></Cell>
              </Row>
            ))}
          </Table>
        )}
      </div>
    </div>
  )
}

/** canEdit = admin. UA Manager chỉ XEM: form khoá, không có nút lưu / chạy (RPC phía DB cũng chặn). */
function JobCard({ job, canEdit }: { job: CronJob; canEdit: boolean }) {
  const qc = useQueryClient()
  const [schedule, setSchedule] = useState(job.schedule)
  const [params, setParams] = useState(JSON.stringify(job.params, null, 2))
  const [enabled, setEnabled] = useState(job.enabled)
  const [customInput, setCustomInput] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)

  // Cấu hình vừa lưu xong (hoặc đổi từ nơi khác) thì nạp lại form. So theo chuỗi JSON chứ không theo
  // object: mỗi lần tải lại danh sách job là một object mới, so object sẽ xoá mất chữ đang gõ dở.
  const savedParams = JSON.stringify(job.params, null, 2)
  useEffect(() => {
    setSchedule(job.schedule)
    setParams(savedParams)
    setEnabled(job.enabled)
  }, [job.schedule, savedParams, job.enabled])

  const runs = useQuery({
    queryKey: ['cron-runs', job.job_key],
    queryFn: () => cronRuns(job.job_key),
    // Có lần chạy dở thì tự làm mới để thấy từng bước chạy.
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued' || r.status === 'running') ? 2000 : false),
  })
  const refreshRuns = () => qc.invalidateQueries({ queryKey: ['cron-runs', job.job_key] })

  const save = useMutation({
    mutationFn: () => saveCronJob(job.job_key, schedule, parseJsonObject(params), enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cron-jobs'] }),
  })
  const run = useMutation({
    mutationFn: (input: Record<string, unknown> | null) => runCronJobNow(job.job_key, input),
    onSuccess: (id) => { setSelected(id); refreshRuns() },
  })

  const timeVN = dailyTimeVN(schedule)
  const kind = scheduleKind(schedule)
  const dirty = schedule !== job.schedule || enabled !== job.enabled || params !== savedParams
  const list = runs.data ?? []
  const active = list.some((r) => r.status === 'queued' || r.status === 'running')
  const detail = list.find((r) => r.id === selected) ?? null

  return (
    <section className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold">{job.name}</h2>
          <p className="text-sm text-neutral-500">{job.description}</p>
        </div>
        <Badge tone={job.enabled ? 'good' : 'neutral'}>{job.enabled ? 'Đang bật' : 'Đang tắt'}</Badge>
        {canEdit ? (
          <button className={PRIMARY} disabled={run.isPending || active} onClick={() => run.mutate(null)}>
            {active ? 'Đang chạy…' : 'Chạy ngay'}
          </button>
        ) : (
          active && <Badge tone="warn">Đang chạy</Badge>
        )}
      </div>
      {!canEdit && (
        <p className="mt-2 text-xs text-neutral-500">Bạn đang xem ở chế độ chỉ đọc — chỉ admin sửa cấu hình và chạy tay.</p>
      )}

      <fieldset disabled={!canEdit} className="mt-4 grid min-w-0 gap-3 disabled:opacity-70 md:grid-cols-4">
        <label className="grid gap-1 text-xs text-neutral-500">
          Tần suất
          <select
            className={INPUT}
            value={kind}
            onChange={(e) => {
              if (e.target.value === 'hourly') setSchedule('0 * * * *')
              else if (e.target.value === 'daily') setSchedule(dailyCronFromVN('07:00')!)
            }}
          >
            <option value="hourly">Mỗi giờ</option>
            <option value="daily">Mỗi ngày</option>
            {kind === 'custom' && <option value="custom">Tuỳ biến</option>}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-neutral-500">
          Giờ chạy (giờ Việt Nam)
          <input
            type="time"
            className={INPUT}
            value={timeVN ?? ''}
            disabled={kind !== 'daily'}
            onChange={(e) => { const c = dailyCronFromVN(e.target.value); if (c) setSchedule(c) }}
          />
        </label>
        <label className="grid gap-1 text-xs text-neutral-500">
          Biểu thức cron (giờ UTC)
          <input className={`${INPUT} font-mono`} value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        </label>
        <label className="flex items-end gap-2 pb-1 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Bật chạy theo lịch
        </label>
        <label className="grid gap-1 text-xs text-neutral-500 md:col-span-4">
          Tham số mặc định (JSON) — input của mỗi lần chạy theo lịch
          <textarea className={`${INPUT} h-24 font-mono text-xs`} value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} />
        </label>
      </fieldset>
      <p className="mt-1 text-xs text-neutral-500">
        {describeSchedule(schedule)} Edge function: <Mono>{job.function_name}</Mono>.
      </p>
      {job.job_key === 'ua-report-sync' && (
        <p className="mt-1 text-xs text-neutral-500">
          Tiền lấy theo 3 tầng: <b>D0</b> mỗi lần chạy · <b>D-1 … D-{String(job.params.recent_days ?? 2)}</b> mỗi{' '}
          {String(job.params.recent_every_hours ?? 3)} giờ · <b>ngày cũ hơn</b> rà lại mỗi {String(job.params.sweep_every_days ?? 30)} ngày
          (lùi {String(job.params.sweep_lookback_days ?? 62)} ngày). Job tự chọn tầng theo lịch sử chạy; cột "Vào → ra" ghi tầng của từng lần.
        </p>
      )}
      {save.error && <div className="mt-2"><ErrorBox error={save.error} /></div>}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className={BTN} disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Đang lưu…' : 'Lưu cấu hình'}
          </button>
          <button className="text-xs text-neutral-500 underline" onClick={() => setShowCustom(!showCustom)}>
            {showCustom ? 'Ẩn chạy với input riêng' : 'Chạy với input riêng (vd nạp lại một khoảng ngày)'}
          </button>
        </div>
      )}

      {canEdit && showCustom && (
        <div className="mt-3 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900">
          <textarea
            className={`${INPUT} h-20 w-full font-mono text-xs`}
            placeholder={'{"date_from": "2026-11-01", "date_to": "2026-11-12"}'}
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            spellCheck={false}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              className={BTN}
              disabled={run.isPending || active || !customInput.trim()}
              onClick={() => { try { run.mutate(parseJsonObject(customInput)) } catch (e) { window.alert(e instanceof Error ? e.message : String(e)) } }}
            >
              Chạy với input này
            </button>
            <span className="text-xs text-neutral-500">Chạy lại một khoảng ngày không tạo dòng trùng.</span>
          </div>
        </div>
      )}
      {run.error && <div className="mt-2"><ErrorBox error={run.error} /></div>}

      <h3 className="mb-1 mt-6 text-sm font-semibold">Lịch sử chạy</h3>
      {runs.error ? (
        <ErrorBox error={runs.error} />
      ) : runs.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>Chưa chạy lần nào.</Empty>
      ) : (
        <Table head={['#', 'Bắt đầu', 'Nguồn', 'Kết quả', 'Thời gian', 'Vào → ra']}>
          {list.map((r) => (
            <Row
              key={r.id}
              onClick={() => setSelected(selected === r.id ? null : r.id)}
              className={selected === r.id ? 'bg-neutral-50 dark:bg-neutral-900' : ''}
            >
              <Cell><Mono>{r.id}</Mono></Cell>
              <Cell className="whitespace-nowrap"><Mono>{localTime(r.started_at)}</Mono></Cell>
              <Cell>{r.trigger === 'cron' ? 'lịch' : 'tay'}</Cell>
              <Cell><StatusBadge status={r.status} /></Cell>
              <Cell className="whitespace-nowrap tabular-nums">{durationText(r)}</Cell>
              <Cell className="text-xs text-neutral-600 dark:text-neutral-400">{runSummary(r)}</Cell>
            </Row>
          ))}
        </Table>
      )}
      {detail && <RunDetail run={detail} busy={run.isPending || active} onRerun={canEdit ? (input) => run.mutate(input) : undefined} />}
    </section>
  )
}

export default function CronJobs() {
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  const jobs = useQuery({ queryKey: ['cron-jobs'], queryFn: cronJobs })
  const canEdit = me.data?.role === 'admin'
  return (
    <div>
      <h1 className="text-lg">Cron jobs</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Job chạy định kỳ của af-console. Bấm một lần chạy để xem input, từng bước, output và lỗi.
        {canEdit && ' Admin sửa được lịch và tham số, bật/tắt, và chạy tay.'}
      </p>
      {jobs.error ? (
        <div className="mt-4"><ErrorBox error={jobs.error} /></div>
      ) : jobs.isLoading ? (
        <Loading />
      ) : !jobs.data?.length ? (
        <div className="mt-4"><Empty>Chưa có cron job nào.</Empty></div>
      ) : (
        jobs.data.map((j) => <JobCard key={j.job_key} job={j} canEdit={canEdit} />)
      )}
    </div>
  )
}
