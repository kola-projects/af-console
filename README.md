# af-console

Bảng điều khiển của [App-Factory](../app-factory). Chạy local, nối thẳng Supabase.

## Vì sao tồn tại

v3.0 chuyển bộ nhớ vận hành của App-Factory sang Supabase: mỗi build ghi lesson, bug, thư viện vào DB
và tra lại DB trước khi tự suy luận. Nhưng nó **cố ý để lại một lỗ hổng** — cổng duyệt lesson lên
`instructions/skills/*` được hoãn sang "web dashboard sau này".

Không có console, tri thức **vào được nhưng không ra được**: lesson chất đống ở trạng thái `candidate`
và kit không bao giờ học được gì. Đây chính là web đó.

## Chạy

```bash
cp .env.example .env.local     # điền URL + publishable key
npm install
npm run dev                    # http://localhost:5273
```

**Người đăng ký đầu tiên của hệ thống tự động là admin.** Mở trang lần đầu sẽ thấy thẳng tab đăng ký.
Không cần xác nhận email.

Từ người thứ hai trở đi, admin quyết định có cho đăng ký tiếp hay không (màn **Users** → *Tắt đăng ký*).

## Điều kiện tiên quyết

DB phải đã apply **cả hai** migration ở repo app-factory:

| Migration | Cho gì |
|---|---|
| `db/migrations/0001_init.sql` | Toàn bộ bảng + view |
| `db/migrations/0002_console.sql` | Trạng thái `approved`, **RLS**, `v_lesson_dead`, `v_graduation_queue` |
| `db/migrations/0003_count_backfill.sql` | Sửa ngưỡng duyệt (tính cả run backfill) |
| `db/migrations/0004_users.sql` | Đăng ký, phân quyền admin/member, cờ tắt đăng ký |

Thiếu `0002` thì đăng nhập xong vẫn không thấy gì (hoặc gặp lỗi RLS), và nút duyệt sẽ hỏng.

## Vòng duyệt lesson — hai nửa, hai nơi

Đây là điều quan trọng nhất cần hiểu về công cụ này:

```
af-console (web)                    app-factory (CLI)
─────────────────                   ─────────────────
bấm "Duyệt lên skills"
  → lessons.status = 'approved'
     graduated_to  = file đích
                                    ./tools/af_db.sh graduate
                                      → mở $EDITOR sửa câu chữ
                                      → chèn vào file + git commit
                                      → status = 'graduated'
                                         graduated_commit = <sha>
```

**Web không được tự đặt `graduated`.** Graduate nghĩa là sửa một file trong git repo trên máy — thứ
web không với tới. Nếu web tự đánh dấu, DB sẽ nói "đã tốt nghiệp" trong khi file chưa hề đổi, và
không ai truy ra được luật đó đến từ đâu.

Sau khi duyệt trên web, **phải chạy `af_db graduate`** thì vòng mới khép.

## Phân quyền

| | admin | member |
|---|---|---|
| Đọc/ghi dữ liệu AF (lessons, bugs, runs…) | ✅ | ✅ |
| Bật/tắt đăng ký | ✅ | ❌ |
| Nâng/hạ vai trò, khoá tài khoản | ✅ | ❌ |

Tài khoản bị khoá (`is_active = false`) không đọc được gì — RLS của cả 18 bảng dữ liệu đều đòi
`is_active_user()`.

Hai chốt chặn chống khoá chết hệ thống:
- Người **đầu tiên** luôn đăng ký được, kể cả khi cờ đăng ký đang tắt.
- Không hạ cấp / khoá được **admin cuối cùng** còn hoạt động.

## Bảo mật

- Chỉ dùng **publishable key**. Mọi biến `VITE_*` đều nằm trong bundle trình duyệt —
  [src/lib/supabase.ts](src/lib/supabase.ts) chặn cứng nếu ai đó dán nhầm secret key.
- Lớp bảo vệ thật là **RLS** (migration `0002`): `authenticated` làm được mọi thứ, `anon` không có
  policy nào. "Trang này chỉ chạy trên máy tôi" **không phải** một biện pháp bảo mật — Supabase nằm
  trên internet công cộng.
- Mọi view đều bật `security_invoker`. Thiếu nó thì view đi xuyên qua RLS và `anon` đọc được sạch dữ
  liệu dù RLS đã bật.

## Màn hình

| Màn | Trả lời câu gì |
|---|---|
| **Lessons** | Có nên đẩy lesson này lên `instructions/` không? Kèm tab *Không ai dùng* để dọn rác. |
| **Dashboard** | AF có thông minh hơn không? Cứu build phải tăng, tái diễn phải giảm. |
| **Runs / Run detail** | Run vừa rồi đã xảy ra chuyện gì? (thay việc đọc `AI_DECISION_LOG.md` bằng mắt) |
| **Bugs** | Lỗi này từng gặp chưa? Tra theo chữ ký lỗi. |
| **Libraries** | Thư viện này có dùng được không? Tỉ lệ tính từ kết quả thật. |
| **Tags** | Từ vựng có đang loạn không? Duyệt và gộp tag trùng nghĩa. |

## Quy ước code

- **Đọc chỉ qua view**, không `select` thẳng bảng tổng hợp — view là lớp đệm để đổi schema không vỡ
  client. Ngoại lệ: bảng con đọc theo khoá ngoại (`decisions`, `bugs`, `run_phases`) và `tags`.
- Giữ nguyên **tên cột tiếng Anh** trong giao diện (`applied_prevented`, `logic_compile_ok`) — người
  đọc cần khớp được với schema khi tra SQL.
- Màu có nghĩa: đỏ = `logic_compile_ok`/`failed`, vàng = chưa kiểm chứng/tag mới, lục = đã cứu build.
  Ngoài ba cái đó để xám.

## Còn thiếu (đọc trước khi tin)

- `v_promotion_candidates` không trả cột `verified_in_our_stack`, nên thẻ duyệt chưa chặn cứng lesson
  chưa kiểm chứng. Thực tế view đã lọc ≥3 app từ run thật của ta nên rủi ro thấp, nhưng muốn chặn
  tường minh thì cần thêm cột ở một migration sau.
- Mọi người đăng nhập đều đọc/ghi được **toàn bộ** dữ liệu AF — chưa phân quyền theo từng màn. Nếu
  sau này có người chỉ nên xem, cần thêm vai trò `viewer` và siết RLS theo lệnh (`select` vs `update`).
