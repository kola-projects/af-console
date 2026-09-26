import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { competitors, competitorComparisons, allCompetitorSessions } from '../lib/queries'
import { buildCompare, sessionToApp } from '../lib/compare'
import { Mono, Empty, Loading, ErrorBox, localTime } from '../components/ui'
import ComparisonView from '../components/ComparisonView'
import type { CompetitorSession } from '../lib/types'

export default function Compare() {
  const saved = useQuery({ queryKey: ['comparisons'], queryFn: competitorComparisons })
  const comps = useQuery({ queryKey: ['competitors'], queryFn: competitors })
  const sessQ = useQuery({ queryKey: ['all-competitor-sessions'], queryFn: allCompetitorSessions })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [tagFilter, setTagFilter] = useState('')

  // phiên mới nhất / package
  const latestByPkg = useMemo(() => {
    const m = new Map<string, CompetitorSession>()
    for (const s of sessQ.data ?? []) if (!m.has(s.package_name)) m.set(s.package_name, s)
    return m
  }, [sessQ.data])
  const compByPkg = useMemo(() => new Map((comps.data ?? []).map((c) => [c.package_name, c])), [comps.data])

  const allTags = useMemo(
    () => [...new Set((comps.data ?? []).flatMap((c) => c.tags ?? []))].sort(),
    [comps.data],
  )
  const pickable = useMemo(
    () => (comps.data ?? []).filter((c) => !tagFilter || (c.tags ?? []).includes(tagFilter)),
    [comps.data, tagFilter],
  )

  const adhoc = useMemo(() => {
    const apps = [...picked]
      .map((pkg) => {
        const s = latestByPkg.get(pkg)
        return s ? sessionToApp(s, compByPkg.get(pkg)) : null
      })
      .filter((a): a is NonNullable<typeof a> => !!a)
    return apps.length >= 2 ? buildCompare(apps, `Ad-hoc (${apps.length} app)`) : null
  }, [picked, latestByPkg, compByPkg])

  if (saved.isLoading || comps.isLoading) return <Loading />
  if (saved.error) return <ErrorBox error={saved.error} />

  const toggle = (pkg: string) =>
    setPicked((s) => {
      const n = new Set(s)
      n.has(pkg) ? n.delete(pkg) : n.add(pkg)
      return n
    })

  return (
    <div className="max-w-5xl">
      <h1 className="text-lg">So sánh đối thủ</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Ma trận tính năng · monetization · định vị · pain-point giữa nhiều đánh giá cùng dòng. Bản lưu do <Mono>compare.sh</Mono> sinh; hoặc tự chọn app để xem nhanh (ad-hoc).
      </p>

      {/* Builder tương tác */}
      <section className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Chọn app để so sánh nhanh</h2>
          <select
            className="rounded border border-neutral-300 bg-transparent px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="">Mọi tag</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="ml-auto text-xs text-neutral-500">{picked.size} chọn</span>
          {picked.size > 0 && (
            <button className="text-xs text-neutral-500 underline" onClick={() => setPicked(new Set())}>bỏ chọn</button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pickable.map((c) => {
            const on = picked.has(c.package_name)
            const hasSession = latestByPkg.has(c.package_name)
            return (
              <button
                key={c.id}
                disabled={!hasSession}
                onClick={() => toggle(c.package_name)}
                title={hasSession ? '' : 'chưa có phiên đánh giá'}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  on
                    ? 'border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300'
                    : hasSession
                      ? 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900'
                      : 'cursor-not-allowed border-neutral-200 text-neutral-300 dark:border-neutral-800 dark:text-neutral-700'
                }`}
              >
                {on ? '✓ ' : ''}{c.name ?? c.package_name}
              </button>
            )
          })}
        </div>
        {picked.size === 1 && <p className="mt-2 text-xs text-neutral-400">Chọn thêm ≥1 app nữa để so sánh.</p>}
      </section>

      {adhoc && (
        <section className="mt-4">
          <div className="mb-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
            Bản xem nhanh (ad-hoc, không lưu). Muốn lưu + có phần diễn giải agent, chạy:{' '}
            <Mono className="text-[11px]">./compare.sh {adhoc.meta?.eval_ids?.join(',')} --analyze --push</Mono>
          </div>
          <ComparisonView data={adhoc} />
        </section>
      )}

      {/* Bản đã lưu */}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Bản so sánh đã lưu ({saved.data?.length ?? 0})</h2>
        {(saved.data ?? []).length === 0 ? (
          <Empty>Chưa có bản lưu. Chạy <Mono>./compare.sh EV-A,EV-B --push</Mono>.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(saved.data ?? []).map((c) => (
              <Link
                key={c.slug}
                to={`/compare/${c.slug}`}
                className="rounded-xl border border-neutral-200 p-4 no-underline hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
              >
                <div className="flex items-center gap-2">
                  <Mono className="rounded bg-primary-100 px-1.5 py-0.5 text-[11px] font-semibold text-primary-800 dark:bg-primary-950 dark:text-primary-300">{c.slug}</Mono>
                  <span className="font-medium">{c.name}</span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">{c.eval_ids.length} app · {c.eval_ids.join(', ')}</div>
                {c.verdict && <div className="mt-1 text-xs">{c.verdict}</div>}
                <div className="mt-1 text-[11px] text-neutral-400">Cập nhật {localTime(c.updated_at)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
