-- =====================================================================
--  OPENMUSIC — MIGRATION 5: Ghi chú điểm danh học sinh (lý do nghỉ)
--  Chạy 1 lần: Supabase -> SQL Editor -> New query -> dán -> Run.
--  An toàn để chạy lại nhiều lần (idempotent).
--
--  Mục đích: khi 1 học sinh trong lớp NGHỈ, giáo viên/admin ghi lại
--  lý do (VD "ốm", "bận", "xin phép"). Ghi chú này hiện trong PDF
--  theo dõi buổi học của từng học sinh (cho phụ huynh xem).
-- =====================================================================

alter table public.attendance add column if not exists note text;
