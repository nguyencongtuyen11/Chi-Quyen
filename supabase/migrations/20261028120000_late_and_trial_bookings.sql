-- =====================================================================
--  OPENMUSIC — MIGRATION 7: Đi muộn + Hẹn học thử
--  Chạy 1 lần: Supabase -> SQL Editor -> New query -> dán -> Run
--  (hoặc: npx --yes supabase db query --linked --project-ref ivilqvnljoucbsxzdvwf --file supabase-migration-7.sql)
--  An toàn để chạy lại nhiều lần (idempotent). Chỉ THÊM, không sửa/xóa dữ liệu cũ.
-- =====================================================================
begin;

-- 1) Điểm danh "Muộn": vẫn là có mặt (present = true) + đánh dấu muộn và số phút muộn
alter table public.attendance add column if not exists late boolean not null default false;
alter table public.attendance add column if not exists late_minutes int check (late_minutes is null or late_minutes between 0 and 600);

-- 2) Hẹn học thử / kiểm tra trình độ của khách hàng mới — chỉ ADMIN
create table if not exists public.trial_bookings (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  guardian         text,
  phone            text,
  subject          text,
  teacher_id       uuid references public.teachers (id) on delete set null,
  start_at         timestamptz not null,
  duration_minutes int  not null default 60 check (duration_minutes between 5 and 600),
  room             text,
  note             text,
  status           text not null default 'pending' check (status in ('pending','attended','no_show','cancelled','converted')),
  student_id       uuid references public.students (id) on delete set null,   -- khi đã chuyển thành học sinh
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.trial_bookings enable row level security;
create index if not exists trial_bookings_start_idx on public.trial_bookings (start_at);
drop policy if exists "trial_admin_all" on public.trial_bookings;
create policy "trial_admin_all" on public.trial_bookings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.trial_bookings to authenticated;
revoke all on public.trial_bookings from anon;

-- 3) Nhắc hẹn qua thông báo đẩy: chống gửi trùng (mỗi thiết bị × mỗi lịch hẹn × giờ hẹn = 1 lần)
create table if not exists public.push_trial_deliveries (
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  trial_id        uuid not null references public.trial_bookings (id) on delete cascade,
  start_at        timestamptz not null,
  status          text not null default 'pending' check (status in ('pending','sent','failed')),
  lease_until     timestamptz not null,
  sent_at         timestamptz,
  primary key (subscription_id, trial_id, start_at)
);
alter table public.push_trial_deliveries enable row level security;
revoke all on public.push_trial_deliveries from anon, authenticated;

create or replace function public.claim_push_trial_delivery(p_sub uuid, p_trial uuid, p_start timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed boolean;
begin
 insert into public.push_trial_deliveries(subscription_id, trial_id, start_at, status, lease_until)
 values (p_sub, p_trial, p_start, 'pending', now() + interval '2 minutes')
 on conflict (subscription_id, trial_id, start_at) do update
 set status = 'pending', lease_until = now() + interval '2 minutes'
 where push_trial_deliveries.status <> 'sent' and push_trial_deliveries.lease_until < now()
 returning true into claimed;
 return coalesce(claimed, false);
end; $$;
revoke all on function public.claim_push_trial_delivery(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_push_trial_delivery(uuid, uuid, timestamptz) to service_role;
grant all on public.trial_bookings, public.push_trial_deliveries to service_role;

-- Số phút nhắc trước giờ hẹn (admin đổi trong Cài đặt), mặc định 60
insert into public.app_settings (key, value) values ('trial_lead_minutes', '60'::jsonb)
on conflict (key) do nothing;

commit;
