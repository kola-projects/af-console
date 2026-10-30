import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import {
  allocPartnerCode,
  createPartner,
  deletePartner,
  partnersList,
  updatePartner,
  type PartnerInput,
  type PartnerRow,
} from '../lib/queries'
import { Badge, Empty, ErrorBox, Loading, Mono, Row, Table, Cell } from '../components/ui'

const input =
  'mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900'
const btn =
  'rounded bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm text-white disabled:opacity-40'
const btnGhost =
  'rounded border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'

const COMMANDS = ['global', 'make', 'aso', 'ads', 'adsHost'] as const

type FormState = {
  partner_code: string
  name: string
  description_html: string
  rules: Record<string, Record<string, string>>
  enabled: boolean
}

function emptyForm(): FormState {
  return { partner_code: '', name: '', description_html: '', rules: {}, enabled: true }
}

function fromRow(r: PartnerRow): FormState {
  return {
    partner_code: r.partner_code,
    name: r.name,
    description_html: r.description_html ?? '',
    rules: (r.rules ?? {}) as Record<string, Record<string, string>>,
    enabled: r.enabled,
  }
}

function toInput(f: FormState): PartnerInput {
  const cleaned: Record<string, Record<string, string>> = {}
  for (const [cmd, kv] of Object.entries(f.rules)) {
    const entries = Object.entries(kv).filter(([k, v]) => k.trim() && v.trim())
    if (entries.length) cleaned[cmd] = Object.fromEntries(entries)
  }
  return {
    partner_code: f.partner_code.trim(),
    name: f.name.trim(),
    description_html: f.description_html || null,
    rules: cleaned,
    enabled: f.enabled,
  }
}

function TiptapEditor({
  content,
  onChange,
}: {
  content: string
  onChange: (html: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: true, allowBase64: true }),
      Link.configure({ openOnClick: false }),
    ],
    content,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  })

  if (!editor) return null

  return (
    <div className="rounded border border-neutral-300 dark:border-neutral-700">
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 p-1.5 dark:border-neutral-700">
        <ToolBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="B"
          className="font-bold"
        />
        <ToolBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="I"
          className="italic"
        />
        <ToolBtn
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="• List"
        />
        <ToolBtn
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="1. List"
        />
        <ToolBtn
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="H3"
        />
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            const url = window.prompt('URL ảnh:')
            if (url) editor.chain().focus().setImage({ src: url }).run()
          }}
        >
          🖼 Ảnh
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            const url = window.prompt('URL link:')
            if (url) editor.chain().focus().setLink({ href: url }).run()
          }}
        >
          🔗 Link
        </button>
      </div>
      <EditorContent
        editor={editor}
        className="prose prose-sm dark:prose-invert max-w-none p-3 [&_.ProseMirror]:min-h-[120px] [&_.ProseMirror]:outline-none"
      />
    </div>
  )
}

function ToolBtn({
  active,
  onClick,
  label,
  className = '',
}: {
  active: boolean
  onClick: () => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs ${className} ${active ? 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
    >
      {label}
    </button>
  )
}

function RulesEditor({
  rules,
  onChange,
}: {
  rules: Record<string, Record<string, string>>
  onChange: (r: Record<string, Record<string, string>>) => void
}) {
  const [active, setActive] = useState<string>(COMMANDS[0])

  const kvs = rules[active] ?? {}
  const entries = Object.entries(kvs)

  function setKV(idx: number, key: string, val: string) {
    const pairs = [...entries]
    pairs[idx] = [key, val]
    onChange({ ...rules, [active]: Object.fromEntries(pairs) })
  }

  function addKV() {
    onChange({ ...rules, [active]: { ...kvs, '': '' } })
  }

  function removeKV(idx: number) {
    const pairs = entries.filter((_, i) => i !== idx)
    onChange({ ...rules, [active]: Object.fromEntries(pairs) })
  }

  return (
    <div>
      <div className="mb-2 flex gap-1">
        {COMMANDS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            className={`rounded px-2.5 py-1 text-xs ${active === c ? 'bg-primary-600 text-white' : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-neutral-400">
        key = tên tham số CLI (vd: storeCode, ads, variant). value = giá trị mặc định tiêm khi CLI chưa truyền.
      </p>
      {entries.map(([k, v], i) => (
        <div key={i} className="mb-1 flex gap-2">
          <input
            className="w-40 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            value={k}
            onChange={(e) => setKV(i, e.target.value, v)}
            placeholder="key"
          />
          <input
            className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            value={v}
            onChange={(e) => setKV(i, k, e.target.value)}
            placeholder="value"
          />
          <button type="button" className="text-xs text-red-500 hover:text-red-700" onClick={() => removeKV(i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={btnGhost} onClick={addKV}>
        + Thêm rule
      </button>
    </div>
  )
}

function PartnerForm({
  initial,
  isNew,
  onDone,
  onCancel,
}: {
  initial: FormState
  isNew: boolean
  onDone: () => void
  onCancel?: () => void
}) {
  const [f, setF] = useState<FormState>(initial)
  const qc = useQueryClient()
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))

  const alloc = useMutation({
    mutationFn: allocPartnerCode,
    onSuccess: (code) => set('partner_code', code),
  })

  const save = useMutation({
    mutationFn: async () => {
      const payload = toInput(f)
      if (isNew) await createPartner(payload)
      else await updatePartner(f.partner_code, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partners'] })
      onDone()
    },
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs text-neutral-500">Mã partner *</label>
          <div className="mt-1 flex gap-2">
            <input
              required
              className={input.replace('mt-1 ', '')}
              value={f.partner_code}
              onChange={(e) => set('partner_code', e.target.value)}
              placeholder="003"
              disabled={!isNew}
            />
            {isNew && (
              <button
                type="button"
                className={btnGhost}
                disabled={alloc.isPending}
                onClick={() => alloc.mutate()}
              >
                {alloc.isPending ? '…' : 'Cấp mã'}
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Tên partner *</label>
          <input required className={input} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Enabled
        </label>
      </div>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">Mô tả (WYSIWYG — text + ảnh)</label>
        <TiptapEditor content={f.description_html} onChange={(html) => set('description_html', html)} />
      </div>

      <div>
        <label className="mb-1 block text-xs text-neutral-500">Rules (tiêm mặc định theo lệnh)</label>
        <RulesEditor rules={f.rules} onChange={(r) => set('rules', r)} />
      </div>

      {save.error && <ErrorBox error={save.error} />}

      <div className="flex gap-2">
        <button className={btn} disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : isNew ? 'Tạo partner' : 'Lưu thay đổi'}
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

export default function Partners() {
  const q = useQuery({ queryKey: ['partners'], queryFn: partnersList })
  const qc = useQueryClient()
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list')
  const [editing, setEditing] = useState<PartnerRow | null>(null)

  const del = useMutation({
    mutationFn: deletePartner,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partners'] }),
  })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />

  if (mode === 'new') {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <h2 className="text-lg font-semibold">Tạo partner mới</h2>
        <PartnerForm
          initial={emptyForm()}
          isNew
          onDone={() => setMode('list')}
          onCancel={() => setMode('list')}
        />
      </div>
    )
  }

  if (mode === 'edit' && editing) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <h2 className="text-lg font-semibold">
          Sửa partner — <Mono>{editing.partner_code}</Mono> {editing.name}
        </h2>
        <PartnerForm
          initial={fromRow(editing)}
          isNew={false}
          onDone={() => {
            setMode('list')
            setEditing(null)
          }}
          onCancel={() => {
            setMode('list')
            setEditing(null)
          }}
        />
      </div>
    )
  }

  const rows = q.data ?? []
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Partners ({rows.length})</h2>
        <button className={btn} onClick={() => setMode('new')}>
          + Tạo partner
        </button>
      </div>

      {!rows.length ? (
        <Empty>Chưa có partner nào.</Empty>
      ) : (
        <Table head={['Mã', 'Tên', 'Trạng thái', 'Apps', 'Rules', '']}>
          {rows.map((r) => {
            const ruleCount = Object.values(r.rules ?? {}).reduce(
              (s, kv) => s + Object.keys(kv as Record<string, string>).length,
              0,
            )
            return (
              <Row key={r.partner_code}>
                <Cell>
                  <Mono>{r.partner_code}</Mono>
                </Cell>
                <Cell>{r.name}</Cell>
                <Cell>
                  <Badge tone={r.enabled ? 'good' : 'neutral'}>{r.enabled ? 'ON' : 'OFF'}</Badge>
                </Cell>
                <Cell>{r.app_count}</Cell>
                <Cell>
                  <Mono>{ruleCount} rule{ruleCount !== 1 ? 's' : ''}</Mono>
                </Cell>
                <Cell>
                  <div className="flex gap-2">
                    <button
                      className={btnGhost}
                      onClick={() => {
                        setEditing(r)
                        setMode('edit')
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      className="text-xs text-red-500 hover:text-red-700"
                      disabled={del.isPending}
                      onClick={() => {
                        if (confirm(`Xoá partner "${r.name}" (${r.partner_code})?`)) del.mutate(r.partner_code)
                      }}
                    >
                      Xoá
                    </button>
                  </div>
                </Cell>
              </Row>
            )
          })}
        </Table>
      )}

      {del.error && <ErrorBox error={del.error} />}
    </div>
  )
}
