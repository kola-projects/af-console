import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  appSettings,
  appUsers,
  myProfile,
  setSignupEnabled,
  setUserActive,
  setUserRole,
} from '../lib/queries'
import type { UserRole } from '../lib/types'
import { Badge, Cell, ErrorBox, Loading, Mono, Row, Table, localTime } from '../components/ui'

export default function Users() {
  const qc = useQueryClient()
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
        Người đăng ký đầu tiên của hệ thống là admin. Quyền do <Mono>RLS</Mono> ở DB thực thi — ẩn nút
        trên giao diện không phải là biện pháp bảo vệ.
      </p>

      {mutationError && (
        <div className="mt-3">
          <ErrorBox error={mutationError} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-neutral-50 px-4 py-3 dark:bg-neutral-900">
        <div className="flex-1">
          <div className="text-sm">Cho phép đăng ký</div>
          <div className="text-xs text-neutral-500">
            {settings.data?.signup_enabled
              ? 'Đang bật — ai biết địa chỉ trang đều tự tạo được tài khoản.'
              : 'Đang tắt — trigger ở DB chặn mọi lượt đăng ký mới.'}
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
          Bạn đang là <Mono>member</Mono> — chỉ xem được, không đổi được gì ở màn này.
        </p>
      )}

      <div className="mt-5">
        <Table head={['Email', 'Vai trò', 'Trạng thái', 'Tạo lúc', '']}>
          {users.data?.map((u) => {
            const isMe = u.id === me.data?.id
            // Không cho hạ cấp / khoá admin CUỐI CÙNG còn hoạt động — mất admin
            // là mất luôn đường bật lại đăng ký và cấp quyền, tức khoá chết hệ thống.
            const lastAdmin = u.role === 'admin' && u.is_active && admins <= 1
            return (
              <Row key={u.id}>
                <Cell>
                  <Mono>{u.email ?? '—'}</Mono>
                  {isMe && <span className="ml-2 text-xs text-neutral-500">(bạn)</span>}
                </Cell>
                <Cell>
                  {u.role === 'admin' ? <Badge tone="good">admin</Badge> : <Badge>member</Badge>}
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
                  {isAdmin && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={lastAdmin || changeRole.isPending}
                        title={lastAdmin ? 'Không thể hạ cấp admin cuối cùng' : undefined}
                        onClick={() =>
                          changeRole.mutate({
                            id: u.id,
                            role: u.role === 'admin' ? 'member' : 'admin',
                          })
                        }
                        className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                      >
                        {u.role === 'admin' ? 'Hạ thành member' : 'Nâng thành admin'}
                      </button>
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
                    </div>
                  )}
                </Cell>
              </Row>
            )
          })}
        </Table>
      </div>
    </div>
  )
}
