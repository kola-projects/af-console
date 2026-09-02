import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminCreateUser,
  adminSetUserPassword,
  appSettings,
  appUsers,
  myProfile,
  setSignupEnabled,
  setUserActive,
  setUserRole,
} from '../lib/queries'
import { ASSIGNABLE_ROLES, type UserRole } from '../lib/types'
import { Badge, Cell, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'
import ChangePassword from './ChangePassword'

function CreateUser({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('dev')
  const [ok, setOk] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => adminCreateUser(email, password, role),
    onSuccess: () => {
      setOk(email)
      setEmail('')
      setPassword('')
      setRole('dev')
      onDone()
    },
  })

  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="text-sm">Tạo người dùng</div>
      <p className="mt-1 text-xs text-neutral-500">
        Nhập email + mật khẩu + vai trò. Không cần verify email — tạo xong dùng ngay. Session của bạn
        không bị đăng xuất.
      </p>
      {create.error && (
        <div className="mt-3">
          <ErrorBox error={create.error} />
        </div>
      )}
      {ok && !create.error && (
        <div className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Đã tạo <Mono>{ok}</Mono>.
        </div>
      )}
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setOk(null)
          create.mutate()
        }}
      >
        <div className="min-w-[220px] flex-1">
          <label className="block text-xs text-neutral-500">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@binarybridge.dev"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="block text-xs text-neutral-500">Mật khẩu</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="tối thiểu 6 ký tự"
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Vai trò</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button
          disabled={create.isPending}
          className="rounded bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {create.isPending ? 'Đang tạo…' : 'Tạo người dùng'}
        </button>
      </form>
    </div>
  )
}

/** Admin đặt mật khẩu mới cho user khác (modal). */
function SetUserPassword({
  user,
  onClose,
}: {
  user: { id: string; email: string | null }
  onClose: () => void
}) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const m = useMutation({
    mutationFn: () => adminSetUserPassword(user.id, pw),
    onSuccess: () => {
      setOk(true)
      setTimeout(onClose, 1500)
    },
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (pw.length < 6) return setErr('Mật khẩu tối thiểu 6 ký tự')
    if (pw !== pw2) return setErr('Mật khẩu xác nhận không khớp')
    m.mutate()
  }
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-neutral-900">
        <h2 className="text-lg font-medium">Đổi mật khẩu user</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Đặt mật khẩu mới cho <Mono>{user.email ?? user.id}</Mono>.
        </p>
        {(err || m.error) && (
          <div className="mt-3">
            <ErrorBox error={err || m.error} />
          </div>
        )}
        {ok && (
          <div className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            Đã đổi mật khẩu. Đang đóng…
          </div>
        )}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="password"
            required
            minLength={6}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Mật khẩu mới (≥6 ký tự)"
            autoComplete="new-password"
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
          <input
            type="password"
            required
            minLength={6}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Nhập lại mật khẩu"
            autoComplete="new-password"
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={m.isPending}
              className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={m.isPending}
              className="flex-1 rounded bg-primary-600 hover:bg-primary-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              {m.isPending ? 'Đang đổi…' : 'Đổi mật khẩu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Users() {
  const qc = useQueryClient()
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [pwUser, setPwUser] = useState<{ id: string; email: string | null } | null>(null)
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  const users = useQuery({ queryKey: ['app-users'], queryFn: appUsers })
  const settings = useQuery({ queryKey: ['app-settings'], queryFn: appSettings })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['app-users'] })
    qc.invalidateQueries({ queryKey: ['app-settings'] })
  }
  const toggleSignup = useMutation({ mutationFn: setSignupEnabled, onSuccess: invalidate })
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => setUserRole(id, role),
    onSuccess: invalidate,
  })
  const changeActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setUserActive(id, active),
    onSuccess: invalidate,
  })

  if (me.isLoading || users.isLoading || settings.isLoading) return <Loading />
  const err = me.error || users.error || settings.error
  if (err) return <ErrorBox error={err} />

  const isAdmin = me.data?.role === 'admin'
  const admins = users.data?.filter((u) => u.role === 'admin' && u.is_active).length ?? 0
  const mutationError = toggleSignup.error || changeRole.error || changeActive.error

  return (
    <div>
      <h1 className="text-lg">Users</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Quyền do <Mono>RLS</Mono> ở DB thực thi — ẩn nút trên giao diện không phải là biện pháp bảo vệ.
        v1: <Mono>dev</Mono>/<Mono>ua</Mono>/<Mono>aso</Mono> quyền giống nhau (đọc + đặt yêu cầu).
      </p>

      {mutationError && (
        <div className="mt-3">
          <ErrorBox error={mutationError} />
        </div>
      )}

      {isAdmin && (
        <div className="mt-4">
          <CreateUser onDone={invalidate} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-neutral-50 px-4 py-3 dark:bg-neutral-900">
        <div className="flex-1">
          <div className="text-sm">Cho phép tự đăng ký</div>
          <div className="text-xs text-neutral-500">
            {settings.data?.signup_enabled
              ? 'Đang bật — ai biết địa chỉ trang đều tự tạo được tài khoản. Nên TẮT khi đã tạo user bằng tay.'
              : 'Đang tắt — chỉ admin tạo user (invite-only). Trigger DB chặn mọi lượt tự đăng ký.'}
          </div>
        </div>
        <button
          disabled={!isAdmin || toggleSignup.isPending}
          onClick={() => toggleSignup.mutate(!settings.data?.signup_enabled)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          {settings.data?.signup_enabled ? 'Tắt đăng ký' : 'Bật đăng ký'}
        </button>
      </div>

      {!isAdmin && (
        <p className="mt-2 text-xs text-neutral-500">
          Bạn không phải admin — chỉ xem được, không đổi được gì ở màn này.
        </p>
      )}

      <div className="mt-5">
        <Table head={['Email', 'Vai trò', 'Trạng thái', 'Tạo lúc', '']}>
          {users.data?.map((u) => {
            const isMe = u.id === me.data?.id
            // Không cho hạ cấp / khoá admin CUỐI CÙNG còn hoạt động — mất admin
            // là mất luôn đường bật lại đăng ký và cấp quyền, tức khoá chết hệ thống.
            const lastAdmin = u.role === 'admin' && u.is_active && admins <= 1
            // Danh sách role cho ô chọn: các role gán được + role hiện tại (kể cả 'member' cũ).
            const roleOptions = Array.from(new Set<UserRole>([...ASSIGNABLE_ROLES, u.role]))
            return (
              <Row key={u.id}>
                <Cell>
                  <Mono>{u.email ?? '—'}</Mono>
                  {isMe && <span className="ml-2 text-xs text-neutral-500">(bạn)</span>}
                </Cell>
                <Cell>
                  {isAdmin ? (
                    <select
                      value={u.role}
                      disabled={lastAdmin || changeRole.isPending}
                      title={lastAdmin ? 'Không thể đổi vai trò admin cuối cùng' : undefined}
                      onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value as UserRole })}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : u.role === 'admin' ? (
                    <Badge tone="good">admin</Badge>
                  ) : (
                    <Badge>{u.role}</Badge>
                  )}
                </Cell>
                <Cell>
                  {u.is_active ? (
                    <span className="text-xs text-neutral-500">hoạt động</span>
                  ) : (
                    <Badge tone="bad">đã khoá</Badge>
                  )}
                </Cell>
                <Cell className="text-neutral-500">{localTime(u.created_at)}</Cell>
                <Cell>
                  <div className="flex flex-wrap gap-2">
                    {isMe && (
                      <button
                        onClick={() => setShowChangePassword(true)}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      >
                        Đổi mật khẩu
                      </button>
                    )}
                    {isAdmin && !isMe && (
                      <button
                        onClick={() => setPwUser({ id: u.id, email: u.email })}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      >
                        Đổi MK
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        disabled={lastAdmin || isMe || changeActive.isPending}
                        title={
                          lastAdmin
                            ? 'Không thể khoá admin cuối cùng'
                            : isMe
                              ? 'Không tự khoá chính mình'
                              : undefined
                        }
                        onClick={() => changeActive.mutate({ id: u.id, active: !u.is_active })}
                        className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                      >
                        {u.is_active ? 'Khoá' : 'Mở khoá'}
                      </button>
                    )}
                  </div>
                </Cell>
              </Row>
            )
          })}
        </Table>
      </div>

      {showChangePassword && <ChangePassword onClose={() => setShowChangePassword(false)} />}
      {pwUser && <SetUserPassword user={pwUser} onClose={() => setPwUser(null)} />}
    </div>
  )
}
