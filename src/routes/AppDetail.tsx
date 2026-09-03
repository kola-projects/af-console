import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  appDetail,
  appDetailPublic,
  appLearning,
  appNewLessons,
  asoZipBytes,
  productAppAssets,
} from '../lib/queries'
import { appCodeOf } from '../lib/types'
import type { AppRow, RunLearningRow } from '../lib/types'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import {
  AppIcon,
  PackageName,
  appLastUpdate,
  blueprintRuns as blueprintRunsOf,
  latestBlueprintRun,
} from '../components/appMeta'
import HtmlMockupView from './blueprint/HtmlMockupView'

const btnCls =
  'inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm no-underline dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900'

/** /apps/:id — DANH MỤC SẢN PHẨM (mọi user): bản CURATED, chỉ ASO / Design preview
 *  / Legal (RLS 0023 lọc blueprint về whitelist). KHÔNG lộ run/lessons/spec. */
export default function ProductAppDetail() {
  const id = Number(useParams().id)
  const q = useQuery({ queryKey: ['app-product', id], queryFn: () => appDetailPublic(id) })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data) return <Empty>Không thấy app này.</Empty>
  return <CuratedDetail app={q.data} />
}

/** /manage-apps/:id — QUẢN LÝ (admin): đầy đủ run/blueprint/lessons. */
export function ManageAppDetail() {
  const id = Number(useParams().id)
  const q = useQuery({ queryKey: ['app-manage', id], queryFn: () => appDetail(id) })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data) return <Empty>Không thấy app này.</Empty>
  return <Detail app={q.data} />
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold">{children}</h2>
}

/** Bản sản phẩm (curated) — trang thân thiện kiểu listing: hero + screenshots +
 *  mô tả + có gì mới + design preview + legal. Đọc asset từ blueprint whitelisted. */
function CuratedDetail({ app }: { app: AppRow }) {
  const runName = latestBlueprintRun(app)
  const assets = useQuery({
    queryKey: ['product-assets', runName],
    queryFn: () => productAppAssets(runName!),
    enabled: !!runName,
    staleTime: 5 * 60_000,
  })
  const [showMockup, setShowMockup] = useState(false)
  const [showLanding, setShowLanding] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)
  const [zipErr, setZipErr] = useState<string | null>(null)
  const a = assets.data
  const title = a?.title || app.name
  const hasAso = !!(
    a &&
    (a.title ||
      a.icon ||
      a.featureGraphic ||
      a.screenshots.length ||
      a.fullDesc ||
      a.landingHtml ||
      a.reviewNotesMd ||
      a.landingUrl)
  )

  async function downloadAso() {
    if (!runName) return
    setZipping(true)
    setZipErr(null)
    try {
      const bytes = await asoZipBytes(runName)
      const blob = new Blob([bytes.slice()], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a')
      el.href = url
      el.download = `${appCodeOf(app) || 'app'}-aso.zip`
      document.body.appendChild(el)
      el.click()
      el.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setZipErr(e instanceof Error ? e.message : String(e))
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <Link to="/apps" className="text-sm text-neutral-500 underline underline-offset-2">
        ← Apps
      </Link>

      {/* Hero */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
        {a?.featureGraphic ? (
          <img src={a.featureGraphic} alt="" className="h-40 w-full object-cover" />
        ) : (
          <div className="h-20 bg-gradient-to-br from-neutral-200 to-neutral-100 dark:from-neutral-800 dark:to-neutral-950" />
        )}
        <div className="flex gap-4 p-4">
          <div className="-mt-12 flex-none">
            {a?.icon ? (
              <img
                src={a.icon}
                alt=""
                className="h-20 w-20 rounded-2xl border-4 border-white object-cover dark:border-neutral-900"
              />
            ) : (
              <AppIcon app={app} size={72} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {appCodeOf(app) && (
              <Mono className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-semibold dark:bg-neutral-800">
                {appCodeOf(app)}
              </Mono>
            )}
            <h1 className="mt-1 text-xl font-semibold">{title}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <PackageName app={app} />
              <span>·</span>
              <span>tạo {localTime(app.created_at)}</span>
            </div>
            {a?.landingUrl && (
              <a
                href={a.landingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-primary-600 hover:underline dark:text-primary-400"
                title="Mở trang giới thiệu app (landing page)"
              >
                🌐 <span className="truncate">{a.landingUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                <span aria-hidden>↗</span>
              </a>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {hasAso && (
                <button onClick={downloadAso} disabled={zipping} className={`${btnCls} border-transparent bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50`}>
                  📦 {zipping ? 'Đang nén…' : 'Tải aso.zip'}
                </button>
              )}
              {a?.legal.privacyUrl && (
                <a href={a.legal.privacyUrl} target="_blank" rel="noreferrer" className={btnCls}>
                  🔒 Privacy Policy
                  {a.legal.verdict && <Badge tone="good">{a.legal.verdict}</Badge>}
                </a>
              )}
              {a?.legal.termsUrl && (
                <a href={a.legal.termsUrl} target="_blank" rel="noreferrer" className={btnCls}>
                  📄 Terms
                </a>
              )}
              {a?.landingUrl && (
                <a href={a.landingUrl} target="_blank" rel="noreferrer" className={btnCls}>
                  🌐 Landing page
                </a>
              )}
              {a?.supportUrl && !a?.legal.privacyUrl && (
                <a href={a.supportUrl} target="_blank" rel="noreferrer" className={btnCls}>
                  🛟 Support
                </a>
              )}
              <span
                className={`${btnCls} cursor-not-allowed opacity-40`}
                title="Sắp có ở bản tích hợp CI/CD"
              >
                ⬇️ Tải APK (sắp có)
              </span>
            </div>
            {zipErr && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{zipErr}</div>}
          </div>
        </div>
      </div>

      {!runName && (
        <div className="mt-6">
          <Empty>App này chưa có tài nguyên để xem (chưa push blueprint).</Empty>
        </div>
      )}
      {assets.isLoading && <div className="mt-6"><Loading /></div>}
      {assets.error && <div className="mt-6"><ErrorBox error={assets.error} /></div>}

      {a && (
        <>
          {a.screenshots.length > 0 && (
            <section className="mt-8">
              <SectionTitle>Ảnh chụp màn hình</SectionTitle>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {a.screenshots.map((s, i) => (
                  <img
                    key={i}
                    src={s}
                    alt=""
                    className="h-72 flex-none rounded-xl border border-neutral-200 dark:border-neutral-800"
                  />
                ))}
              </div>
            </section>
          )}

          {a.shortDesc && (
            <section className="mt-8">
              <SectionTitle>Mô tả ngắn</SectionTitle>
              <div className="rounded-r-lg border-l-2 border-blue-500 bg-neutral-50 px-4 py-3 text-sm dark:bg-neutral-900">
                {a.shortDesc}
              </div>
            </section>
          )}

          {a.fullDesc && (
            <section className="mt-8">
              <SectionTitle>Mô tả đầy đủ</SectionTitle>
              <div className="whitespace-pre-line text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                {a.fullDesc}
              </div>
            </section>
          )}

          {a.releaseNotes && (
            <section className="mt-8">
              <SectionTitle>Có gì mới</SectionTitle>
              <div className="whitespace-pre-line rounded-lg border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
                {a.releaseNotes}
              </div>
            </section>
          )}

          {a.landingHtml && (
            <section className="mt-8">
              <SectionTitle>Landing page</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setShowLanding((v) => !v)} className={btnCls}>
                  {showLanding ? 'Ẩn' : 'Xem'} landing page
                </button>
                {a.landingUrl && (
                  <a href={a.landingUrl} target="_blank" rel="noreferrer" className={btnCls}>
                    ↗ Mở bản live
                  </a>
                )}
                <span className="text-xs text-neutral-500">
                  Marketing URL — trang giới thiệu app (dán vào App Store Connect ▸ App Information).
                </span>
              </div>
              {showLanding && (
                <iframe
                  title="landing"
                  srcDoc={a.landingHtml}
                  className="mt-3 h-[75vh] w-full rounded-lg border border-neutral-200 dark:border-neutral-800"
                  sandbox=""
                />
              )}
            </section>
          )}

          {a.reviewNotesMd && (
            <section className="mt-8">
              <SectionTitle>Reviewer notes (App Review Information)</SectionTitle>
              <button onClick={() => setShowReview((v) => !v)} className={btnCls}>
                {showReview ? 'Ẩn' : 'Xem'} ghi chú cho reviewer
              </button>
              {showReview && (
                <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
                  {a.reviewNotesMd}
                </pre>
              )}
            </section>
          )}

          {(a.designImages.length > 0 || a.hasDesignIndex) && (
            <section className="mt-8">
              <SectionTitle>Design preview</SectionTitle>
              {(() => {
                const imgs = [...a.designImages].sort((x, y) => x.path.localeCompare(y.path))
                const screens = imgs.filter((d) => d.path.includes('/screens/'))
                const assets = imgs.filter((d) => !d.path.includes('/screens/'))
                const label = (p: string) =>
                  (p.split('/').pop() || p).replace(/\.[a-z]+$/i, '').replace(/^\d+[_-]?/, '').replace(/[_-]/g, ' ')
                return (
                  <>
                    {screens.length > 0 && (
                      <>
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-neutral-500">
                          Màn hình ({screens.length}) — storyboard app đã build, khỏi cài
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                          {screens.map((d) => (
                            <button
                              key={d.path}
                              onClick={() => setZoom(d.dataUri)}
                              className="group overflow-hidden rounded-xl border border-neutral-200 bg-black p-0 text-left dark:border-neutral-800"
                              title={label(d.path)}
                            >
                              <img
                                src={d.dataUri}
                                alt={label(d.path)}
                                className="aspect-[9/19] w-full object-cover object-top transition group-hover:opacity-90"
                              />
                              <div className="truncate bg-neutral-50 px-2 py-1 text-[11px] capitalize text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                                {label(d.path)}
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {assets.length > 0 && (
                      <>
                        <div className="mb-2 mt-6 text-[11px] uppercase tracking-wide text-neutral-500">
                          Design assets ({assets.length})
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {assets.map((d) => (
                            <button
                              key={d.path}
                              onClick={() => setZoom(d.dataUri)}
                              className="overflow-hidden rounded-lg border border-neutral-200 p-0 dark:border-neutral-800"
                              title={label(d.path)}
                            >
                              <img
                                src={d.dataUri}
                                alt=""
                                className="h-32 w-full bg-neutral-50 object-contain dark:bg-neutral-900"
                              />
                              <div className="truncate px-2 py-1 text-[11px] text-neutral-500">
                                {d.path.split('/').pop()}
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )
              })()}
              {a.hasDesignIndex && runName && (
                <div className="mt-3">
                  <button onClick={() => setShowMockup((v) => !v)} className={btnCls}>
                    {showMockup ? 'Ẩn' : 'Xem'} mockup đầy đủ
                  </button>
                  {showMockup && (
                    <div className="mt-3 h-[70vh] overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
                      <HtmlMockupView runName={runName} path="design_previews/index.html" />
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <section className="mt-8">
        <SectionTitle>Tải bản build</SectionTitle>
        <div className="rounded-lg border border-dashed border-neutral-300 px-4 py-4 text-sm text-neutral-500 dark:border-neutral-700">
          ⬇️ Debug / Release APK — <b>sắp có</b> (tích hợp CI/CD ở session sau).
        </div>
      </section>

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(null)}
        >
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  )
}

function Detail({ app }: { app: AppRow }) {
  const runIds = useMemo(() => app.runs.map((r) => r.id), [app])
  const learning = useQuery({
    queryKey: ['app-learning', app.id],
    queryFn: () => appLearning(runIds),
  })
  const fresh = useQuery({
    queryKey: ['app-new-lessons', app.id],
    queryFn: () => appNewLessons(runIds),
  })
  const runName = useMemo(
    () => new Map(app.runs.map((r) => [r.id, r.run_name ?? `#${r.id}`])),
    [app],
  )

  const blueprintRuns = blueprintRunsOf(app)

  return (
    <div>
      <Link to="/manage-apps" className="text-sm text-neutral-500 underline underline-offset-2">
        ← Quản lý app
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <AppIcon app={app} size={48} />
        <div>
          <h1 className="flex items-center gap-2 text-lg">
            {appCodeOf(app) && (
              <Mono className="rounded bg-neutral-200 px-1.5 py-0.5 text-sm font-semibold dark:bg-neutral-800">
                {appCodeOf(app)}
              </Mono>
            )}
            {app.name}
          </h1>
          <div className="flex flex-wrap gap-2 text-sm text-neutral-500">
            <PackageName app={app} />
            <span>·</span>
            <Mono>{app.source_kind}</Mono>
            <span>·</span>
            <span>tạo {localTime(app.created_at)}</span>
            <span>·</span>
            <span>last update {localTime(appLastUpdate(app))}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-8">
        <section>
          <h2 className="text-sm font-medium text-neutral-500">Runs ({app.runs.length})</h2>
          {!app.runs.length ? (
            <Empty>App này chưa có run nào.</Empty>
          ) : (
            <div className="mt-2">
              <Table head={['Run', 'Job', 'af_version', 'Trạng thái', 'Blueprint', 'Bắt đầu']}>
                {app.runs.map((r) => (
                  <Row key={r.id}>
                    <Cell>
                      <Link to={`/runs/${r.id}`} className="underline underline-offset-2">
                        <Mono>{r.run_name ?? `#${r.id}`}</Mono>
                      </Link>
                    </Cell>
                    <Cell>
                      <Mono className="text-neutral-500">{r.job_kind}</Mono>
                    </Cell>
                    <Cell>
                      <Mono>{r.af_version ?? '—'}</Mono>
                    </Cell>
                    <Cell>
                      {r.status === 'completed' ? (
                        <Badge tone="good">completed</Badge>
                      ) : r.status === 'failed' ? (
                        <Badge tone="bad">failed</Badge>
                      ) : (
                        <Badge>{r.status}</Badge>
                      )}
                    </Cell>
                    <Cell>
                      {typeof r.extra?.blueprint_run === 'string' ? (
                        <Link
                          to={`/runs/${r.id}?tab=blueprint`}
                          className="underline underline-offset-2"
                        >
                          xem
                        </Link>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </Cell>
                    <Cell className="text-neutral-500">{localTime(r.started_at)}</Cell>
                  </Row>
                ))}
              </Table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-500">
            Blueprints ({blueprintRuns.length})
          </h2>
          {!blueprintRuns.length ? (
            <p className="mt-1 text-sm text-neutral-500">
              (chưa run nào push blueprint — <Mono>af_db blueprint-push</Mono> ở cuối phase06)
            </p>
          ) : (
            <div className="mt-2 space-y-1">
              {blueprintRuns.map((r) => (
                <div key={r.id} className="text-sm">
                  <Link to={`/runs/${r.id}?tab=blueprint`} className="underline underline-offset-2">
                    <Mono>{String(r.extra?.blueprint_run)}</Mono>
                  </Link>{' '}
                  <span className="text-xs text-neutral-500">({localTime(r.started_at)})</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <LearningSections
          learning={learning.data}
          learningError={learning.error}
          learningLoading={learning.isLoading}
          freshRows={fresh.data}
          freshError={fresh.error}
          runName={runName}
        />
      </div>
    </div>
  )
}

/** Gom (run × lesson) của MỌI run thành theo-LESSON: một lesson bơm vào 3 run của
 *  app thì hiện MỘT dòng với 3 phán quyết — đúng câu hỏi "app này đã học gì từ quá khứ". */
function LearningSections({
  learning,
  learningError,
  learningLoading,
  freshRows,
  freshError,
  runName,
}: {
  learning: RunLearningRow[] | undefined
  learningError: unknown
  learningLoading: boolean
  freshRows: import('../lib/types').AppNewLesson[] | undefined
  freshError: unknown
  runName: Map<number, string>
}) {
  const byLesson = useMemo(() => {
    const m = new Map<number, RunLearningRow[]>()
    for (const row of learning ?? []) {
      const arr = m.get(row.lesson_id) ?? []
      arr.push(row)
      m.set(row.lesson_id, arr)
    }
    return [...m.entries()]
  }, [learning])

  if (learningLoading) return <Loading />
  const err = learningError || freshError
  if (err) return <ErrorBox error={err} />

  return (
    <>
      <section>
        <h2 className="text-sm font-medium text-neutral-500">
          Lessons quá khứ đã áp vào app ({byLesson.length})
        </h2>
        {!byLesson.length ? (
          <p className="mt-1 text-sm text-neutral-500">
            (chưa có retrieval nào — run trước v3.8, hoặc prefetch chưa chạy)
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {byLesson.map(([lessonId, rows]) => (
              <div key={lessonId} className="text-sm">
                <Mono className="text-neutral-500">#{lessonId}</Mono> {rows[0].title}{' '}
                <span className="text-xs text-neutral-400">
                  (<Mono className="text-xs">{rows[0].slug}</Mono>)
                </span>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                  {rows.map((r) => (
                    <span key={r.run_id}>
                      <DispositionBadge d={r.disposition} />{' '}
                      <Mono className="text-xs">{runName.get(r.run_id) ?? `#${r.run_id}`}</Mono>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">
          Lessons app này sinh ra mới ({freshRows?.length ?? 0})
        </h2>
        {!(freshRows ?? []).length ? (
          <p className="mt-1 text-sm text-neutral-500">(không có)</p>
        ) : (
          <div className="mt-2 space-y-1">
            {(freshRows ?? []).map((o) => (
              <div key={`${o.run_id}-${o.lesson_id}`} className="text-sm">
                <Mono className="text-neutral-500">#{o.lesson_id}</Mono> {o.lessons?.title ?? '—'}{' '}
                {o.lessons && <Badge>{o.lessons.status}</Badge>}
                <span className="ml-1 text-xs text-neutral-400">
                  từ <Mono className="text-xs">{o.run_id ? (runName.get(o.run_id) ?? `#${o.run_id}`) : '—'}</Mono>
                </span>
                {o.note && <div className="text-xs text-neutral-500">{o.note}</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function DispositionBadge({ d }: { d: RunLearningRow['disposition'] }) {
  return d === 'applied_prevented' ? (
    <Badge tone="good">applied</Badge>
  ) : d === 'contradicted' ? (
    <Badge tone="bad">contradicted</Badge>
  ) : d === 'not_relevant' ? (
    <Badge>not relevant</Badge>
  ) : (
    <Badge tone="warn">MISSING</Badge>
  )
}
