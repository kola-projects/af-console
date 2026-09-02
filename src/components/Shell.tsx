import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  SlidersHorizontal,
  Play,
  Bug,
  Library,
  Megaphone,
  Hammer,
  Tag,
  Inbox,
  Store,
  Users,
  Factory,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { APP_VERSION, fetchLatestVersion } from '../lib/appVersion'
import { myProfile, promotionCandidates, tags } from '../lib/queries'

// Nav ADMIN: toàn bộ trang nội bộ. Nav NON-ADMIN: chỉ Apps + Yêu cầu (0023) —
// Runs/Lessons/Bugs… bị chặn ở RLS, ẩn khỏi nav để giao diện gọn.
type NavItem = { to: string; label: string; end?: boolean; icon: LucideIcon }
const ADMIN_NAV: NavItem[] = [
  { to: '/lessons', label: 'Lessons', icon: GraduationCap },
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/apps', label: 'Apps', icon: LayoutGrid },
  { to: '/manage-apps', label: 'Quản lý app', icon: SlidersHorizontal },
  { to: '/runs', label: 'Runs', icon: Play },
  { to: '/bugs', label: 'Bugs', icon: Bug },
  { to: '/libraries', label: 'Libraries', icon: Library },
  { to: '/ads', label: 'Ads', icon: Megaphone },
  { to: '/ads-builder', label: 'Ads Builder', icon: Hammer },
  { to: '/tags', label: 'Tags', icon: Tag },
  { to: '/requests', label: 'Yêu cầu', icon: Inbox },
  { to: '/stores', label: 'Stores', icon: Store },
  { to: '/users', label: 'Users', icon: Users },
]
const MEMBER_NAV: NavItem[] = [
  { to: '/apps', label: 'Apps', icon: LayoutGrid },
  { to: '/requests', label: 'Yêu cầu', icon: Inbox },
]

export default function Shell({ email }: { email: string }) {
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  const isAdmin = me.data?.role === 'admin'
  // Badge nav (promotion/tags) là bảng nội bộ — chỉ admin đọc được (RLS), chỉ gọi khi admin.
  const pending = useQuery({ queryKey: ['promotion'], queryFn: promotionCandidates, enabled: isAdmin })
  const newTags = useQuery({ queryKey: ['tags'], queryFn: tags, enabled: isAdmin })
  const newTagCount = newTags.data?.filter((t) => t.status === 'new').length ?? 0
  const nav = isAdmin ? ADMIN_NAV : MEMBER_NAV

  const appVersion = APP_VERSION
  const [latestVersion, setLatestVersion] = useState<string>('')
  const [versionChecking, setVersionChecking] = useState(false)

  useEffect(() => {
    setVersionChecking(true)
    fetchLatestVersion()
      .then((v) => {
        if (v) setLatestVersion(v)
      })
      .finally(() => setVersionChecking(false))
  }, [])

  const isLatestVersion = appVersion === latestVersion || !latestVersion

  return (
    <div className="mx-auto flex min-h-full max-w-[1400px] gap-6 px-6 py-6">
      <nav className="w-44 flex-none">
        <div className="mb-4 flex items-center gap-2 px-1">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm">
            <Factory className="h-4 w-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">af-console</div>
            <div className="text-[11px] text-neutral-500">App-Factory</div>
          </div>
        </div>
        {nav.map((n) => {
          const Icon = n.icon
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  isActive
                    ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-950 dark:text-primary-300'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
                }`
              }
            >
              <Icon className="h-4 w-4 flex-none" />
              <span className="flex-1 truncate">{n.label}</span>
              {n.label === 'Lessons' && !!pending.data?.length && (
                <span className="text-[11px]">{pending.data.length}</span>
              )}
              {n.label === 'Tags' && newTagCount > 0 && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">{newTagCount}</span>
              )}
            </NavLink>
          )
        })}

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
