-- =====================================================================
--  OPENMUSIC — MIGRATION 4: Đóng học phí (payments)
--  Chạy 1 lần: Supabase -> SQL Editor -> New query -> dán -> Run.
--  An toàn để chạy lại nhiều lần (idempotent).
-- =====================================================================

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  paid_at     timestamptz not null default now(),   -- ngày giờ đóng
  amount      numeric not null default 0,            -- số tiền đóng
  sessions    int     not null default 0,            -- đóng cho bao nhiêu buổi
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.payments enable row level security;
create index if not exists payments_student_idx on public.payments (student_id);
create index if not exists payments_paid_idx    on public.payments (paid_at);

-- Chỉ ADMIN xem & quản lý học phí
drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all" on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
