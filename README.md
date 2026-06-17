# 🎵 OPENMUSIC — Quản lý Trung tâm Nghệ thuật

Web quản lý **Thời khóa biểu · Điểm danh · Tính lương giáo viên · Học phí học sinh** cho
Trung tâm Nghệ thuật **OPENMUSIC**. Học theo (clone) dự án "Thời khóa biểu Giáo viên" và mở rộng thêm
điểm danh, tính số buổi, tính lương/học phí, thông báo nhắc lớp và thông báo kết thúc khóa.

Web **tĩnh** (HTML/CSS/JS thuần) + **Supabase** (Auth + Postgres + RLS). Tối ưu cho **máy tính, máy tính bảng và điện thoại**.

---

## ✨ Tính năng

- ✅ **Đăng nhập / Đăng ký + Quên mật khẩu / Đặt lại mật khẩu qua email** (giống dự án mẫu, dùng Supabase Auth).
- ✅ **Thời khóa biểu tuần**: lưới Thứ 2 → CN × Sáng/Chiều/Tối trên máy tính, tự chuyển **danh sách theo ngày** trên điện thoại; điều hướng tuần/tháng, "Tuần này", chọn ngày nhanh.
- ✅ **Hôm nay & Điểm danh**: nút **tích** từng học sinh **Có mặt / Vắng**, thể hiện **trạng thái** trực tiếp; **điểm danh giáo viên** (Có dạy / Nghỉ).
- ✅ **Tính số buổi**: số buổi học sinh đã học = số lần được điểm danh "có mặt"; số buổi giáo viên đã dạy = số lần điểm danh "có dạy".
- ✅ **Tính lương giáo viên** = số buổi đã dạy × lương mỗi buổi (lọc theo khoảng ngày / tháng).
- ✅ **Tính học phí học sinh** = số buổi đã học × học phí/buổi; xuất **CSV**.
- ✅ **Thông báo kết thúc khóa** theo từng học sinh (vd 12 buổi, 24 buổi): tự báo **sắp kết thúc** (còn ≤ 2 buổi) và **đã kết thúc**.
- ✅ **Nhắc lớp học hôm nay** trước **2 tiếng** (tùy chỉnh số phút trong Cài đặt) bằng thanh nhắc + popup trình duyệt — để không bị lỡ lớp.
- ✅ **Phân quyền**:
  - **Giáo viên**: chỉ **xem lịch dạy của mình** và **điểm danh** lớp của mình; **không** thấy lịch giáo viên khác, **không** thấy mục lương/học phí.
  - **Admin**: **toàn quyền** — menu đầy đủ, thêm/sửa/xóa lịch, quản lý học sinh & giáo viên, tính lương, tính học phí.
- ✅ Giao diện **tối / sáng**, responsive **web · tablet · điện thoại**.
- ✅ Bảo mật bằng **Row Level Security (RLS)** ngay trong database.
- ✅ **Chế độ DEMO**: chưa cấu hình Supabase vẫn chạy & dùng thử ngay (dữ liệu lưu trên trình duyệt).

---

## 🚀 Chạy nhanh (DEMO — không cần Supabase)

Mở thử ngay không cần cài gì:

- Cách nhanh: nháy đúp **`index.html`**.
- Khuyến nghị (Auth ổn định khi gắn Supabase): chạy server tĩnh rồi mở http://localhost:5500
  ```powershell
  python -m http.server 5500
  ```
  Hoặc dùng VS Code + **Live Server**.

Khi **chưa** điền Supabase, web tự chạy **chế độ DEMO** với dữ liệu mẫu. Tài khoản đăng nhập thử:

| Vai trò | Email | Mật khẩu |
|--------|-------|----------|
| Admin | `admin@openmusic.vn` | `123456` |
| Giáo viên | `co.lan@openmusic.vn` | `123456` |
| Giáo viên | `thay.nam@openmusic.vn` | `123456` |

> Dữ liệu DEMO lưu trên trình duyệt. Vào **Cài đặt → Đặt lại dữ liệu DEMO** để khôi phục dữ liệu mẫu ban đầu.

---

## 🔌 Kết nối Supabase (dùng thật)

1. Tạo project tại https://supabase.com
2. **SQL Editor** → New query → dán toàn bộ [`supabase-setup.sql`](supabase-setup.sql) → **Run**.
3. Mở [`config.js`](config.js), điền 2 giá trị (lấy ở **Project Settings → Data API / API Keys**):
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",   // Project URL (không kèm /rest/v1/)
     SUPABASE_ANON_KEY: "eyJhbGciOi...",          // anon / public key
   };
   ```
4. Tải lại web — app tự chuyển sang **Supabase**. Góc dưới menu sẽ hiện "● Đã kết nối Supabase".

> `anon key` được phép công khai trên trình duyệt — bảo mật thật sự nằm ở **RLS** trong `supabase-setup.sql`.

### 👤 Tạo Admin
Mọi người đăng ký đều là **giáo viên**. Để cấp quyền Admin, sau khi tài khoản đã đăng ký, chạy (đổi email):
```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'admin@openmusic.vn');
```

### 🔑 Quên mật khẩu qua email — cấu hình
Tính năng "Quên mật khẩu" gửi email chứa **liên kết đặt lại**. Để liên kết mở đúng web:
- Supabase → **Authentication → URL Configuration**
  - **Site URL**: địa chỉ web của bạn (vd `https://openmusic.vercel.app` hoặc `http://localhost:5500`)
  - **Redirect URLs**: thêm địa chỉ đó (vd `http://localhost:5500/**`)
- (Tùy chọn) **Authentication → Emails** để Việt hóa nội dung email.

---

## 🧱 Mô hình dữ liệu

| Bảng | Vai trò |
|------|---------|
| `profiles` | Tài khoản đăng nhập + vai trò (`teacher` / `admin`). |
| `teachers` | Danh sách giáo viên (roster). Có `pay_per_session` (lương mỗi buổi), `user_id` để gắn tài khoản. |
| `students` | Học sinh + khóa học: `total_sessions` (số buổi của khóa), `tuition_per_session` (học phí/buổi), `status`. |
| `schedules` | Buổi học theo ngày, gắn vào `teachers`. Có `teacher_present` (điểm danh giáo viên). |
| `attendance` | Điểm danh **học sinh** từng buổi: `present` = null (chưa) / true (có mặt) / false (vắng). |

**Cách tính:**
- Buổi học sinh đã học = số dòng `attendance.present = true` của em đó. **Còn lại** = `total_sessions − đã học`.
- Học phí thực thu = đã học × `tuition_per_session`.
- Buổi giáo viên đã dạy = số `schedules.teacher_present = true`. **Lương** = đã dạy × `pay_per_session`.

### Quyền (RLS)
| Hành động | Giáo viên | Admin |
|-----------|:--------:|:-----:|
| Xem lịch của mình | ✅ | ✅ (xem tất cả) |
| Xem lịch giáo viên khác | ❌ | ✅ |
| Thêm/xóa buổi học (xây TKB) | ❌ | ✅ |
| Điểm danh HS + GV trong lớp của mình | ✅ | ✅ |
| Quản lý học sinh / giáo viên | ❌ | ✅ |
| Tính lương / học phí | ❌ | ✅ |

---

## 🗂️ File trong dự án

| File | Vai trò |
|------|---------|
| `index.html` | Cấu trúc trang (auth + sidebar menu + các view + modal). |
| `styles.css` | Giao diện (theme tối/sáng, glass, responsive web/tablet/mobile). |
| `backend.js` | Lớp truy cập dữ liệu: tự chọn **Supabase** hoặc **DEMO** (localStorage). |
| `app.js` | Logic: auth, router, điểm danh, tính lương/học phí, thông báo, phân quyền. |
| `config.js` | **Bạn điền** URL + anon key Supabase. |
| `supabase-setup.sql` | SQL cài đặt đầy đủ (bảng + trigger + RLS). |

---

## ☁️ Đưa lên mạng
Web tĩnh, deploy dễ: kéo-thả thư mục lên **Netlify** (https://app.netlify.com/drop), **Vercel** hoặc **Cloudflare Pages**.
Nhớ cập nhật **Site URL / Redirect URLs** trong Supabase theo tên miền mới (mục Quên mật khẩu ở trên).
