import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { appsWithRuns, appIcon } from '../lib/queries'
import { latestBlueprintRun } from './appMeta'
import { appCodeOf, type AppRow } from '../lib/types'
import { b64ToDataURL, mimeOf } from '../lib/blueprint'

/** Ô tìm app giàu: icon + tên (+team) + packageName; lọc theo code | name | packageName.
 *  Dropdown dài, cuộn. Trả về app_code qua onChange. Tái dùng nhiều nơi. */
const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '')
const INPUT = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 dark:border-neutral-700 dark:bg-neutral-900'

export function AppIcon({ app }: { app: AppRow }) {
  const run = latestBlueprintRun(app)
  const q = useQuery({ queryKey: ['app-icon', run], queryFn: () => appIcon(run!), enabled: !!run })
  const url = q.data ? b64ToDataURL(q.data.content_b64, mimeOf(q.data.path, q.data.content_type)) : null
  return url
    ? <img src={url} alt="" className="h-9 w-9 flex-none rounded-lg object-cover" />
    : <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-neutral-200 text-sm font-bold text-neutral-500 dark:bg-neutral-700">{(app.name || '?')[0]?.toUpperCase()}</div>
}

export default function AppSearchSelect({ value, onChange, placeholder }: { value: string; onChange: (code: string) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const appsQ = useQuery({ queryKey: ['apps-with-runs'], queryFn: appsWithRuns })

  const filtered = useMemo(() => {
    const n = norm(q)
    const apps = (appsQ.data ?? []).filter((a) => !a.is_hidden)
    if (!n) return apps.slice(0, 60)
    return apps.filter((a) => norm(appCodeOf(a) || '').includes(n) || norm(a.name).includes(n) || norm(a.package_name || '').includes(n)).slice(0, 60)
  }, [appsQ.data, q])

  const selected = (appsQ.data ?? []).find((a) => appCodeOf(a) === value)

  return (
    <div className="relative">
      <input
        value={open ? q : (selected ? `${appCodeOf(selected)} · ${selected.name}` : q)}
        onFocus={() => { setOpen(true); setQ('') }}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        placeholder={placeholder || 'Tìm kiếm app…'}
        className={INPUT}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-[26rem] w-full overflow-auto rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          {appsQ.isLoading ? (
            <div className="p-3 text-sm text-neutral-400">đang tải app…</div>
          ) : !filtered.length ? (
            <div className="p-3 text-sm text-neutral-400">không thấy app khớp “{q}”</div>
          ) : (
            filtered.map((a) => (
              <button key={a.id} type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(appCodeOf(a) || ''); setOpen(false); setQ('') }}
                className={`flex w-full items-center gap-3 border-b border-neutral-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-neutral-100 dark:border-neutral-800/60 dark:hover:bg-neutral-800 ${appCodeOf(a) === value ? 'bg-teal-50 dark:bg-teal-950' : ''}`}>
                <AppIcon app={a} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name}{a.team ? <span className="font-normal text-neutral-400"> · {a.team}</span> : null}</div>
                  <div className="truncate font-mono text-xs text-neutral-400">{a.package_name || '—'}</div>
                </div>
                <span className="flex-none font-mono text-xs text-neutral-500">{appCodeOf(a)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
