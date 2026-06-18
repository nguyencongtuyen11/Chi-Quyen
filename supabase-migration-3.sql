-- =====================================================================
--  OPENMUSIC — MIGRATION 3: Hồ sơ giáo viên (HR)
--  Chạy 1 lần: Supabase -> SQL Editor -> New query -> dán -> Run.
--  An toàn để chạy lại nhiều lần (idempotent).
-- =====================================================================

alter table public.teachers add column if not exists hire_date   date;     -- ngày vào làm
alter table public.teachers add column if not exists dob         date;     -- ngày sinh
alter table public.teachers add column if not exists gender      text;     -- Nam / Nữ / Khác
alter table public.teachers add column if not exists hometown    text;     -- quê quán
alter table public.teachers add column if not exists address     text;     -- địa chỉ hiện tại
alter table public.teachers add column if not exists national_id text;     -- CCCD/CMND
alter table public.teachers add column if not exists specialty   text;     -- chuyên môn / nhạc cụ
alter table public.teachers add column if not exists email       text;     -- email liên hệ
alter table public.teachers add column if not exists status      text not null default 'active'; -- active / inactive
