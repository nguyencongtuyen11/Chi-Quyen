begin;
create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 keys jsonb not null,
 lead_minutes int not null default 120 check (lead_minutes between 0 and 1440),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_test_at timestamptz
);
alter table public.push_subscriptions enable row level security;
-- Writes only through the authenticated Edge Function, with endpoint ownership checked.
grant select on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;
drop policy if exists push_read_own on public.push_subscriptions;
create policy push_read_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create index if not exists push_user_idx on public.push_subscriptions(user_id);

create table if not exists public.push_deliveries (
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 schedule_id uuid not null references public.schedules(id) on delete cascade,
 start_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','sent','failed')),
 lease_until timestamptz not null,
 sent_at timestamptz,
 primary key(subscription_id,schedule_id,start_at)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;

create or replace function public.claim_push_delivery(p_sub uuid,p_schedule uuid,p_start timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed boolean;
begin
 insert into public.push_deliveries(subscription_id,schedule_id,start_at,status,lease_until)
 values(p_sub,p_schedule,p_start,'pending',now()+interval '2 minutes')
 on conflict(subscription_id,schedule_id,start_at) do update
 set status='pending',lease_until=now()+interval '2 minutes'
 where push_deliveries.status <> 'sent' and push_deliveries.lease_until < now()
 returning true into claimed;
 return coalesce(claimed,false);
end; $$;
revoke all on function public.claim_push_delivery(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_push_delivery(uuid,uuid,timestamptz) to service_role;
grant all on public.push_subscriptions,public.push_deliveries to service_role;
commit;
