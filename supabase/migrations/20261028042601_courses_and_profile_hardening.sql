-- Non-destructive upgrade for the existing Chi-Quyen database.
begin;
create table if not exists public.courses (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.students(id) on delete cascade,
 seq int not null default 1 check (seq > 0),
 total_sessions int not null default 12 check (total_sessions > 0),
 tuition_per_session numeric not null default 0 check (tuition_per_session >= 0),
 lesson_type text, start_date date, count_rule text, note text,
 created_at timestamptz not null default now(), unique(student_id, seq)
);
alter table public.courses enable row level security;
create index if not exists courses_student_idx on public.courses(student_id, seq);
drop policy if exists courses_select_all on public.courses;
create policy courses_select_all on public.courses for select to authenticated
 using (public.is_admin() or exists(select 1 from public.students s where s.id = student_id));
drop policy if exists courses_admin_ins on public.courses;
create policy courses_admin_ins on public.courses for insert to authenticated with check(public.is_admin());
drop policy if exists courses_admin_upd on public.courses;
create policy courses_admin_upd on public.courses for update to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists courses_admin_del on public.courses;
create policy courses_admin_del on public.courses for delete to authenticated using(public.is_admin());
grant select, insert, update, delete on public.courses to authenticated;
revoke all on public.courses from anon;
alter table public.attendance add column if not exists excused boolean not null default false;

-- Role changes are a trusted administration operation, never a self-service profile edit.
revoke update on public.profiles from public, anon, authenticated;
grant update(full_name, email) on public.profiles to authenticated;
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
 with check(id = (select auth.uid()) and role = 'teacher');
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles for select to authenticated
 using(public.is_admin() or id = (select auth.uid()));

-- Teachers may see their own personnel record and the students assigned to their lessons.
drop policy if exists teachers_select_all on public.teachers;
create policy teachers_select_all on public.teachers for select to authenticated
 using(public.is_admin() or user_id = (select auth.uid()));
drop policy if exists students_select_all on public.students;
create policy students_select_all on public.students for select to authenticated
 using(public.is_admin()
   or exists(select 1 from public.teachers t where t.id = teacher_id and t.user_id = (select auth.uid()))
   or exists(select 1 from public.attendance a where a.student_id = students.id and public.owns_schedule(a.schedule_id)));

alter function public.touch_updated_at() set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.owns_schedule(uuid) from public, anon;
-- These two identity-scoped helpers are required by authenticated RLS policies.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.owns_schedule(uuid) to authenticated;
commit;
