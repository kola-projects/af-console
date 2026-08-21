import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './lib/supabase'
import { myProfile } from './lib/queries'
import Shell from './components/Shell'
import Login from './routes/Login'
import Dashboard from './routes/Dashboard'
import Lessons from './routes/Lessons'
import Runs from './routes/Runs'
import RunDetail from './routes/RunDetail'
import Apps from './routes/Apps'
import ManageApps from './routes/ManageApps'
import AppDetail, { ManageAppDetail } from './routes/AppDetail'
import Bugs from './routes/Bugs'
import Libraries from './routes/Libraries'
import Tags from './routes/Tags'
import Users from './routes/Users'
import Requests from './routes/Requests'
import Ads from './routes/Ads'
import AdsAppDetail from './routes/AdsAppDetail'
import AdsScenarioDetail from './routes/AdsScenarioDetail'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
})

/** Chặn trang NỘI BỘ (Runs/Lessons/Bugs/Dashboard/Users…) với non-admin.
 *  RLS đã chặn dữ liệu; đây chỉ để non-admin không rơi vào trang rỗng/permission —
 *  đá về /apps. Đang tải hồ sơ thì chưa render (tránh nháy). */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: myProfile })
  if (me.isLoading) return null
  if (me.data?.role !== 'admin') return <Navigate to="/apps" replace />
  return <>{children}</>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) return null
  // Chưa đăng nhập thì chỉ render màn login. RLS mới là lớp chặn THẬT — chỗ này
  // chỉ để giao diện không hiện một loạt bảng rỗng khó hiểu.
  if (!session) return <Login />

  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell email={session.user.email ?? ''} />}>
            {/* Công khai cho mọi user còn hiệu lực (RLS lọc dữ liệu) */}
            <Route path="apps" element={<Apps />} />
            <Route path="apps/:id" element={<AppDetail />} />
            <Route path="requests" element={<Requests />} />
            {/* Nội bộ — chỉ admin */}
            <Route path="manage-apps" element={<RequireAdmin><ManageApps /></RequireAdmin>} />
            <Route path="manage-apps/:id" element={<RequireAdmin><ManageAppDetail /></RequireAdmin>} />
            <Route index element={<RequireAdmin><Dashboard /></RequireAdmin>} />
            <Route path="lessons" element={<RequireAdmin><Lessons /></RequireAdmin>} />
            <Route path="runs" element={<RequireAdmin><Runs /></RequireAdmin>} />
            <Route path="runs/:id" element={<RequireAdmin><RunDetail /></RequireAdmin>} />
            <Route path="bugs" element={<RequireAdmin><Bugs /></RequireAdmin>} />
            <Route path="libraries" element={<RequireAdmin><Libraries /></RequireAdmin>} />
            <Route path="ads" element={<RequireAdmin><Ads /></RequireAdmin>} />
            <Route path="ads/apps/:app" element={<RequireAdmin><AdsAppDetail /></RequireAdmin>} />
            <Route
              path="ads/scenarios/:id/:version"
              element={<RequireAdmin><AdsScenarioDetail /></RequireAdmin>}
            />
            <Route path="tags" element={<RequireAdmin><Tags /></RequireAdmin>} />
            <Route path="users" element={<RequireAdmin><Users /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/apps" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
