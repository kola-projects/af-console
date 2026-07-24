import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()

if (!url || !key) {
  throw new Error(
    'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_PUBLISHABLE_KEY. ' +
      'Local: copy .env.example → .env. Vercel: Settings → Environment Variables (Production).',
  )
}

if (!/^https?:\/\//i.test(url)) {
  throw new Error(
    `VITE_SUPABASE_URL không hợp lệ (cần https://…): ${JSON.stringify(url)}. ` +
      'Trên Vercel đừng bọc giá trị trong dấu ngoặc kép.',
  )
}

// Chốt chặn: bộ key mới của Supabase đặt tên rõ ràng (sb_secret_… vs sb_publishable_…),
// nên bắt được nhầm lẫn ngay lúc khởi động thay vì để một khoá ghi toàn quyền nằm
// trong bundle mà không ai biết. Bộ key cũ (JWT) không phân biệt được bằng tên —
// đó là một lý do nữa để dùng bộ mới.
if (key.startsWith('sb_secret_') || key.includes('service_role')) {
  throw new Error(
    'Đây là SECRET key, không phải publishable key. Mọi biến VITE_* đều lộ trong bundle trình duyệt — ' +
      'dùng publishable key và để RLS lo phần quyền.',
  )
}

export const supabase = createClient(url, key)
