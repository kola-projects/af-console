import { useState } from 'react'
import { changePassword } from '../lib/queries'
import { ErrorBox } from '../components/ui'

export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    // Validation
    if (!newPassword.trim()) {
      setError('Mật khẩu mới không được để trống')
      return
    }
    if (newPassword.length < 6) {
      setError('Mật khẩu phải có tối thiểu 6 ký tự')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp')
      return
    }

    setLoading(true)
    try {
      await changePassword(newPassword)
      setSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
      // Auto close after 2 seconds
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đổi mật khẩu thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 dark:bg-neutral-900">
        <h2 className="text-lg font-medium">Đổi mật khẩu</h2>
        <p className="mt-1 text-sm text-neutral-500">Nhập mật khẩu mới để cập nhật tài khoản của bạn.</p>

        {error && (
          <div className="mt-4">
            <ErrorBox error={error} />
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            Đổi mật khẩu thành công! Đang đóng cửa sổ…
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium">Mật khẩu mới</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Tối thiểu 6 ký tự"
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Xác nhận mật khẩu</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {loading ? 'Đang xử lý…' : 'Đổi mật khẩu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
