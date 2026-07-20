import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchBugs } from '../lib/queries'
import type { BugCategory } from '../lib/types'
import { CategoryBadge, Empty, ErrorBox, Loading, Mono } from '../components/ui'

const CATEGORIES: BugCategory[] = [
  'build_fail',
  'runtime_only',
  'logic_compile_ok',
  'ui_theme',
  'api_contract',
  'permission',
  'config',
  'dependency',
  'other',
]

/** Bản web của `af_db query bugs --error`. Tra bằng CHỮ KÝ lỗi (tên exception,
 *  tên symbol) chứ không phải mô tả bằng lời — đó là lý do cột error_signature
 *  được đánh index ngay từ 0001. */
export default function Bugs() {
  const [sig, setSig] = useState('')
  const [cat, setCat] = useState('')
  const q = useQuery({
    queryKey: ['bugs', sig, cat],
    queryFn: () => searchBugs(sig, cat || undefined),
  })

  return (
    <div>
      <h1 className="text-lg">Bugs</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Tra bằng chữ ký lỗi: tên exception, tên symbol, dòng compiler đọc được.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={sig}
          onChange={(e) => setSig(e.target.value)}
          placeholder="ActivityNotFoundException UCropActivity"
          className="min-w-72 flex-1 rounded border border-neutral-300 px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">mọi category</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <Empty>
            Chưa gặp lỗi nào khớp.
            <br />
            <span className="text-xs">Với agent thì đây là tín hiệu: tự suy luận, rồi NHỚ ghi lại.</span>
          </Empty>
        ) : (
          <div className="space-y-3">
            {q.data.map((b) => (
              <div
                key={b.id}
                className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryBadge category={b.category} />
                  <span className="text-sm">{b.title}</span>
                  <Mono className="ml-auto text-neutral-500">
                    run #{b.run_id} · {b.detected_by ?? '—'}
                  </Mono>
                </div>
                {b.error_signature && (
                  <div className="mt-1">
                    <Mono className="text-neutral-500">{b.error_signature}</Mono>
                  </div>
                )}
                {b.root_cause && (
                  <div className="mt-2 text-sm">
                    <span className="text-neutral-500">gốc rễ: </span>
                    {b.root_cause}
                  </div>
                )}
                {b.fix && (
                  <div className="text-sm">
                    <span className="text-neutral-500">fix: </span>
                    {b.fix}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
