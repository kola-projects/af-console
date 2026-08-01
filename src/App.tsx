import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Shell from './components/Shell'
import Login from './routes/Login'
import Dashboard from './routes/Dashboard'
import Lessons from './routes/Lessons'
import Runs from './routes/Runs'
import RunDetail from './routes/RunDetail'
import Apps from './routes/Apps'
import AppDetail from './routes/AppDetail'
import Bugs from './routes/Bugs'
import Libraries from './routes/Libraries'
import Tags from './routes/Tags'
import Users from './routes/Users'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
})

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
            <Route index element={<Dashboard />} />
            <Route path="lessons" element={<Lessons />} />
            <Route path="apps" element={<Apps />} />
            <Route path="apps/:id" element={<AppDetail />} />
            <Route path="runs" element={<Runs />} />
            <Route path="runs/:id" element={<RunDetail />} />
            <Route path="bugs" element={<Bugs />} />
            <Route path="libraries" element={<Libraries />} />
            <Route path="tags" element={<Tags />} />
            <Route path="users" element={<Users />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
