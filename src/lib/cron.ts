// [3.51.0] Cron jobs — truy vấn cho trang /cron-jobs (UA Manager + admin đọc — RLS; sửa/chạy chỉ admin — RPC).
// Cấu hình ở bảng cron_jobs, mỗi lần chạy một dòng cron_runs (input / steps / output / error).
// Lưu cấu hình và "Chạy ngay" đi qua RPC (migration 0058) — RPC tự kiểm admin và tự đồng bộ pg_cron.
import { supabase } from './supabase'

export type CronJob = {
  job_key: string
  name: string
  description: string | null
  function_name: string
  /** Biểu thức cron 5 trường, giờ UTC. */
  schedule: string
  params: Record<string, unknown>
  enabled: boolean
  updated_at: string
}
export type CronStep = { name: string; status: 'ok' | 'error'; ms: number; note: string }
export type CronRun = {
  id: number
  job_key: string
  trigger: 'cron' | 'manual'
  status: 'queued' | 'running' | 'success' | 'error'
  started_at: string
  finished_at: string | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  steps: CronStep[]
  error: string | null
}

export async function cronJobs(): Promise<CronJob[]> {
  const { data, error } = await supabase.from('cron_jobs').select('*').order('job_key')
  if (error) throw new Error(error.message)
  return (data ?? []) as CronJob[]
}

export async function cronRuns(jobKey: string, limit = 30): Promise<CronRun[]> {
  const { data, error } = await supabase
    .from('cron_runs').select('*').eq('job_key', jobKey).order('started_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as CronRun[]
}

export async function saveCronJob(jobKey: string, schedule: string, params: Record<string, unknown>, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('cron_job_save', { p_job_key: jobKey, p_schedule: schedule, p_params: params, p_enabled: enabled })
  if (error) throw new Error(error.message)
}

/** Chạy ngay. `input` = null ⇒ dùng tham số mặc định của job. Trả id lần chạy. */
export async function runCronJobNow(jobKey: string, input: Record<string, unknown> | null): Promise<number> {
  const { data, error } = await supabase.rpc('cron_job_run_now', { p_job_key: jobKey, p_input: input })
  if (error) throw new Error(error.message)
  return data as number
}

/** "m h * * *" (UTC) → "HH:MM" theo GMT+7; null nếu lịch không phải dạng chạy-mỗi-ngày. */
export function dailyTimeVN(schedule: string): string | null {
  const m = schedule.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/)
  if (!m) return null
  const min = Number(m[1]), hourUtc = Number(m[2])
  if (min > 59 || hourUtc > 23) return null
  const h = (hourUtc + 7) % 24
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** "HH:MM" theo GMT+7 → biểu thức cron chạy mỗi ngày, giờ UTC. */
export function dailyCronFromVN(time: string): string | null {
  const m = time.match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  return `${Number(m[2])} ${(Number(m[1]) + 17) % 24} * * *`
}

export type ScheduleKind = 'hourly' | 'daily' | 'custom'

/** Nhận dạng lịch để form hiện đúng lựa chọn: "M * * * *" = mỗi giờ, "M H * * *" = mỗi ngày. */
export function scheduleKind(schedule: string): ScheduleKind {
  if (/^\d{1,2}\s+\*\s+\*\s+\*\s+\*$/.test(schedule.trim())) return 'hourly'
  return dailyTimeVN(schedule) ? 'daily' : 'custom'
}

/** Diễn giải lịch bằng lời, giờ Việt Nam. */
export function describeSchedule(schedule: string): string {
  const s = schedule.trim()
  const hourly = s.match(/^(\d{1,2})\s+\*\s+\*\s+\*\s+\*$/)
  if (hourly) return `Chạy mỗi giờ, vào phút ${hourly[1].padStart(2, '0')}.`
  const everyN = s.match(/^(\d{1,2})\s+\*\/(\d{1,2})\s+\*\s+\*\s+\*$/)
  if (everyN) return `Chạy ${everyN[2]} giờ một lần, vào phút ${everyN[1].padStart(2, '0')}.`
  const daily = dailyTimeVN(s)
  if (daily) return `Chạy ${daily} giờ Việt Nam mỗi ngày.`
  return 'Lịch tuỳ biến — pg_cron tính theo giờ UTC (giờ Việt Nam trừ 7).'
}

/** Tầng dữ liệu của một lần chạy ua-report-sync (output.window.tier) → nhãn ngắn. */
export function tierLabel(r: CronRun): string | null {
  const tier = (r.output as { window?: { tier?: string } } | null)?.window?.tier
  if (tier === 'd0') return 'D0'
  if (tier === 'recent') return 'D0 → D-2'
  if (tier === 'sweep') return 'rà tháng'
  if (tier === 'manual') return 'khoảng chỉ định'
  return null
}

export function durationText(r: CronRun): string {
  if (!r.finished_at) return r.status === 'queued' ? 'đang chờ' : 'đang chạy'
  const ms = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
  return ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

/** Tóm tắt "vào → ra" của một lần chạy cho cột lịch sử. */
export function runSummary(r: CronRun): string {
  if (r.status === 'queued' || r.status === 'running') {
    const last = r.steps[r.steps.length - 1]
    return last ? `xong bước ${last.name}` : '—'
  }
  const o = r.output as { actions?: Record<string, number>; money?: Record<string, number>; failed_steps?: string[] } | null
  if (o?.actions || o?.money) {
    const a = o.actions, m = o.money
    const parts: string[] = []
    const tier = tierLabel(r)
    if (tier) parts.push(tier)
    if (a && typeof a.fetched === 'number') parts.push(`${a.fetched} thao tác → +${a.inserted ?? 0} mới`)
    if (m && typeof m.money_rows === 'number') parts.push(`${m.money_rows} dòng tiền → +${m.money_inserted ?? 0} bản chụp`)
    if (o.failed_steps?.length) parts.push(`lỗi ở ${o.failed_steps.join(', ')}`)
    if (parts.length) return parts.join(' · ')
  }
  return r.error ? r.error.slice(0, 120) : `${r.steps.length} bước`
}
