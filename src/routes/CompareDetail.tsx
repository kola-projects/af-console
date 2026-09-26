import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { competitorComparison } from '../lib/queries'
import { Mono, Empty, Loading, ErrorBox, localTime } from '../components/ui'
import ComparisonView from '../components/ComparisonView'

export default function CompareDetail() {
  const slug = useParams().slug ?? ''
  const q = useQuery({ queryKey: ['comparison', slug], queryFn: () => competitorComparison(slug), enabled: !!slug })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const c = q.data
  if (!c) return <Empty>Không thấy bản so sánh này.</Empty>

  return (
    <div className="max-w-5xl">
      <div className="text-xs text-neutral-500">
        <Link to="/compare" className="no-underline hover:underline">So sánh</Link> / <Mono>{c.slug}</Mono>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">{c.name}</h1>
        <Mono className="rounded bg-primary-100 px-1.5 py-0.5 text-xs font-semibold text-primary-800 dark:bg-primary-950 dark:text-primary-300">{c.slug}</Mono>
        <span className="text-xs text-neutral-500">{c.eval_ids.length} app · cập nhật {localTime(c.updated_at)}</span>
      </div>
      {c.verdict && (
        <div className="mt-2 rounded-lg border border-primary-200 bg-primary-50/40 px-3 py-2 text-sm dark:border-primary-900 dark:bg-primary-950/20">
          <b>Verdict:</b> {c.verdict}
        </div>
      )}
      <div className="mt-5">
        <ComparisonView data={c.data} analysis={c.analysis_md} />
      </div>
    </div>
  )
}
