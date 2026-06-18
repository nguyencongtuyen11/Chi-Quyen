-- =====================================================================
--  OPENMUSIC — MIGRATION 2: Loại lớp (cá nhân/đôi/nhóm) + lương theo loại
--  Chạy 1 lần: Supabase -> SQL Editor -> New query -> dán -> Run.
--  An toàn để chạy lại nhiều lần (idempotent).
-- =====================================================================

-- 1) lesson_type cho buổi học & học sinh
--    'ca_nhan' = cá nhân (1 kèm 1) · 'doi' = đôi · 'nhom' = nhóm
alter table public.schedules add column if not exists lesson_type text not null default 'ca_nhan';
alter table public.students  add column if not exists lesson_type text not null default 'ca_nhan';

-- 2) Bảng lương giáo viên theo loại lớp (jsonb: {"ca_nhan":150000,"doi":120000,"nhom":90000})
alter table public.teachers  add column if not exists pay_rates jsonb not null default '{}'::jsonb;

-- 3) Bảng giá / cấu hình mặc định (admin thiết lập 1 lần, dùng lại về sau)
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
