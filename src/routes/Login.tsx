import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_VERSION, fetchLatestVersion } from '../lib/appVersion'
import { signUp, signupStatus } from '../lib/queries'
import type { SignupStatus } from '../lib/types'

type Mode = 'login' | 'signup'

export default function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SignupStatus | null>(null)
  const appVersion = APP_VERSION
  const [latestVersion, setLatestVersion] = useState<string>('')
  const [versionChecking, setVersionChecking] = useState(false)

  useEffect(() => {
    signupStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    setVersionChecking(true)
    fetchLatestVersion()
      .then((v) => {
        if (v) setLatestVersion(v)
      })
      .finally(() => setVersionChecking(false))
  }, [])

  // Chưa ai trong hệ thống -> luôn cho đăng ký và mở sẵn tab đó:
  // người đầu tiên sẽ là admin, không có đường nào khác để vào.
  useEffect(() => {
    if (status?.bootstrap) setMode('signup')
  }, [status])

  const canSignup = !!status && (status.enabled || status.bootstrap)
  const isLatestVersion = appVersion === latestVersion || !latestVersion

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signup') {
        await signUp(email, password)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw new Error(error.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6 py-20">
      <h1 className="text-lg">af-console</h1>
      <p className="mt-1 text-sm text-neutral-500">Bảng điều khiển App-Factory.</p>

      {/* Version info */}
      <div className="mt-3 rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
        <div>Version: {appVersion || 'loading...'}</div>
        {latestVersion && !isLatestVersion && (
          <div className="mt-1 text-amber-600 dark:text-amber-400">
            Phiên bản mới {latestVersion} có sẵn — tải lại trang để cập nhật
          </div>
        )}
        {isLatestVersion && latestVersion && (
          <div className="mt-1 text-green-600 dark:text-green-400">✓ Đang dùng phiên bản mới nhất</div>
        )}
        {versionChecking && <div className="mt-1">Đang kiểm tra phiên bản...</div>}
      </div>

      {status?.bootstrap && (
        <div className="mt-4 rounded border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
          Hệ thống chưa có tài khoản nào. <strong>Người đăng ký đầu tiên sẽ là admin.</strong>
        </div>
      )}

      {canSignup && !status?.bootstrap && (
        <div className="mt-4 flex gap-1 text-sm">
          {(
            [
              ['login', 'Đăng nhập'],
              ['signup', 'Đăng ký'],
            ] as [Mode, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setMode(k)
                setError(null)
              }}
              className={`rounded px-2.5 py-1 ${
                mode === k
                  ? 'bg-primary-600 hover:bg-primary-700 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'signup' ? 'Mật khẩu (tối thiểu 6 ký tự)' : 'Mật khẩu'}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          disabled={busy}
          className="w-full rounded bg-primary-600 hover:bg-primary-700 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? 'Đang xử lý…' : mode === 'signup' ? 'Đăng ký' : 'Đăng nhập'}
        </button>
      </form>

      {mode === 'signup' && (
        <p className="mt-2 text-xs text-neutral-500">
          Không cần xác nhận email — đăng ký xong vào thẳng.
        </p>
      )}

      {status && !canSignup && (
        <p className="mt-3 text-xs text-neutral-500">
          Đăng ký đang tắt. Liên hệ admin để được cấp tài khoản.
        </p>
      )}

      {error && (
        <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  )
}
