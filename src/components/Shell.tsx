import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { myProfile, promotionCandidates, tags } from '../lib/queries'

const NAV = [
  { to: '/lessons', label: 'Lessons' },
  { to: '/', label: 'Dashboard', end: true },
  { to: '/runs', label: 'Runs' },
  { to: '/bugs', label: 'Bugs' },
  { to: '/libraries', label: 'Libraries' },
  { to: '/tags', label: 'Tags' },
]

export default function Shell({ email }: { email: string }) {
  // Hai con số duy nhất được phép hiện ở nav: chúng là HÀNG ĐỢI VIỆC PHẢI LÀM,
  // không phải số liệu trang trí.
  const pending = useQuery({ queryKey: ['promotion'], queryFn: promotionCandidates })
  const newTags = useQuery({ queryKey: ['tags'], queryFn: tags })
  const newTagCount = newTags.data?.filter((t) => t.status === 'new').length ?? 0
  // Chỉ admin thấy mục Users. Đây thuần tuý là dọn giao diện — quyền THẬT do RLS
  // ở DB thực thi, member có gõ thẳng /users cũng không sửa được gì.
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  const nav = me.data?.role === 'admin' ? [...NAV, { to: '/users', label: 'Users' }] : NAV

  const [appVersion, setAppVersion] = useState<string>('')
  const [latestVersion, setLatestVersion] = useState<string>('')
  const [versionChecking, setVersionChecking] = useState(false)

  useEffect(() => {
    // Lấy version từ package.json
    const fetchVersion = async () => {
      try {
        const response = await fetch('/package.json')
        const pkg = await response.json()
        setAppVersion(pkg.version)
      } catch (err) {
        console.error('Failed to fetch version:', err)
      }
    }
    fetchVersion()
  }, [])

  useEffect(() => {
    // Check version từ server
    const checkLatestVersion = async () => {
      setVersionChecking(true)
      try {
        const response = await fetch('https://api.github.com/repos/kola-projects/af-console/contents/package.json')
        const data = await response.json()
        // Decode base64
        const content = atob(data.content)
        const pkg = JSON.parse(content)
        setLatestVersion(pkg.version)
      } catch (err) {
        console.error('Failed to check latest version:', err)
      } finally {
        setVersionChecking(false)
      }
    }
    checkLatestVersion()
  }, [])

  const isLatestVersion = appVersion === latestVersion || !latestVersion

  return (
    <div className="mx-auto flex min-h-full max-w-[1400px] gap-6 px-6 py-6">
      <nav className="w-44 flex-none">
        <div className="mb-4 px-2">
          <div className="text-sm">af-console</div>
          <div className="text-[11px] text-neutral-500">App-Factory</div>
        </div>
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                isActive
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`
            }
          >
            {n.label}
            {n.label === 'Lessons' && !!pending.data?.length && (
              <span className="text-[11px]">{pending.data.length}</span>
            )}
            {n.label === 'Tags' && newTagCount > 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">{newTagCount}</span>
            )}
          </NavLink>
        ))}

        <div className="mt-6 border-t border-neutral-200 px-2 pt-3 dark:border-neutral-800">
          <div className="truncate text-[11px] text-neutral-500">{email}</div>
          {me.data && (
            <div className="text-[11px] text-neutral-400">{me.data.role}</div>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="mt-1 text-xs text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Đăng xuất
          </button>

          {/* Version info */}
          <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <div className="text-[11px] text-neutral-500">Version: {appVersion || 'loading...'}</div>
            {latestVersion && !isLatestVersion && (
              <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                Phiên bản {latestVersion} có sẵn
              </div>
            )}
            {isLatestVersion && latestVersion && (
              <div className="mt-1 text-[11px] text-green-600 dark:text-green-400">✓ Mới nhất</div>
            )}
            {versionChecking && (
              <div className="mt-1 text-[11px] text-neutral-400">Đang kiểm tra...</div>
            )}
          </div>
        </div>
      </nav>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
