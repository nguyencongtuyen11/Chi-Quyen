// =====================================================================
//  backend.js — Lớp truy cập dữ liệu OPENMUSIC
//  Trừu tượng hóa AUTH + CRUD cho 2 chế độ:
//    • SUPABASE  — khi config.js đã điền URL + ANON KEY hợp lệ
//    • DEMO      — dữ liệu lưu trên localStorage (dùng thử / kiểm thử ngay)
//  app.js chỉ gọi window.Backend.*, không cần biết đang ở chế độ nào.
// =====================================================================
(function () {
  "use strict";

  function configReady() {
    const c = window.APP_CONFIG || {};
    return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY &&
      !String(c.SUPABASE_URL).startsWith("DAN_") &&
      !String(c.SUPABASE_ANON_KEY).startsWith("DAN_"));
  }

  // Cho phép ép chế độ DEMO để dùng thử / kiểm thử mà không đụng dữ liệu thật:
  //   thêm ?demo=1 vào URL, hoặc đặt localStorage 'om-force-demo' = '1'.
  function forcedDemo() {
    try {
      if (new URLSearchParams(location.search).get("demo") === "1") return true;
      return localStorage.getItem("om-force-demo") === "1";
    } catch (e) { return false; }
  }

  const MODE = configReady() && window.supabase && !forcedDemo() ? "supabase" : "demo";
  const nowISO = () => new Date().toISOString();
  const uid = () => "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // ===================================================================
  //  CHẾ ĐỘ SUPABASE
  // ===================================================================
  function makeSupabaseBackend() {
    const sb = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

    return {
      mode: "supabase",
      raw: sb,

      // ---- AUTH ----
      isRecovery() { return /type=recovery/.test(location.hash); },
      async getUser() { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.user : null; },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((ev, session) => {
          if (ev === "PASSWORD_RECOVERY") return cb("PASSWORD_RECOVERY", session ? session.user : null);
          if (session && session.user) cb("SIGNED_IN", session.user);
          else cb("SIGNED_OUT", null);
        });
      },
      signIn(email, password) { return sb.auth.signInWithPassword({ email, password }); },
      signUp(name, email, password) {
        return sb.auth.signUp({ email, password, options: { data: { full_name: name || email.split("@")[0] }, emailRedirectTo: location.origin } });
      },
      resetPassword(email) { return sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); },
      updatePassword(pass) { return sb.auth.updateUser({ password: pass }); },
      signOut() { return sb.auth.signOut(); },
      clearRecoveryHash() { try { history.replaceState(null, "", location.pathname); } catch (e) {} },

      // ---- PROFILES ----
      async ensureProfile(u) {
        let { data } = await sb.from("profiles").select("id, full_name, email, role").eq("id", u.id).maybeSingle();
        if (!data) {
          const fullName = (u.user_metadata && u.user_metadata.full_name) || u.email.split("@")[0];
          const ins = await sb.from("profiles").insert({ id: u.id, full_name: fullName, email: u.email, role: "teacher" })
            .select("id, full_name, email, role").maybeSingle();
          data = ins.data;
        }
        return data || { id: u.id, full_name: u.email, email: u.email, role: "teacher" };
      },
      listProfiles() { return sb.from("profiles").select("id, full_name, email, role"); },

      // ---- TEACHERS ----
      listTeachers() { return sb.from("teachers").select("*"); },
      addTeacher(o) { return sb.from("teachers").insert(o); },
      updateTeacher(id, o) { return sb.from("teachers").update(o).eq("id", id); },
      deleteTeacher(id) { return sb.from("teachers").delete().eq("id", id); },

      // ---- STUDENTS ----
      listStudents() { return sb.from("students").select("*"); },
      addStudent(o) { return sb.from("students").insert(o); },
      updateStudent(id, o) { return sb.from("students").update(o).eq("id", id); },
      deleteStudent(id) { return sb.from("students").delete().eq("id", id); },

      // ---- SCHEDULES ----
      async listSchedules({ from, to, teacherId }) {
        let q = sb.from("schedules").select("*").gte("schedule_date", from).lte("schedule_date", to).order("start_time", { ascending: true });
        if (teacherId) q = q.eq("teacher_id", teacherId);
        return q;
      },
      addSchedule(o) { return sb.from("schedules").insert(o).select("*").single(); },
      addSchedulesBulk(rows) { return sb.from("schedules").insert(rows).select("*"); },
      addAttendanceBulk(rows) { if (!rows || !rows.length) return Promise.resolve({ data: [], error: null }); return sb.from("attendance").insert(rows); },
      updateSchedule(id, o) { return sb.from("schedules").update(o).eq("id", id); },
      deleteSchedule(id) { return sb.from("schedules").delete().eq("id", id); },

      // ---- ATTENDANCE ----
      async listAttendanceBySchedules(ids) {
        if (!ids || !ids.length) return { data: [], error: null };
        return sb.from("attendance").select("*").in("schedule_id", ids);
      },
      setAttendance(scheduleId, studentId, present, byUserId) {
        return sb.from("attendance").upsert(
          { schedule_id: scheduleId, student_id: studentId, present, marked_at: nowISO(), marked_by: byUserId },
          { onConflict: "schedule_id,student_id" }
        );
      },
      removeAttendance(scheduleId, studentId) {
        return sb.from("attendance").delete().eq("schedule_id", scheduleId).eq("student_id", studentId);
      },
      // Đếm số buổi present=true theo từng học sinh (toàn thời gian) -> {student_id: count}
      async countPresentByStudent() {
        const { data, error } = await sb.from("attendance").select("student_id, present").eq("present", true);
        if (error) return { data: {}, error };
        const m = {};
        (data || []).forEach((r) => { m[r.student_id] = (m[r.student_id] || 0) + 1; });
        return { data: m, error: null };
      },

      // ---- SETTINGS (bảng giá mặc định) ----
      async getSettings() {
        const { data, error } = await sb.from("app_settings").select("key, value");
        if (error) return { data: {}, error };
        const m = {}; (data || []).forEach((r) => (m[r.key] = r.value));
        return { data: m, error: null };
      },
      saveSetting(key, value) {
        return sb.from("app_settings").upsert({ key, value, updated_at: nowISO() }, { onConflict: "key" });
      },

      // ---- THỐNG KÊ GIÁO VIÊN (đã dạy / nghỉ) ----
      async teacherStats() {
        const { data, error } = await sb.from("schedules").select("teacher_id, teacher_present");
        if (error) return { data: {}, error };
        const m = {};
        (data || []).forEach((r) => { const x = m[r.teacher_id] || (m[r.teacher_id] = { taught: 0, off: 0 }); if (r.teacher_present === true) x.taught++; else if (r.teacher_present === false) x.off++; });
        return { data: m, error: null };
      },
    };
  }

  // ===================================================================
  //  CHẾ ĐỘ DEMO (localStorage)
  // ===================================================================
  function makeDemoBackend() {
    const DB_KEY = "om-demo-db-v1";
    const SES_KEY = "om-demo-session-v1";
    let listeners = [];

    function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
    function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

    function seed() {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const d = (n) => ymd(addDays(today, n));
      const users = [
        { id: "u-admin", email: "admin@openmusic.vn", password: "123456", full_name: "Quản trị OPENMUSIC" },
        { id: "u-lan",   email: "co.lan@openmusic.vn", password: "123456", full_name: "Cô Lan" },
        { id: "u-nam",   email: "thay.nam@openmusic.vn", password: "123456", full_name: "Thầy Nam" },
      ];
      const profiles = [
        { id: "u-admin", full_name: "Quản trị OPENMUSIC", email: "admin@openmusic.vn", role: "admin" },
        { id: "u-lan",   full_name: "Cô Lan",  email: "co.lan@openmusic.vn",  role: "teacher" },
        { id: "u-nam",   full_name: "Thầy Nam", email: "thay.nam@openmusic.vn", role: "teacher" },
      ];
      const teachers = [
        { id: "t-lan", full_name: "Cô Lan",  user_id: "u-lan", phone: "0901111111", email: "co.lan@openmusic.vn", pay_per_session: 150000, pay_rates: { ca_nhan: 150000, doi: 120000, nhom: 90000, gia_su: 200000 }, specialty: "Piano", hometown: "Hà Nội", address: "Cầu Giấy, Hà Nội", national_id: "001195000111", gender: "Nữ", dob: "1995-03-12", hire_date: d(-220), status: "active", note: "", created_at: nowISO() },
        { id: "t-nam", full_name: "Thầy Nam", user_id: "u-nam", phone: "0902222222", email: "thay.nam@openmusic.vn", pay_per_session: 130000, pay_rates: { ca_nhan: 130000, doi: 100000, nhom: 80000, gia_su: 180000 }, specialty: "Guitar", hometown: "Nghệ An", address: "Vinh, Nghệ An", national_id: "040092000222", gender: "Nam", dob: "1992-07-08", hire_date: d(-160), status: "active", note: "", created_at: nowISO() },
        { id: "t-hoa", full_name: "Cô Hoa",  user_id: null,    phone: "0903333333", email: "", pay_per_session: 140000, pay_rates: { ca_nhan: 140000, doi: 110000, nhom: 85000, gia_su: 190000 }, specialty: "Thanh nhạc", hometown: "Thừa Thiên Huế", address: "TP. Huế", national_id: "046098000333", gender: "Nữ", dob: "1998-11-20", hire_date: d(-95), status: "active", note: "Chưa có tài khoản đăng nhập", created_at: nowISO() },
      ];
      const students = [
        { id: "s1", full_name: "Nguyễn An",   phone: "0911000001", guardian: "Chị Mai",  subject: "Piano",  lesson_type: "ca_nhan", teacher_id: "t-lan", total_sessions: 12, tuition_per_session: 200000, start_date: d(-20), status: "active", note: "", created_at: nowISO() },
        { id: "s2", full_name: "Trần Bình",   phone: "0911000002", guardian: "Anh Hùng", subject: "Piano",  lesson_type: "doi",     teacher_id: "t-lan", total_sessions: 24, tuition_per_session: 160000, start_date: d(-30), status: "active", note: "", created_at: nowISO() },
        { id: "s3", full_name: "Lê Châu",     phone: "0911000003", guardian: "Chị Hoa",  subject: "Guitar", lesson_type: "ca_nhan", teacher_id: "t-nam", total_sessions: 12, tuition_per_session: 170000, start_date: d(-10), status: "active", note: "", created_at: nowISO() },
        { id: "s4", full_name: "Phạm Dương",  phone: "0911000004", guardian: "Anh Sơn",  subject: "Guitar", lesson_type: "nhom",    teacher_id: "t-nam", total_sessions: 24, tuition_per_session: 120000, start_date: d(-40), status: "active", note: "", created_at: nowISO() },
        { id: "s5", full_name: "Vũ Em",       phone: "0911000005", guardian: "Chị Lan",  subject: "Thanh nhạc", lesson_type: "gia_su", teacher_id: "t-hoa", total_sessions: 12, tuition_per_session: 250000, start_date: d(-5),  status: "active", note: "", created_at: nowISO() },
      ];
      // Lịch tuần: hôm nay + vài ngày, gắn HS qua attendance
      const schedules = [
        { id: "sc1", teacher_id: "t-lan", schedule_date: d(0),  subject: "Piano", lesson_type: "ca_nhan", class_name: "P1", start_time: "08:00", end_time: "09:30", room: "P.201", teacher_name: "Cô Lan",  teacher_present: null, teacher_marked_at: null, note: "", created_at: nowISO(), updated_at: nowISO() },
        { id: "sc2", teacher_id: "t-nam", schedule_date: d(0),  subject: "Guitar", lesson_type: "nhom", class_name: "G1", start_time: "18:30", end_time: "20:00", room: "P.105", teacher_name: "Thầy Nam", teacher_present: null, teacher_marked_at: null, note: "", created_at: nowISO(), updated_at: nowISO() },
        { id: "sc3", teacher_id: "t-lan", schedule_date: d(-2), subject: "Piano", lesson_type: "ca_nhan", class_name: "P1", start_time: "08:00", end_time: "09:30", room: "P.201", teacher_name: "Cô Lan",  teacher_present: true, teacher_marked_at: nowISO(), note: "", created_at: nowISO(), updated_at: nowISO() },
        { id: "sc4", teacher_id: "t-nam", schedule_date: d(-1), subject: "Guitar", lesson_type: "gia_su", class_name: "G1", start_time: "18:30", end_time: "20:00", room: "P.105", teacher_name: "Thầy Nam", teacher_present: true, teacher_marked_at: nowISO(), note: "", created_at: nowISO(), updated_at: nowISO() },
        { id: "sc5", teacher_id: "t-hoa", schedule_date: d(1),  subject: "Thanh nhạc", lesson_type: "gia_su", class_name: "V1", start_time: "14:00", end_time: "15:30", room: "P.302", teacher_name: "Cô Hoa",  teacher_present: null, teacher_marked_at: null, note: "", created_at: nowISO(), updated_at: nowISO() },
        { id: "sc6", teacher_id: "t-lan", schedule_date: d(2),  subject: "Piano", lesson_type: "doi", class_name: "P1", start_time: "08:00", end_time: "09:30", room: "P.201", teacher_name: "Cô Lan",  teacher_present: null, teacher_marked_at: null, note: "", created_at: nowISO(), updated_at: nowISO() },
      ];
      const attendance = [
        // buổi đã qua: đã điểm danh
        { id: uid(), schedule_id: "sc3", student_id: "s1", present: true,  marked_at: nowISO(), marked_by: "u-lan" },
        { id: uid(), schedule_id: "sc3", student_id: "s2", present: true,  marked_at: nowISO(), marked_by: "u-lan" },
        { id: uid(), schedule_id: "sc4", student_id: "s3", present: true,  marked_at: nowISO(), marked_by: "u-nam" },
        { id: uid(), schedule_id: "sc4", student_id: "s4", present: false, marked_at: nowISO(), marked_by: "u-nam" },
        // buổi hôm nay: HS đã gắn vào lớp, chưa điểm danh (present=null)
        { id: uid(), schedule_id: "sc1", student_id: "s1", present: null, marked_at: null, marked_by: null },
        { id: uid(), schedule_id: "sc1", student_id: "s2", present: null, marked_at: null, marked_by: null },
        { id: uid(), schedule_id: "sc2", student_id: "s3", present: null, marked_at: null, marked_by: null },
        { id: uid(), schedule_id: "sc2", student_id: "s4", present: null, marked_at: null, marked_by: null },
        { id: uid(), schedule_id: "sc5", student_id: "s5", present: null, marked_at: null, marked_by: null },
        { id: uid(), schedule_id: "sc6", student_id: "s1", present: null, marked_at: null, marked_by: null },
        { id: uid(), schedule_id: "sc6", student_id: "s2", present: null, marked_at: null, marked_by: null },
      ];
      const settings = {
        default_pay: { ca_nhan: 150000, doi: 120000, nhom: 90000, gia_su: 200000 },
        default_tuition: { ca_nhan: 200000, doi: 160000, nhom: 120000, gia_su: 250000 },
      };
      return { users, profiles, teachers, students, schedules, attendance, settings };
    }

    function load() {
      try {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      const fresh = seed();
      save(fresh);
      return fresh;
    }
    function save(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {} }
    let store = load();

    function getSession() { try { return JSON.parse(localStorage.getItem(SES_KEY) || "null"); } catch (e) { return null; } }
    function setSession(u) {
      if (u) localStorage.setItem(SES_KEY, JSON.stringify(u));
      else localStorage.removeItem(SES_KEY);
    }
    function emit(ev, user) { listeners.forEach((cb) => cb(ev, user)); }
    const ok = (data) => ({ data, error: null });

    return {
      mode: "demo",
      raw: null,
      _store: store,
      resetDemo() { store = seed(); save(store); },

      // ---- AUTH ----
      isRecovery() { return false; },
      async getUser() {
        const s = getSession();
        if (!s) return null;
        const u = store.users.find((x) => x.id === s.id);
        return u ? { id: u.id, email: u.email, user_metadata: { full_name: u.full_name } } : null;
      },
      onAuthChange(cb) { listeners.push(cb); },
      async signIn(email, password) {
        const u = store.users.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
        if (!u) return { error: { message: "Email chưa đăng ký (demo)." } };
        if (password && u.password && password !== u.password) return { error: { message: "Invalid login credentials" } };
        const user = { id: u.id, email: u.email, user_metadata: { full_name: u.full_name } };
        setSession({ id: u.id });
        emit("SIGNED_IN", user);
        return { data: { user }, error: null };
      },
      async signUp(name, email, password) {
        email = String(email).trim().toLowerCase();
        if (store.users.some((x) => x.email.toLowerCase() === email)) return { error: { message: "already registered" } };
        const id = uid();
        store.users.push({ id, email, password, full_name: name || email.split("@")[0] });
        store.profiles.push({ id, full_name: name || email.split("@")[0], email, role: "teacher" });
        save(store);
        const user = { id, email, user_metadata: { full_name: name } };
        setSession({ id });
        emit("SIGNED_IN", user);
        return { data: { user, session: {} }, error: null };
      },
      async resetPassword() { return { error: null }; },     // demo: chỉ báo thành công
      async updatePassword(pass) {
        const s = getSession(); if (!s) return { error: { message: "Chưa đăng nhập." } };
        const u = store.users.find((x) => x.id === s.id); if (u) { u.password = pass; save(store); }
        return { error: null };
      },
      async signOut() { setSession(null); emit("SIGNED_OUT", null); return { error: null }; },
      clearRecoveryHash() {},

      // ---- PROFILES ----
      async ensureProfile(u) {
        let p = store.profiles.find((x) => x.id === u.id);
        if (!p) { p = { id: u.id, full_name: (u.user_metadata && u.user_metadata.full_name) || u.email, email: u.email, role: "teacher" }; store.profiles.push(p); save(store); }
        return p;
      },
      async listProfiles() { return ok(store.profiles.slice()); },

      // ---- TEACHERS ----
      async listTeachers() { return ok(store.teachers.slice()); },
      async addTeacher(o) { const row = Object.assign({ id: uid(), user_id: null, phone: null, pay_per_session: 0, note: null, created_at: nowISO() }, o); store.teachers.push(row); save(store); return ok(row); },
      async updateTeacher(id, o) { const t = store.teachers.find((x) => x.id === id); if (t) Object.assign(t, o); save(store); return ok(t); },
      async deleteTeacher(id) {
        store.teachers = store.teachers.filter((x) => x.id !== id);
        const schIds = store.schedules.filter((s) => s.teacher_id === id).map((s) => s.id);
        store.schedules = store.schedules.filter((s) => s.teacher_id !== id);
        store.attendance = store.attendance.filter((a) => !schIds.includes(a.schedule_id));
        save(store); return ok(true);
      },

      // ---- STUDENTS ----
      async listStudents() { return ok(store.students.slice()); },
      async addStudent(o) { const row = Object.assign({ id: uid(), status: "active", total_sessions: 12, tuition_per_session: 0, created_at: nowISO() }, o); store.students.push(row); save(store); return ok(row); },
      async updateStudent(id, o) { const s = store.students.find((x) => x.id === id); if (s) Object.assign(s, o); save(store); return ok(s); },
      async deleteStudent(id) {
        store.students = store.students.filter((x) => x.id !== id);
        store.attendance = store.attendance.filter((a) => a.student_id !== id);
        save(store); return ok(true);
      },

      // ---- SCHEDULES ----
      async listSchedules({ from, to, teacherId }) {
        let list = store.schedules.filter((s) => s.schedule_date >= from && s.schedule_date <= to);
        if (teacherId) list = list.filter((s) => s.teacher_id === teacherId);
        list.sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
        return ok(list.map((s) => Object.assign({}, s)));
      },
      async addSchedule(o) { const row = Object.assign({ id: uid(), teacher_present: null, teacher_marked_at: null, created_at: nowISO(), updated_at: nowISO() }, o); store.schedules.push(row); save(store); return ok(row); },
      async addSchedulesBulk(rows) { const out = (rows || []).map((o) => Object.assign({ id: uid(), teacher_present: null, teacher_marked_at: null, created_at: nowISO(), updated_at: nowISO() }, o)); out.forEach((r) => store.schedules.push(r)); save(store); return ok(out); },
      async addAttendanceBulk(rows) { (rows || []).forEach((o) => store.attendance.push(Object.assign({ id: uid(), present: null, marked_at: null, marked_by: null }, o))); save(store); return ok(true); },
      async updateSchedule(id, o) { const s = store.schedules.find((x) => x.id === id); if (s) { Object.assign(s, o); s.updated_at = nowISO(); } save(store); return ok(s); },
      async deleteSchedule(id) {
        store.schedules = store.schedules.filter((x) => x.id !== id);
        store.attendance = store.attendance.filter((a) => a.schedule_id !== id);
        save(store); return ok(true);
      },

      // ---- ATTENDANCE ----
      async listAttendanceBySchedules(ids) {
        ids = ids || [];
        return ok(store.attendance.filter((a) => ids.includes(a.schedule_id)).map((a) => Object.assign({}, a)));
      },
      async setAttendance(scheduleId, studentId, present, byUserId) {
        let a = store.attendance.find((x) => x.schedule_id === scheduleId && x.student_id === studentId);
        if (a) { a.present = present; a.marked_at = nowISO(); a.marked_by = byUserId; }
        else { a = { id: uid(), schedule_id: scheduleId, student_id: studentId, present, marked_at: nowISO(), marked_by: byUserId }; store.attendance.push(a); }
        save(store); return ok(a);
      },
      async removeAttendance(scheduleId, studentId) {
        store.attendance = store.attendance.filter((x) => !(x.schedule_id === scheduleId && x.student_id === studentId));
        save(store); return ok(true);
      },
      async countPresentByStudent() {
        const m = {};
        store.attendance.forEach((a) => { if (a.present === true) m[a.student_id] = (m[a.student_id] || 0) + 1; });
        return ok(m);
      },

      // ---- SETTINGS (bảng giá mặc định) ----
      async getSettings() { return ok(Object.assign({}, store.settings || {})); },
      async saveSetting(key, value) { store.settings = store.settings || {}; store.settings[key] = value; save(store); return ok(true); },
      async teacherStats() {
        const m = {};
        store.schedules.forEach((r) => { const x = m[r.teacher_id] || (m[r.teacher_id] = { taught: 0, off: 0 }); if (r.teacher_present === true) x.taught++; else if (r.teacher_present === false) x.off++; });
        return ok(m);
      },
    };
  }

  window.Backend = MODE === "supabase" ? makeSupabaseBackend() : makeDemoBackend();
  window.BACKEND_MODE = MODE;
})();
