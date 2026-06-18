-- =====================================================================
--  OPENMUSIC — THIẾT LẬP CƠ SỞ DỮ LIỆU SUPABASE
--  Trung tâm Nghệ thuật OPENMUSIC — Thời khóa biểu • Điểm danh • Lương • Học phí
--  Dùng: Supabase Dashboard -> SQL Editor -> New query -> dán toàn bộ -> Run.
--  An toàn để chạy lại nhiều lần (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
--  1) PROFILES — tài khoản đăng nhập + vai trò (teacher / admin)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  role       text not null default 'teacher',   -- 'teacher' hoặc 'admin'
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------
--  2) TEACHERS — danh sách giáo viên (roster).
--     Admin tạo GV bằng TÊN; user_id gắn sau (null = chưa có tài khoản).
--     pay_per_session = lương mỗi buổi dạy (đ).
-- ---------------------------------------------------------------------
create table if not exists public.teachers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  user_id         uuid references auth.users (id) on delete set null,
  phone           text,
  pay_per_session numeric not null default 0,
  pay_rates       jsonb not null default '{}'::jsonb,
  note            text,
  hire_date       date,
  dob             date,
  gender          text,
  hometown        text,
  address         text,
  national_id     text,
  specialty       text,
  email           text,
  status          text not null default 'active',  -- active / inactive
  created_at      timestamptz not null default now()
);
alter table public.teachers enable row level security;
create unique index if not exists teachers_user_uidx on public.teachers(user_id) where user_id is not null;
-- nâng cấp bảng cũ (nếu đã tồn tại từ bản trước)
alter table public.teachers add column if not exists phone           text;
alter table public.teachers add column if not exists pay_per_session numeric not null default 0;
alter table public.teachers add column if not exists note            text;
alter table public.teachers add column if not exists pay_rates       jsonb not null default '{}'::jsonb;
alter table public.teachers add column if not exists hire_date       date;
alter table public.teachers add column if not exists dob             date;
alter table public.teachers add column if not exists gender          text;
alter table public.teachers add column if not exists hometown        text;
alter table public.teachers add column if not exists address         text;
alter table public.teachers add column if not exists national_id     text;
alter table public.teachers add column if not exists specialty       text;
alter table public.teachers add column if not exists email           text;
alter table public.teachers add column if not exists status          text not null default 'active';

-- ---------------------------------------------------------------------
--  3) STUDENTS — học sinh + thông tin khóa học
--     total_sessions      = số buổi của khóa (vd 12, 24)
--     tuition_per_session = học phí mỗi buổi (đ)
-- ---------------------------------------------------------------------
create table if not exists public.students (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  phone               text,
  guardian            text,                         -- phụ huynh
  subject             text,                         -- môn / nhạc cụ
  teacher_id          uuid references public.teachers (id) on delete set null,
  total_sessions      int  not null default 12,
  tuition_per_session numeric not null default 0,
  lesson_type         text not null default 'ca_nhan', -- ca_nhan / doi / nhom
  start_date          date,
  status              text not null default 'active', -- active / completed / paused
  note                text,
  created_at          timestamptz not null default now()
);
alter table public.students enable row level security;
create index if not exists students_teacher_idx on public.students (teacher_id);
alter table public.students add column if not exists lesson_type text not null default 'ca_nhan';

-- ---------------------------------------------------------------------
--  4) SCHEDULES — lịch học theo ngày, gắn vào teachers (roster)
--     teacher_present = điểm danh giáo viên (null=chưa, true=có dạy, false=nghỉ)
-- ---------------------------------------------------------------------
create table if not exists public.schedules (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references public.teachers (id) on delete cascade,
  schedule_date    date not null,
  subject          text not null,
  class_name       text,
  start_time       time not null,
  end_time         time not null,
  room             text,
  lesson_type      text not null default 'ca_nhan',  -- ca_nhan / doi / nhom (tính lương & học phí)
  teacher_name     text,                            -- tên GV (denormalized, để hiển thị)
  teacher_present  boolean,                          -- điểm danh GV
  teacher_marked_at timestamptz,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint time_order_valid check (end_time > start_time)
);
alter table public.schedules enable row level security;
create index if not exists schedules_teacher_idx on public.schedules (teacher_id);
create index if not exists schedules_date_idx    on public.schedules (schedule_date, start_time);
alter table public.schedules add column if not exists teacher_present   boolean;
alter table public.schedules add column if not exists teacher_marked_at timestamptz;
alter table public.schedules add column if not exists lesson_type       text not null default 'ca_nhan';

-- ---------------------------------------------------------------------
--  5) ATTENDANCE — điểm danh HỌC SINH trong từng buổi học
--     present = null (chưa điểm danh) / true (có đi) / false (vắng)
--     Chỉ buổi present=true mới tính vào "số buổi đã học" & học phí thực thu.
-- ---------------------------------------------------------------------
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  student_id  uuid not null references public.students  (id) on delete cascade,
  present     boolean,
  marked_at   timestamptz,
  marked_by   uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (schedule_id, student_id)
);
alter table public.attendance enable row level security;
create index if not exists attendance_schedule_idx on public.attendance (schedule_id);
create index if not exists attendance_student_idx  on public.attendance (student_id);

-- ---------------------------------------------------------------------
--  6) HÀM & TRIGGER
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Lịch (schedule) này có thuộc về giáo viên đang đăng nhập không?
create or replace function public.owns_schedule(sched uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.schedules s
    join public.teachers t on t.id = s.teacher_id
    where s.id = sched and t.user_id = auth.uid()
  );
$$;

-- Tự tạo profile khi có user mới đăng ký
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'teacher'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists schedules_touch_updated_at on public.schedules;
create trigger schedules_touch_updated_at
  before update on public.schedules
  for each row execute procedure public.touch_updated_at();

-- =====================================================================
--  7) RLS — PHÂN QUYỀN
--     Admin: toàn quyền. Giáo viên: chỉ xem & điểm danh LỊCH CỦA MÌNH.
-- =====================================================================

-- ---- PROFILES ----
drop policy if exists "profiles_select_all"  on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_select_all"  on public.profiles for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_insert_self" on public.profiles for insert to authenticated with check (id = auth.uid());

-- ---- TEACHERS ---- (ai cũng xem; chỉ Admin thêm/sửa/xóa)
drop policy if exists "teachers_select_all" on public.teachers;
drop policy if exists "teachers_admin_ins"  on public.teachers;
drop policy if exists "teachers_admin_upd"  on public.teachers;
drop policy if exists "teachers_admin_del"  on public.teachers;
create policy "teachers_select_all" on public.teachers for select to authenticated using (true);
create policy "teachers_admin_ins"  on public.teachers for insert to authenticated with check (public.is_admin());
create policy "teachers_admin_upd"  on public.teachers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "teachers_admin_del"  on public.teachers for delete to authenticated using (public.is_admin());

-- ---- STUDENTS ---- (ai cũng xem được tên HS để điểm danh; chỉ Admin thêm/sửa/xóa)
drop policy if exists "students_select_all" on public.students;
drop policy if exists "students_admin_ins"  on public.students;
drop policy if exists "students_admin_upd"  on public.students;
drop policy if exists "students_admin_del"  on public.students;
create policy "students_select_all" on public.students for select to authenticated using (true);
create policy "students_admin_ins"  on public.students for insert to authenticated with check (public.is_admin());
create policy "students_admin_upd"  on public.students for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "students_admin_del"  on public.students for delete to authenticated using (public.is_admin());

-- ---- SCHEDULES ----
--  Admin xem TẤT CẢ; Giáo viên chỉ xem lịch của MÌNH.
--  Admin thêm/xóa (xây thời khóa biểu). GV được cập nhật lịch của mình (để điểm danh GV).
drop policy if exists "schedules_select_own_admin" on public.schedules;
drop policy if exists "schedules_insert_admin"     on public.schedules;
drop policy if exists "schedules_update_own_admin" on public.schedules;
drop policy if exists "schedules_delete_admin"     on public.schedules;
-- gỡ policy bản cũ nếu có
drop policy if exists "schedules_select_all"       on public.schedules;
drop policy if exists "schedules_insert_own"       on public.schedules;
drop policy if exists "schedules_delete_own_admin" on public.schedules;

create policy "schedules_select_own_admin" on public.schedules for select to authenticated
  using ( public.is_admin() or exists (
    select 1 from public.teachers t where t.id = teacher_id and t.user_id = auth.uid()) );

create policy "schedules_insert_admin" on public.schedules for insert to authenticated
  with check ( public.is_admin() );

create policy "schedules_update_own_admin" on public.schedules for update to authenticated
  using ( public.is_admin() or exists (
    select 1 from public.teachers t where t.id = teacher_id and t.user_id = auth.uid()) )
  with check ( public.is_admin() or exists (
    select 1 from public.teachers t where t.id = teacher_id and t.user_id = auth.uid()) );

create policy "schedules_delete_admin" on public.schedules for delete to authenticated
  using ( public.is_admin() );

-- ---- ATTENDANCE ----
--  Admin toàn quyền; Giáo viên thao tác điểm danh HS trong lịch của mình.
drop policy if exists "attendance_select_own_admin" on public.attendance;
drop policy if exists "attendance_ins_own_admin"    on public.attendance;
drop policy if exists "attendance_upd_own_admin"    on public.attendance;
drop policy if exists "attendance_del_own_admin"    on public.attendance;

create policy "attendance_select_own_admin" on public.attendance for select to authenticated
  using ( public.is_admin() or public.owns_schedule(schedule_id) );
create policy "attendance_ins_own_admin" on public.attendance for insert to authenticated
  with check ( public.is_admin() or public.owns_schedule(schedule_id) );
create policy "attendance_upd_own_admin" on public.attendance for update to authenticated
  using ( public.is_admin() or public.owns_schedule(schedule_id) )
  with check ( public.is_admin() or public.owns_schedule(schedule_id) );
create policy "attendance_del_own_admin" on public.attendance for delete to authenticated
  using ( public.is_admin() or public.owns_schedule(schedule_id) );

-- ---------------------------------------------------------------------
--  7b) APP_SETTINGS — bảng giá / cấu hình mặc định (admin thiết lập 1 lần)
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings_select_all"  on public.app_settings;
drop policy if exists "settings_admin_write"  on public.app_settings;
create policy "settings_select_all" on public.app_settings for select to authenticated using (true);
create policy "settings_admin_write" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
--  7c) PAYMENTS — học sinh đóng học phí (chỉ Admin xem & quản lý)
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  paid_at     timestamptz not null default now(),
  amount      numeric not null default 0,
  sessions    int     not null default 0,
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.payments enable row level security;
create index if not exists payments_student_idx on public.payments (student_id);
create index if not exists payments_paid_idx    on public.payments (paid_at);
drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all" on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
--  8) CẤP QUYỀN ADMIN: sau khi tài khoản đã ĐĂNG KÝ, chạy (đổi email):
--     update public.profiles set role='admin'
--     where id = (select id from auth.users where email='admin@openmusic.vn');
-- =====================================================================
