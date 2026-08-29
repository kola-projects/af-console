import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  allocStoreCode,
  clearStorePat,
  createStore,
  deleteStore,
  setStorePat,
  storesList,
  updateStore,
  type StoreInput,
  type StoreRow,
} from '../lib/queries'
import { Badge, Cell, Empty, ErrorBox, Loading, Mono, Row, Table } from '../components/ui'

const input =
  'mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900'
const btn =
  'rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900'
const btnGhost =
  'rounded border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'

type FormState = {
  name: string
  slug: string
  store_code: string
  display_name: string
  support_email: string
  github_org: string
  github_repo: string
  website_url: string
  play_console_url: string
  enabled: boolean
}

function emptyForm(): FormState {
  return {
    name: '',
    slug: '',
    store_code: '',
    display_name: '',
    support_email: '',
    github_org: '',
    github_repo: '',
    website_url: '',
    play_console_url: '',
    enabled: true,
  }
}

function fromRow(s: StoreRow): FormState {
  return {
    name: s.name ?? '',
    slug: s.slug ?? '',
    store_code: s.store_code ?? '',
    display_name: s.display_name ?? '',
    support_email: s.support_email ?? '',
    github_org: (s.extra?.['github_org'] as string) ?? '',
    github_repo: s.github_repo ?? '',
    website_url: s.website_url ?? '',
    play_console_url: s.play_console_url ?? '',
    enabled: s.enabled,
  }
}

function toInput(f: FormState): StoreInput {
  const extra: Record<string, unknown> = {}
  if (f.github_org.trim()) extra['github_org'] = f.github_org.trim()
  return {
    name: f.name.trim(),
    slug: f.slug.trim(),
    store_code: f.store_code.trim() || null,
    display_name: f.display_name.trim() || null,
    support_email: f.support_email.trim() || null,
    github_repo: f.github_repo.trim() || null,
    website_url: f.website_url.trim() || null,
    play_console_url: f.play_console_url.trim() || null,
    enabled: f.enabled,
    extra,
  }
}

function StoreForm({
  initial,
  editingId,
  existingExtra,
  onDone,
  onCancel,
}: {
  initial: FormState
  editingId: number | null
  existingExtra?: Record<string, unknown>
  onDone: () => void
  onCancel?: () => void
}) {
  const [f, setF] = useState<FormState>(initial)
  const qc = useQueryClient()
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))

  const alloc = useMutation({
    mutationFn: allocStoreCode,
    onSuccess: (code) => set('store_code', code),
  })

  const save = useMutation({
    mutationFn: async () => {
      const payload = toInput(f)
      // giữ các key extra khác (không phải github_org) khi sửa
      if (existingExtra) {
        payload.extra = { ...existingExtra, ...(payload.extra ?? {}) }
        if (!f.github_org.trim()) delete (payload.extra as Record<string, unknown>)['github_org']
      }
      if (editingId) await updateStore(editingId, payload)
      else await createStore(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      onDone()
    },
  })

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div>
        <label className="block text-xs text-neutral-500">Tên store *</label>
        <input required className={input} value={f.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">Slug *</label>
        <input
          required
          className={input}
          value={f.slug}
          onChange={(e) => set('slug', e.target.value)}
          placeholder="khanhthanhltd"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">Mã store (aNNN)</label>
        <div className="mt-1 flex gap-2">
          <input
            className={input.replace('mt-1 ', '')}
            value={f.store_code}
            onChange={(e) => set('store_code', e.target.value)}
            placeholder="a014"
          />
          <button
            type="button"
            className={btnGhost}
            disabled={alloc.isPending}
            onClick={() => alloc.mutate()}
          >
            {alloc.isPending ? '…' : 'Cấp mã'}
          </button>
        </div>
      </div>
      <div>
        <label className="block text-xs text-neutral-500">Brand (display_name)</label>
        <input
          className={input}
          value={f.display_name}
          onChange={(e) => set('display_name', e.target.value)}
          placeholder="Khanh Thanh LTD"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">Support email</label>
        <input
          className={input}
          value={f.support_email}
          onChange={(e) => set('support_email', e.target.value)}
          placeholder="store@gmail.com"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">GitHub org (legal repo-per-app)</label>
        <input
          className={input}
          value={f.github_org}
          onChange={(e) => set('github_org', e.target.value)}
          placeholder="khanhthanhltd"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">GitHub repo (site Pages, legacy)</label>
        <input
          className={input}
          value={f.github_repo}
          onChange={(e) => set('github_repo', e.target.value)}
          placeholder="khanhthanhltd/khanhthanhltd.github.io"
        />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">Website URL</label>
        <input className={input} value={f.website_url} onChange={(e) => set('website_url', e.target.value)} />
      </div>
      <div>
        <label className="block text-xs text-neutral-500">Play Console URL</label>
        <input
          className={input}
          value={f.play_console_url}
          onChange={(e) => set('play_console_url', e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        Enabled
      </label>

      {save.error && (
        <div className="sm:col-span-2">
          <ErrorBox error={save.error} />
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button className={btn} disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : editingId ? 'Lưu thay đổi' : 'Tạo store'}
        </button>
        {onCancel && (
          <button type="button" className={btnGhost} onClick={onCancel}>
            Huỷ
          </button>
        )}
      </div>
    </form>
  )
}

function PatModal({ store, onClose }: { store: StoreRow; onClose: () => void }) {
  const [pat, setPat] = useState('')
  const qc = useQueryClient()
  const setM = useMutation({
    mutationFn: () => setStorePat(store.id, pat),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      onClose()
    },
  })
  const clearM = useMutation({
    mutationFn: () => clearStorePat(store.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      onClose()
    },
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium">
          GitHub PAT — <Mono>{store.name}</Mono>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Token được mã hoá server-side (không đọc lại được). Chỉ cần khi máy chạy legal/ASO KHÔNG đăng
          nhập <Mono>gh</Mono> với quyền owner của org. Trạng thái hiện tại:{' '}
          {store.github_pat_configured ? (
            <Badge tone="good">đã cấu hình</Badge>
          ) : (
            <Badge tone="neutral">chưa có</Badge>
          )}
        </p>
        <input
          type="password"
          className={input}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="ghp_… (fine-grained PAT với quyền repo trên org)"
          autoComplete="new-password"
        />
        {(setM.error || clearM.error) && (
          <div className="mt-2">
            <ErrorBox error={setM.error || clearM.error} />
          </div>
        )}
        <div className="mt-4 flex justify-between">
          <button
            className={btnGhost}
            disabled={clearM.isPending || !store.github_pat_configured}
            onClick={() => clearM.mutate()}
          >
            {clearM.isPending ? '…' : 'Xoá PAT'}
          </button>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={onClose}>
              Đóng
            </button>
            <button className={btn} disabled={setM.isPending || pat.length < 8} onClick={() => setM.mutate()}>
              {setM.isPending ? 'Đang lưu…' : 'Lưu PAT'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Stores() {
  const q = useQuery({ queryKey: ['stores'], queryFn: storesList })
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<StoreRow | null>(null)
  const [patFor, setPatFor] = useState<StoreRow | null>(null)

  const del = useMutation({
    mutationFn: (id: number) => deleteStore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Stores</h1>
          <p className="text-xs text-neutral-500">
            Quản lý store phát hành: brand, org GitHub (legal repo-per-app), mã store, PAT. Legal/ASO gán
            store bằng mã.
          </p>
        </div>
        <button className={btn} onClick={() => setCreating((v) => !v)}>
          {creating ? 'Đóng' : '+ Store mới'}
        </button>
      </div>

      {creating && (
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="mb-3 text-sm font-medium">Tạo store</div>
          <StoreForm initial={emptyForm()} editingId={null} onDone={() => setCreating(false)} />
        </div>
      )}

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && <Empty>Chưa có store nào.</Empty>}

      {q.data && q.data.length > 0 && (
        <Table head={['Mã', 'Tên / Brand', 'Slug', 'GitHub org', 'PAT', 'Apps', 'Trạng thái', '']}>
          {q.data.map((s) => (
            <Row key={s.id}>
              <Cell>
                <Mono>{s.store_code ?? '—'}</Mono>
              </Cell>
              <Cell>
                <div className="font-medium">{s.name}</div>
                {s.display_name && <div className="text-xs text-neutral-500">{s.display_name}</div>}
              </Cell>
              <Cell>
                <Mono>{s.slug}</Mono>
              </Cell>
              <Cell>
                <Mono>{(s.extra?.['github_org'] as string) ?? s.github_repo ?? '—'}</Mono>
              </Cell>
              <Cell>
                {s.github_pat_configured ? (
                  <Badge tone="good">có</Badge>
                ) : (
                  <Badge tone="neutral">gh CLI</Badge>
                )}
              </Cell>
              <Cell>{s.app_count}</Cell>
              <Cell>
                {s.enabled ? <Badge tone="good">enabled</Badge> : <Badge tone="bad">disabled</Badge>}
              </Cell>
              <Cell className="text-right">
                <div className="flex justify-end gap-2">
                  <button className={btnGhost} onClick={() => setEditing(s)}>
                    Sửa
                  </button>
                  <button className={btnGhost} onClick={() => setPatFor(s)}>
                    PAT
                  </button>
                  <button
                    className={btnGhost}
                    onClick={() => {
                      if (s.app_count > 0) {
                        alert(`Store còn ${s.app_count} app — gỡ liên kết app trước khi xoá.`)
                        return
                      }
                      if (confirm(`Xoá store "${s.name}"? Không hoàn tác.`)) del.mutate(s.id)
                    }}
                  >
                    Xoá
                  </button>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-sm font-medium">Sửa store — {editing.name}</div>
            <StoreForm
              initial={fromRow(editing)}
              editingId={editing.id}
              existingExtra={editing.extra}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}

      {patFor && <PatModal store={patFor} onClose={() => setPatFor(null)} />}
    </div>
  )
}
