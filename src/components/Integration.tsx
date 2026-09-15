import type { AppIntegration } from '../lib/types'
import { Badge, Mono } from './ui'

/** UI cho apps.integration (0040) — ảnh chụp trạng thái tích hợp do quét repo.
 *  AFC chỉ HIỂN THỊ; dữ liệu suy từ git ở session quét, không tính ở client. */

const notScanned = (i?: AppIntegration | null): boolean => !i || !i.checked_at

/** Link GitHub repo của app. Trả null nếu chưa biết. */
export function GithubLink({
  url,
  compact = false,
}: {
  url?: string | null
  compact?: boolean
}) {
  if (!url) return null
  const short = url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Mở GitHub repo: ${short}`}
      className="inline-flex items-center gap-1 text-neutral-600 hover:text-neutral-900 hover:underline dark:text-neutral-300 dark:hover:text-white"
    >
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden className="flex-none">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
      {!compact && <span className="truncate">{short}</span>}
    </a>
  )
}

/** Badge trạng thái Ads (none/funnel/full) + engine/version trong tooltip. */
export function AdsBadge({ ads }: { ads?: AppIntegration['ads'] }) {
  const status = ads?.status ?? 'none'
  const bits = [
    ads?.engine && `engine ${ads.engine}`,
    ads?.funnel_version && `funnel ${ads.funnel_version}`,
    ads?.ads_af_version && `ads AF ${ads.ads_af_version}`,
    ads?.branch && ads.branch !== '(working-tree)' && `nhánh ${ads.branch}`,
    ads?.adsMode && `adsMode ${ads.adsMode}`,
    ads?.host && `host ${ads.host}`,
  ].filter(Boolean).join(' · ')
  if (status === 'full')
    return <Badge tone="good"><span title={bits || 'Ads full (funnel + Home-trở-đi)'}>🟢 Ads full</span></Badge>
  if (status === 'funnel')
    return <Badge tone="warn"><span title={bits || 'Chỉ funnel (chưa bật ads màn host)'}>🟡 Funnel</span></Badge>
  return <span className="text-[11px] text-neutral-400" title="Chưa tích hợp ads">—</span>
}

function StatusChip({ label, tone, title }: { label: string; tone?: 'good' | 'warn' | 'bad' | 'neutral'; title?: string }) {
  return <Badge tone={tone}><span title={title}>{label}</span></Badge>
}

const legalTone = (v?: string): 'good' | 'warn' | 'neutral' =>
  v === 'live' ? 'good' : v === 'staged' || v === 'built' ? 'warn' : 'neutral'

/** Hàng chip gọn cho danh sách app: Ads + ASO + Legal + Landing (+ github). */
export function IntegrationChips({
  integ,
  showGithub = true,
}: {
  integ?: AppIntegration | null
  showGithub?: boolean
}) {
  if (notScanned(integ)) return <span className="text-[11px] text-neutral-400">chưa quét</span>
  const i = integ!
  return (
    <span className="flex flex-wrap items-center gap-1">
      <AdsBadge ads={i.ads} />
      {i.aso && <StatusChip label="ASO" tone="good" title="Đã có gói ASO trong blueprint" />}
      {i.legal && i.legal !== 'none' && (
        <StatusChip label={`Legal ${i.legal}`} tone={legalTone(i.legal)} title={`legal: ${i.legal} (nguồn ${i.legal_source ?? 'repo'})`} />
      )}
      {i.landing && (
        <StatusChip label={`Landing ${i.landing}`} tone={i.landing === 'live' ? 'good' : 'warn'} title={`landing: ${i.landing}`} />
      )}
      {showGithub && i.github && <GithubLink url={i.github} compact />}
    </span>
  )
}

const dash = <span className="text-[11px] text-neutral-400">—</span>
const unscanned = <span className="text-[11px] text-neutral-400" title="Chưa quét repo">·</span>

/** Cột FUNNEL: có funnel gì (engine + version của BẢN CUỐI CÙNG), độc lập với ads-host.
 *  Nhiều bản qua các nhánh ⇒ hiện bản cuối + "·+N" (tooltip liệt kê toàn bộ lịch sử). */
export function FunnelCell({ integ }: { integ?: AppIntegration | null }) {
  if (notScanned(integ)) return unscanned
  const ads = integ!.ads
  if (!ads || (ads.status ?? 'none') === 'none') return dash
  const seen = ads.versions_seen ?? []
  const extra = Math.max(0, seen.length - 1)
  const histLines =
    seen.length > 1
      ? '\nLịch sử (cũ→mới):\n' +
        seen
          .map((v) => `• ${v.engine ?? 'funnel'} ${v.funnel_version ?? ''} ${v.host ? '[host]' : '[funnel]'}${v.date ? ' ' + v.date : ''}`)
          .join('\n')
      : ''
  const title =
    [
      ads.engine && `engine ${ads.engine}`,
      ads.funnel_version && `funnel ${ads.funnel_version}`,
      ads.ads_af_version && `ads AF ${ads.ads_af_version}`,
      ads.branch && ads.branch !== '(working-tree)' && `nhánh ${ads.branch}`,
      ads.date && `commit ${ads.date.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(' · ') + (histLines ? ` ${histLines}` : '')
  return (
    <span className="whitespace-nowrap" title={title}>
      <Badge tone="warn">
        {ads.engine ?? 'funnel'}
        {ads.funnel_version && <> · {ads.funnel_version}</>}
      </Badge>
      {extra > 0 && <span className="ml-1 text-[10px] text-neutral-500">·+{extra}</span>}
    </span>
  )
}

/** Cột HOST: ads có chạy trong màn THẬT của app (Home-trở-đi) không — theo BẢN CUỐI.
 *  full / host=true / adsMode=FULL ⇒ Có; chỉ funnel ⇒ Tắt; không ads ⇒ —.
 *  Nếu bản cuối là funnel-only nhưng nhánh khác từng bật host ⇒ ghi chú trong tooltip. */
export function HostCell({ integ }: { integ?: AppIntegration | null }) {
  if (notScanned(integ)) return unscanned
  const ads = integ!.ads
  const status = ads?.status ?? 'none'
  if (status === 'none') return dash
  const hostOn = status === 'full' || ads?.host === 'true' || ads?.adsMode === 'FULL'
  if (hostOn)
    return <Badge tone="good"><span title="Ads chạy trong màn host (Home-trở-đi) — bản cuối cùng">🟢 Có</span></Badge>
  const note = ads?.host_any_branch ? ' (nhánh khác từng bật host)' : ''
  return (
    <Badge tone="warn">
      <span title={`Bản cuối: chỉ funnel, chưa gắn ads màn host${ads?.host ? ` (host=${ads.host})` : ''}${note}`}>
        Tắt{ads?.host_any_branch ? '*' : ''}
      </span>
    </Badge>
  )
}

/** Cột ASO: có gói ASO trong blueprint chưa. */
export function AsoCell({ integ }: { integ?: AppIntegration | null }) {
  if (notScanned(integ)) return unscanned
  return integ!.aso ? <Badge tone="good">ASO</Badge> : dash
}

/** Cột LEGAL: none|built|staged|live. */
export function LegalCell({ integ }: { integ?: AppIntegration | null }) {
  if (notScanned(integ)) return unscanned
  const v = integ!.legal
  if (!v || v === 'none') return dash
  return <Badge tone={legalTone(v)}><span title={`nguồn ${integ!.legal_source ?? 'repo'}`}>{v}</span></Badge>
}

/** Cột LANDING: built|live. */
export function LandingCell({ integ }: { integ?: AppIntegration | null }) {
  if (notScanned(integ)) return unscanned
  const v = integ!.landing
  if (!v) return dash
  return <Badge tone={v === 'live' ? 'good' : 'warn'}>{v}</Badge>
}

/** Cột GIT: link repo GitHub (icon-only). */
export function GitCell({ integ }: { integ?: AppIntegration | null }) {
  if (notScanned(integ)) return unscanned
  return integ!.github ? <GithubLink url={integ!.github} compact /> : dash
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 flex-none text-xs text-neutral-500">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

/** Panel đầy đủ cho trang detail: github, ads (engine/version/nhánh), AF version, aso/legal/landing, ngày quét. */
export function IntegrationPanel({ integ }: { integ?: AppIntegration | null }) {
  if (notScanned(integ)) {
    return (
      <p className="text-sm text-neutral-500">
        Chưa quét repo cho app này. Chạy session quét (đọc funnel.lock + blueprint mọi nhánh) để cập nhật.
      </p>
    )
  }
  const i = integ!
  const ads = i.ads
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <Field label="GitHub">
        {i.github ? <GithubLink url={i.github} /> : <span className="text-neutral-400">—</span>}
      </Field>
      <Field label="Ads">
        <span className="flex flex-wrap items-center gap-2">
          <AdsBadge ads={ads} />
          {ads?.engine && <span className="text-xs text-neutral-500">engine <Mono>{ads.engine}</Mono></span>}
          {ads?.funnel_version && <span className="text-xs text-neutral-500">funnel <Mono>{ads.funnel_version}</Mono></span>}
          {ads?.branch && ads.branch !== '(working-tree)' && (
            <span className="text-xs text-neutral-500">nhánh <Mono>{ads.branch}</Mono></span>
          )}
        </span>
      </Field>
      {(ads?.versions_seen?.length ?? 0) > 1 && (
        <Field label="Bản funnel đã thấy">
          <span className="flex flex-col gap-0.5">
            {ads!.versions_seen!.map((v, idx) => (
              <span key={idx} className="text-xs">
                <Mono>{v.engine ?? 'funnel'} {v.funnel_version ?? ''}</Mono>{' '}
                <Badge tone={v.host ? 'good' : 'warn'}>{v.host ? 'host' : 'funnel-only'}</Badge>{' '}
                <span className="text-neutral-500">
                  {v.branch}{v.date ? ` · ${v.date}` : ''}
                  {idx === ads!.versions_seen!.length - 1 && ' · ← bản cuối'}
                </span>
              </span>
            ))}
          </span>
        </Field>
      )}
      <Field label="AF version (build)">
        {i.af_version ? <Mono>{i.af_version}</Mono> : <span className="text-neutral-400">—</span>}
      </Field>
      {ads?.ads_af_version && (
        <Field label="AF version (ads)">
          <Mono>{ads.ads_af_version}</Mono>
        </Field>
      )}
      <Field label="ASO">
        {i.aso ? <Badge tone="good">có</Badge> : <span className="text-neutral-400">chưa</span>}
      </Field>
      <Field label="Legal">
        {i.legal && i.legal !== 'none' ? (
          <span className="flex items-center gap-2">
            <StatusChip label={i.legal} tone={legalTone(i.legal)} />
            <span className="text-xs text-neutral-500">nguồn {i.legal_source ?? 'repo'}</span>
          </span>
        ) : (
          <span className="text-neutral-400">chưa</span>
        )}
      </Field>
      <Field label="Landing">
        {i.landing ? <StatusChip label={i.landing} tone={i.landing === 'live' ? 'good' : 'warn'} /> : <span className="text-neutral-400">chưa</span>}
      </Field>
      <Field label="Ngày quét">
        <span className="text-sm text-neutral-500" title={i.scanned_dir ? `từ ${i.scanned_dir}` : undefined}>
          {i.checked_at}
          {typeof i.branch_count === 'number' && ` · ${i.branch_count} nhánh`}
        </span>
      </Field>
    </div>
  )
}
