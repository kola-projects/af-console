import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addAfVersion,
  afVersions,
  allRequests,
  appCodes,
  appearanceInfo,
  blueprintImageDataUri,
  cancelRequest,
  createRequest,
  myProfile,
  myRequests,
  removeRequestFile,
  selectableAfVersions,
  setAfVersionSelectable,
  setRequestStatus,
  storeOptions,
  uploadRequestFile,
} from '../lib/queries'
import {
  REQUEST_TYPE_LABEL,
  type AppRequest,
  type AppearanceInfo,
  type RequestStatus,
  type RequestType,
  type UploadedFile,
} from '../lib/types'
import { Badge, Cell, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'

const inputCls =
  'w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900'
const MAKE_MODES = ['changeLayoutAuto', 'changeFeatureExtremeAuto'] as const
const TEAMS = ['Auto', 'Titan'] as const

/** Tự nhận diện nguồn từ link (tập hữu hạn: Google Play / App Store / GitHub / Figma). */
function detectSource(url: string): { kind: string; label: string } | null {
  const u = url.trim().toLowerCase()
  if (!u) return null
  if (u.includes('play.google.com')) return { kind: 'store', label: 'Google Play' }
  if (u.includes('apps.apple.com') || u.includes('itunes.apple.com'))
    return { kind: 'appstore', label: 'App Store' }
  if (u.includes('github.com') || u.endsWith('.git')) return { kind: 'github', label: 'GitHub' }
  if (u.includes('figma.com')) return { kind: 'figma', label: 'Figma' }
  return null
}

function Label({ children, req }: { children: React.ReactNode; req?: boolean }) {
  return (
    <label className="mt-3 block text-sm">
      {children}
      {req && <span className="ml-1 text-red-600 dark:text-red-400">*</span>}
    </label>
  )
}
function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-xs text-neutral-500">{children}</div>
}

function useDraftId() {
  const [id] = useState(() => crypto.randomUUID())
  return id
}
function humanSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Upload file (single/multiple) trước khi gửi đơn. Lưu meta vào state của form. */
function FilePicker({
  draftId,
  files,
  setFiles,
  accept,
  multiple = true,
}: {
  draftId: string
  files: UploadedFile[]
  setFiles: (f: UploadedFile[]) => void
  accept?: string
  multiple?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onPick = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    setErr(null)
    try {
      const next = multiple ? [...files] : []
      for (const f of Array.from(list)) next.push(await uploadRequestFile(f, draftId))
      setFiles(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (key: string) => {
    try {
      await removeRequestFile(key)
    } catch {
      /* file có thể đã mất — vẫn gỡ khỏi danh sách */
    }
    setFiles(files.filter((f) => f.key !== key))
  }

  return (
    <div>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={busy}
        onChange={(e) => onPick(e.target.files)}
        className="block w-full text-xs text-neutral-600 file:mr-3 file:rounded file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:text-neutral-400 dark:file:border-neutral-700"
      />
      {busy && <Hint>Đang tải lên…</Hint>}
      {err && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{err}</div>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between rounded border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-800"
            >
              <span className="truncate">
                <Mono>{f.name}</Mono> <span className="text-neutral-500">{humanSize(f.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(f.key)}
                className="ml-2 text-neutral-500 hover:text-red-600"
              >
                Gỡ
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function statusTone(s: RequestStatus): 'neutral' | 'good' | 'warn' | 'bad' {
  if (s === 'done') return 'good'
  if (s === 'in_progress') return 'warn'
  if (s === 'rejected' || s === 'failed') return 'bad'
  return 'neutral'
}

// ─── AF version select (chung mọi form) ─────────────────────────────────
function AfVersionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const q = useQuery({ queryKey: ['af-versions-selectable'], queryFn: selectableAfVersions })
  useEffect(() => {
    if (!value && q.data?.length) onChange(q.data[0].version) // default = mới nhất
  }, [q.data, value, onChange])
  return (
    <div className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900">
      <span className="text-xs text-neutral-500">Bản AF</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} flex-1`}>
        {q.data?.map((v, i) => (
          <option key={v.version} value={v.version}>
            {v.version}
            {i === 0 ? ' — mới nhất (default)' : ''}
          </option>
        ))}
        {!q.data?.length && <option value="">(admin chưa mở khoá bản nào)</option>}
      </select>
    </div>
  )
}

function SubmitBar({
  pending,
  code,
  error,
}: {
  pending: boolean
  code: string | null
  error: unknown
}) {
  return (
    <div className="mt-4">
      {error ? <ErrorBox error={error} /> : null}
      {code && !error && (
        <div className="mb-2 rounded bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Đã gửi yêu cầu — mã <Mono>{code}</Mono>.
        </div>
      )}
      <button
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? 'Đang gửi…' : 'Gửi yêu cầu'}
      </button>
    </div>
  )
}

function useCodesDatalist() {
  const q = useQuery({ queryKey: ['app-codes'], queryFn: appCodes })
  return (
    <datalist id="app-codes">
      {q.data?.map((a) => (
        <option key={a.app_code!} value={a.app_code!}>
          {a.name}
        </option>
      ))}
    </datalist>
  )
}

function useStores() {
  return useQuery({ queryKey: ['store-options'], queryFn: storeOptions })
}
function StoreSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const q = useStores()
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">— chọn store —</option>
      {q.data?.map((s) => (
        <option key={s.store_code} value={s.store_code}>
          {s.store_code} — {s.display_name || s.name || ''}
        </option>
      ))}
    </select>
  )
}

// ─── Make app form (ASO BẮT BUỘC + google-services.json BẮT BUỘC) ────────
function MakeAppForm({ onSubmitted }: { onSubmitted: () => void }) {
  const draftId = useDraftId()
  const [af, setAf] = useState('')
  const [mode, setMode] = useState<string>(MAKE_MODES[0])
  const [variants, setVariants] = useState('3')
  const [sourceRef, setSourceRef] = useState('')
  const [appName, setAppName] = useState('')
  const [team, setTeam] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [pkg, setPkg] = useState('')
  const [gs, setGs] = useState<UploadedFile[]>([])
  const [attachments, setAttachments] = useState<UploadedFile[]>([])
  const [note, setNote] = useState('')
  const [warn, setWarn] = useState<string | null>(null)

  const isFeature = mode === 'changeFeatureExtremeAuto'
  const detected = detectSource(sourceRef)

  const mut = useMutation({
    mutationFn: () =>
      createRequest('make_app', af, {
        mode,
        variants: Number(variants) || 1,
        src: detected?.kind ?? null,
        source_ref: sourceRef.trim(),
        app_name: appName.trim(),
        team: team || null,
        ads_integration: false,
        aso: { enabled: true, store_code: storeCode, package_name: pkg.trim(), app_name: appName.trim() },
        upload_draft: draftId,
        google_services: gs[0] ?? null,
        attachments,
        note: note.trim() || null,
      }),
    onSuccess: onSubmitted,
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!detected) {
      setWarn('Link không nhận diện được nguồn (chỉ hỗ trợ Google Play / App Store / GitHub / Figma).')
      return
    }
    if (isFeature && detected.kind !== 'store' && detected.kind !== 'appstore') {
      setWarn('changeFeatureExtremeAuto cần link Google Play hoặc App Store.')
      return
    }
    if (!gs.length) {
      setWarn('Bắt buộc upload google-services.json (bản PRODUCTION của store).')
      return
    }
    setWarn(null)
    mut.mutate()
  }

  return (
    <form onSubmit={submit}>
      <AfVersionSelect value={af} onChange={setAf} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label req>Chế độ (mode)</Label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
            {MAKE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label req>Số biến thể (-v)</Label>
          <input
            type="number"
            min={1}
            max={3}
            value={variants}
            onChange={(e) => setVariants(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
      <Label req>Link nguồn (tự nhận diện)</Label>
      <input
        required
        value={sourceRef}
        onChange={(e) => setSourceRef(e.target.value)}
        placeholder="Google Play / App Store / GitHub / Figma URL"
        className={inputCls}
      />
      {sourceRef.trim() && (
        detected ? (
          <div className="mt-1 text-xs text-green-700 dark:text-green-300">
            → Nguồn: <b>{detected.label}</b>
          </div>
        ) : (
          <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Chưa nhận diện được — chỉ hỗ trợ Google Play / App Store / GitHub / Figma.
          </div>
        )
      )}
      {isFeature && <Hint>changeFeatureExtremeAuto cần link Google Play hoặc App Store.</Hint>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label req>Tên app (appName)</Label>
          <input
            required
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="tên marketing / niêm yết"
            className={inputCls}
          />
        </div>
        <div>
          <Label>Team</Label>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={inputCls}>
            <option value="">— không —</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ASO bắt buộc — mọi Make app chạy trọn gói tới niêm yết */}
      <div className="mt-4 rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/40">
        <div className="text-xs text-blue-700 dark:text-blue-300">
          ASO bắt buộc — Make app chạy trọn gói tới niêm yết (biến thể lấy Layout 1 × Style 1, không ads,
          không duyệt mockup).
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label req>Mã store</Label>
            <StoreSelect value={storeCode} onChange={setStoreCode} />
          </div>
          <div>
            <Label req>packageName</Label>
            <input
              required
              value={pkg}
              onChange={(e) => setPkg(e.target.value)}
              placeholder="com.bbl.example"
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>
      </div>

      <Label req>google-services.json (PRODUCTION)</Label>
      <FilePicker draftId={draftId} files={gs} setFiles={setGs} accept=".json,application/json" multiple={false} />
      <Hint>Bắt buộc — file google-services.json của môi trường production (build release cần).</Hint>

      <Label>Ảnh / file thông tin thêm</Label>
      <FilePicker draftId={draftId} files={attachments} setFiles={setAttachments} />
      <Hint>Tuỳ chọn — upload ảnh tham khảo, tài liệu… để làm rõ yêu cầu.</Hint>

      <Label>Ghi chú</Label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} min-h-16`} />
      {warn && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{warn}</div>}
      <SubmitBar pending={mut.isPending} code={mut.data?.request_code ?? null} error={mut.error} />
    </form>
  )
}

// ─── Ads integration form ───────────────────────────────────────────────
function AdsForm({ onSubmitted }: { onSubmitted: () => void }) {
  const draftId = useDraftId()
  const [af, setAf] = useState('')
  const [appCode, setAppCode] = useState('')
  const [ads, setAds] = useState('full')
  const [variant, setVariant] = useState('auto')
  const [pages, setPages] = useState('')
  const [survey, setSurvey] = useState('')
  const [attachments, setAttachments] = useState<UploadedFile[]>([])
  const [note, setNote] = useState('')
  const datalist = useCodesDatalist()

  const mut = useMutation({
    mutationFn: () =>
      createRequest(
        'add_ads',
        af,
        {
          app_code: appCode.trim(),
          ads,
          variant,
          pages: pages !== '' ? Number(pages) : null,
          survey: survey !== '' ? Number(survey) : null,
          upload_draft: draftId,
          attachments,
          note: note.trim() || null,
        },
        appCode.trim(),
      ),
    onSuccess: onSubmitted,
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mut.mutate()
      }}
    >
      {datalist}
      <AfVersionSelect value={af} onChange={setAf} />
      <Label req>Mã app (appCode)</Label>
      <input
        required
        list="app-codes"
        value={appCode}
        onChange={(e) => setAppCode(e.target.value)}
        placeholder="vd: 001"
        className={`${inputCls} font-mono`}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Ads</Label>
          <select value={ads} onChange={(e) => setAds(e.target.value)} className={inputCls}>
            <option value="full">full (bật)</option>
            <option value="off">off (dựng khung)</option>
          </select>
        </div>
        <div>
          <Label>Biến thể</Label>
          <select value={variant} onChange={(e) => setVariant(e.target.value)} className={inputCls}>
            <option value="auto">auto</option>
            <option value="bt1">bt1</option>
            <option value="bt2">bt2</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Trang onboarding (1–10)</Label>
          <input
            type="number"
            min={1}
            max={10}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            placeholder="mặc định"
            className={inputCls}
          />
        </div>
        <div>
          <Label>Survey (0–3)</Label>
          <input
            type="number"
            min={0}
            max={3}
            value={survey}
            onChange={(e) => setSurvey(e.target.value)}
            placeholder="mặc định"
            className={inputCls}
          />
        </div>
      </div>
      <Label>Ảnh / file thông tin thêm</Label>
      <FilePicker draftId={draftId} files={attachments} setFiles={setAttachments} />
      <Label>Ghi chú</Label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} min-h-16`} />
      <SubmitBar pending={mut.isPending} code={mut.data?.request_code ?? null} error={mut.error} />
    </form>
  )
}

// ─── Appearance (Layout × Style) picker cho form ASO ────────────────────
function AsyncImg({ runName, path }: { runName: string; path: string }) {
  const q = useQuery({
    queryKey: ['bp-img', runName, path],
    queryFn: () => blueprintImageDataUri(runName, path),
    staleTime: 5 * 60_000,
  })
  if (q.data) return <img src={q.data} alt="" className="h-24 w-full object-cover" />
  return <div className="flex h-24 items-center justify-center text-[11px] text-neutral-400">…</div>
}

function VariantRow({
  title,
  info,
  value,
  onChange,
}: {
  title: string
  info: AppearanceInfo
  value: string
  onChange: (v: string) => void
}) {
  if (info.source === 'none') {
    return (
      <div>
        <Label>{title}</Label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="chưa có preview — nhập tay (tuỳ chọn)"
          className={inputCls}
        />
      </div>
    )
  }
  const items = title.toLowerCase().includes('layout') ? info.layouts : info.styles
  if (info.source === 'manifest' && items.some((i) => i.preview) && info.runName) {
    return (
      <div>
        <Label>{title}</Label>
        <div className="grid grid-cols-3 gap-2">
          {items.map((v) => {
            const sel = value === String(v.ordinal)
            return (
              <button
                type="button"
                key={v.ordinal}
                onClick={() => onChange(String(v.ordinal))}
                className={`overflow-hidden rounded-lg border text-center ${
                  sel ? 'border-blue-500 ring-2 ring-blue-500' : 'border-neutral-300 dark:border-neutral-700'
                }`}
              >
                {v.preview ? (
                  <AsyncImg runName={info.runName!} path={v.preview} />
                ) : (
                  <div className="h-24 bg-neutral-100 dark:bg-neutral-800" />
                )}
                <div className="p-1 text-[11px]">{v.label || `#${v.ordinal + 1}`}</div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }
  // source 'count' hoặc manifest không có ảnh → select ordinal
  return (
    <div>
      <Label>{title}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">— không chọn —</option>
        {items.map((v) => (
          <option key={v.ordinal} value={String(v.ordinal)}>
            {v.label || `#${v.ordinal + 1}`}
          </option>
        ))}
      </select>
    </div>
  )
}

function AppearancePicker({
  appCode,
  layout,
  style,
  setLayout,
  setStyle,
}: {
  appCode: string
  layout: string
  style: string
  setLayout: (v: string) => void
  setStyle: (v: string) => void
}) {
  const code = appCode.trim()
  const q = useQuery({
    queryKey: ['appearance', code],
    queryFn: () => appearanceInfo(code),
    enabled: code.length > 0,
  })
  if (!code) return <Hint>Nhập mã app để chọn Layout / Style.</Hint>
  if (q.isLoading) return <Hint>Đang tra biến thể…</Hint>
  const info: AppearanceInfo = q.data ?? { source: 'none', runName: null, n: null, layouts: [], styles: [] }
  return (
    <div className="mt-2 rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/40">
      <div className="text-xs text-blue-700 dark:text-blue-300">
        Chọn Layout và Style độc lập (như dev mode).
        {info.source === 'none' && ' Blueprint chưa có biến thể — nhập tay (không bắt buộc).'}
        {info.source === 'count' && ` Blueprint có ${info.n} biến thể.`}
      </div>
      <div className="mt-2 grid grid-cols-1 gap-3">
        <VariantRow title="Layout" info={info} value={layout} onChange={setLayout} />
        <VariantRow title="Style" info={info} value={style} onChange={setStyle} />
      </div>
    </div>
  )
}

// ─── ASO form ────────────────────────────────────────────────────────────
function AsoForm({ onSubmitted }: { onSubmitted: () => void }) {
  const draftId = useDraftId()
  const [af, setAf] = useState('')
  const [appCode, setAppCode] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [appName, setAppName] = useState('')
  const [onPhone, setOnPhone] = useState('')
  const [pkg, setPkg] = useState('')
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [releaseNote, setReleaseNote] = useState('')
  const [layout, setLayout] = useState('')
  const [style, setStyle] = useState('')
  const [attachments, setAttachments] = useState<UploadedFile[]>([])
  const [note, setNote] = useState('')
  const datalist = useCodesDatalist()

  const mut = useMutation({
    mutationFn: () =>
      createRequest(
        'update_aso',
        af,
        {
          app_code: appCode.trim(),
          store_code: storeCode,
          app_name: appName.trim(),
          on_phone_name: onPhone.trim() || appName.trim(),
          package_name: pkg.trim() || null,
          app_version: appVersion.trim() || '1.0.0',
          release_note: releaseNote.trim() || null,
          layout: layout || null,
          style: style || null,
          upload_draft: draftId,
          attachments,
          note: note.trim() || null,
        },
        appCode.trim(),
      ),
    onSuccess: onSubmitted,
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mut.mutate()
      }}
    >
      {datalist}
      <AfVersionSelect value={af} onChange={setAf} />
      <Label req>Mã app (appCode)</Label>
      <input
        required
        list="app-codes"
        value={appCode}
        onChange={(e) => setAppCode(e.target.value)}
        placeholder="vd: 013"
        className={`${inputCls} font-mono`}
      />
      <AppearancePicker
        appCode={appCode}
        layout={layout}
        style={style}
        setLayout={setLayout}
        setStyle={setStyle}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label req>Mã store</Label>
          <StoreSelect value={storeCode} onChange={setStoreCode} />
        </div>
        <div>
          <Label req>appName</Label>
          <input required value={appName} onChange={(e) => setAppName(e.target.value)} className={inputCls} />
        </div>
      </div>
      <Label>onPhoneName</Label>
      <input
        value={onPhone}
        onChange={(e) => setOnPhone(e.target.value)}
        placeholder="tên hiện trên máy (mặc định = appName)"
        className={inputCls}
      />
      <Label>packageName</Label>
      <input
        value={pkg}
        onChange={(e) => setPkg(e.target.value)}
        placeholder="trống = lấy từ build"
        className={`${inputCls} font-mono`}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>App version</Label>
          <input
            value={appVersion}
            onChange={(e) => setAppVersion(e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </div>
        <div>
          <Label>Release note</Label>
          <input
            value={releaseNote}
            onChange={(e) => setReleaseNote(e.target.value)}
            placeholder="v1.0.0 thường để trống"
            className={inputCls}
          />
        </div>
      </div>
      <Hint>Legal (Privacy/Terms) sẽ được tạo/kiểm trước — legal fail thì ASO dừng.</Hint>
      <Label>Ảnh / file thông tin thêm</Label>
      <FilePicker draftId={draftId} files={attachments} setFiles={setAttachments} />
      <Label>Ghi chú</Label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} min-h-16`} />
      <SubmitBar pending={mut.isPending} code={mut.data?.request_code ?? null} error={mut.error} />
    </form>
  )
}

// ─── Danh sách "Yêu cầu của tôi" ────────────────────────────────────────
function MyRequests() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['my-requests'], queryFn: myRequests })
  const cancel = useMutation({
    mutationFn: cancelRequest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-requests'] })
      qc.invalidateQueries({ queryKey: ['all-requests'] })
    },
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (!q.data?.length) return <p className="text-sm text-neutral-500">Chưa có yêu cầu nào.</p>
  return (
    <>
      {cancel.error && <ErrorBox error={cancel.error} />}
      <Table head={['Mã', 'Loại', 'AF', 'Đích', 'Ngày giờ', 'Trạng thái', '']}>
        {q.data.map((r) => (
          <Row key={r.id}>
            <Cell>
              <Mono>{r.request_code}</Mono>
            </Cell>
            <Cell>{REQUEST_TYPE_LABEL[r.type]}</Cell>
            <Cell>
              <Mono>{r.af_version ?? '—'}</Mono>
            </Cell>
            <Cell>{r.target_app_code ? <Mono>{r.target_app_code}</Mono> : '—'}</Cell>
            <Cell className="text-neutral-500">{localTime(r.created_at)}</Cell>
            <Cell>
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              {typeof r.result?.app_code === 'string' && (
                <span className="ml-2 text-xs text-green-700 dark:text-green-300">
                  app <Mono>{r.result.app_code}</Mono>
                </span>
              )}
            </Cell>
            <Cell>
              {(r.status === 'submitted' || r.status === 'accepted') && (
                <button
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(r.id)}
                  className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                >
                  Huỷ
                </button>
              )}
            </Cell>
          </Row>
        ))}
      </Table>
    </>
  )
}

// ─── Admin: tất cả yêu cầu + đổi trạng thái ─────────────────────────────
const NEXT_ACTIONS: Record<string, { to: RequestStatus; label: string; tone: 'good' | 'warn' | 'bad' }[]> =
  {
    submitted: [
      { to: 'accepted', label: 'Nhận', tone: 'warn' },
      { to: 'rejected', label: 'Reject', tone: 'bad' },
    ],
    accepted: [
      { to: 'in_progress', label: 'Bắt đầu', tone: 'warn' },
      { to: 'rejected', label: 'Reject', tone: 'bad' },
    ],
    in_progress: [
      { to: 'done', label: 'Done', tone: 'good' },
      { to: 'failed', label: 'Failed', tone: 'bad' },
    ],
  }

function AdminRequests() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['all-requests'], queryFn: allRequests })
  const upd = useMutation({
    mutationFn: ({
      id,
      status,
      message,
      result,
    }: {
      id: number
      status: RequestStatus
      message?: string
      result?: Record<string, unknown> | null
    }) => setRequestStatus(id, status, message, result),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['all-requests'] })
      qc.invalidateQueries({ queryKey: ['my-requests'] })
    },
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />

  const act = (r: AppRequest, status: RequestStatus) => {
    let message: string | undefined
    let result: Record<string, unknown> | null | undefined
    if (status === 'rejected' || status === 'failed') {
      message = window.prompt(`Lý do ${status}?`) ?? undefined
    }
    // make_app xong → trả appCode cho user (kết quả của đơn).
    if (status === 'done' && r.type === 'make_app') {
      const code = window.prompt('appCode của app đã tạo (trả về cho người đặt):') ?? ''
      if (code.trim()) result = { app_code: code.trim() }
    }
    upd.mutate({ id: r.id, status, message, result })
  }

  return (
    <>
      {upd.error && <ErrorBox error={upd.error} />}
      <Table head={['Mã', 'Người yêu cầu', 'Loại', 'AF', 'Đích', 'Ngày giờ', 'Trạng thái', 'Hành động']}>
        {q.data?.map((r) => (
          <Row key={r.id}>
            <Cell>
              <Mono>{r.request_code}</Mono>
            </Cell>
            <Cell>
              <Mono>{r.requester_email ?? '—'}</Mono>
            </Cell>
            <Cell>{REQUEST_TYPE_LABEL[r.type]}</Cell>
            <Cell>
              <Mono>{r.af_version ?? '—'}</Mono>
            </Cell>
            <Cell>{r.target_app_code ? <Mono>{r.target_app_code}</Mono> : '—'}</Cell>
            <Cell className="text-neutral-500">{localTime(r.created_at)}</Cell>
            <Cell>
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            </Cell>
            <Cell>
              <div className="flex flex-wrap gap-1.5">
                {(NEXT_ACTIONS[r.status] ?? []).map((a) => (
                  <button
                    key={a.to}
                    disabled={upd.isPending}
                    onClick={() => act(r, a.to)}
                    className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                  >
                    {a.label}
                  </button>
                ))}
                {typeof r.result?.app_code === 'string' && (
                  <span className="text-xs text-green-700 dark:text-green-300">
                    → <Mono>{r.result.app_code}</Mono>
                  </span>
                )}
              </div>
            </Cell>
          </Row>
        ))}
      </Table>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-neutral-500">Payload / kết quả (JSON)</summary>
        <div className="mt-2 space-y-2">
          {q.data?.map((r) => (
            <details key={r.id} className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              <summary className="cursor-pointer">
                <Mono>{r.request_code}</Mono> · {REQUEST_TYPE_LABEL[r.type]}
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-neutral-600 dark:text-neutral-400">
                {JSON.stringify({ payload: r.payload, result: r.result, note: r.note }, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      </details>
    </>
  )
}

// ─── Admin: panel lock/unlock bản AF ────────────────────────────────────
function AfVersionsPanel() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['af-versions'], queryFn: afVersions })
  const [newV, setNewV] = useState('')
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['af-versions'] })
    qc.invalidateQueries({ queryKey: ['af-versions-selectable'] })
  }
  const toggle = useMutation({
    mutationFn: ({ v, s }: { v: string; s: boolean }) => setAfVersionSelectable(v, s),
    onSuccess: invalidate,
  })
  const add = useMutation({
    mutationFn: () => {
      const rank = (q.data?.[0]?.sort_rank ?? 0) + 1
      return addAfVersion(newV, rank)
    },
    onSuccess: () => {
      setNewV('')
      invalidate()
    },
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  return (
    <div>
      {(toggle.error || add.error) && <ErrorBox error={toggle.error || add.error} />}
      <form
        className="mb-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add.mutate()
        }}
      >
        <div>
          <label className="block text-xs text-neutral-500">Thêm bản AF</label>
          <input
            required
            value={newV}
            onChange={(e) => setNewV(e.target.value)}
            placeholder="vd: v5.4.0"
            className={`${inputCls} font-mono`}
          />
        </div>
        <button
          disabled={add.isPending}
          className="rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          Thêm
        </button>
      </form>
      <Table head={['Bản', 'Cho chọn', '']}>
        {q.data?.map((v) => (
          <Row key={v.version}>
            <Cell>
              <Mono>{v.version}</Mono>
            </Cell>
            <Cell>
              {v.is_selectable ? <Badge tone="good">mở</Badge> : <Badge>khoá</Badge>}
            </Cell>
            <Cell>
              <button
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ v: v.version, s: !v.is_selectable })}
                className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
              >
                {v.is_selectable ? 'Khoá' : 'Mở khoá'}
              </button>
            </Cell>
          </Row>
        ))}
      </Table>
    </div>
  )
}

// ─── Trang Requests ──────────────────────────────────────────────────────
export default function Requests() {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  const [type, setType] = useState<RequestType>('make_app')
  const isAdmin = me.data?.role === 'admin'

  const onSubmitted = () => {
    qc.invalidateQueries({ queryKey: ['my-requests'] })
    qc.invalidateQueries({ queryKey: ['all-requests'] })
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg">Yêu cầu</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Đặt yêu cầu Make app / Ads integration / ASO. Mỗi yêu cầu có mã <Mono>rNNNNN</Mono> để AF chạy
          theo mã.
        </p>
      </div>

      <div className="max-w-2xl">
        <div className="mb-3 flex gap-1 text-sm">
          {(Object.keys(REQUEST_TYPE_LABEL) as RequestType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded px-2.5 py-1 ${
                type === t
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`}
            >
              {REQUEST_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {type === 'make_app' && <MakeAppForm onSubmitted={onSubmitted} />}
        {type === 'add_ads' && <AdsForm onSubmitted={onSubmitted} />}
        {type === 'update_aso' && <AsoForm onSubmitted={onSubmitted} />}
      </div>

      <div>
        <h2 className="text-base">Yêu cầu của tôi</h2>
        <div className="mt-3">
          <MyRequests />
        </div>
      </div>

      {isAdmin && (
        <>
          <div>
            <h2 className="text-base">Tất cả yêu cầu (admin)</h2>
            <div className="mt-3">
              <AdminRequests />
            </div>
          </div>
          <div>
            <h2 className="text-base">Bản AF cho đặt đơn (admin)</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Mở/khoá bản AF mà người đặt đơn được chọn. Bản mở mới nhất là default.
            </p>
            <div className="mt-3 max-w-lg">
              <AfVersionsPanel />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
