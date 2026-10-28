// =====================================================================
//  app.js — OPENMUSIC (Thời khóa biểu • Điểm danh • Lương • Học phí)
//  Dùng window.Backend (backend.js) cho cả Supabase lẫn chế độ Demo.
// =====================================================================
(function () {
  "use strict";

  const B = window.Backend;

  // ===== CHẾ ĐỘ MIGRATION (nhập dữ liệu cũ) =====
  //  true  = cho phép điểm danh / sửa buổi trong QUÁ KHỨ cho mọi người (để nhập liệu cũ).
  //  false = chỉ thao tác từ HÔM NAY trở đi; riêng ADMIN vẫn luôn được sửa quá khứ.
  //  Nhập xong dữ liệu cũ -> đổi thành false rồi push lại để khóa quá khứ với giáo viên.
  const MIGRATION_MODE = true;

  // ---------- STATE ----------
  let user = null;
  let currentUid = null;
  let todayRequest = 0, weekRequest = 0, profitRequest = 0, salaryRequest = 0;
  let myProfile = null;
  let profilesList = [], profilesById = {};
  let teachers = [], teachersById = {}, myTeacher = null;
  let students = [], studentsById = {};
  let presentByStudent = {};        // student_id -> số buổi đã có mặt (toàn thời gian)
  let teacherStatsById = {};        // teacher_id -> { taught, off }
  let allPayments = [];             // danh sách đóng học phí (admin)
  let paidByStudent = {};           // student_id -> { amount, sessions }
  let coursesByStudent = {};        // student_id -> [khóa trong DB, theo seq]
  let attRowsByStudent = {};        // student_id -> [điểm danh kèm ngày] (admin) — để chia buổi vào khóa
  let courseInfo = {};              // student_id -> kết quả courseBreakdown()
  let viewDate = startOfToday();
  let attDate = startOfToday();   // ngày đang điểm danh (mặc định hôm nay)
  let currentView = "today";
  let recovering = false, resetDone = false;
  let modalApplyWeeks = [], modalApplyCopy = true, weekPickerCb = null;

  // hôm nay + nhắc lịch
  let remindCache = { date: null, scheds: [] };
  let remindedIds = new Set();
  let reminderTimer = null;

  // ---------- HẰNG SỐ ----------
  const BUOI = [
    { key: "sang",  label: "Sáng",  icon: "☀️" },
    { key: "chieu", label: "Chiều", icon: "🌤️" },
    { key: "toi",   label: "Tối",   icon: "🌙" },
  ];
  const DOW = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  const DOW_SHORT = { 0: "CN", 1: "Th 2", 2: "Th 3", 3: "Th 4", 4: "Th 5", 5: "Th 6", 6: "Th 7" };
  const DOW_TINY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  // tiêu đề lớn (hero) — ngắn gọn kiểu iOS
  const HERO_TITLE = { today: "Hôm nay", schedule: "Lịch học", students: "Học sinh", teachers: "Giáo viên", salary: "Tính lương", tuition: "Học phí", profit: "Lãi / Lỗ", notify: "Thông báo", settings: "Cài đặt" };
  const PAGE_TITLE = { today: "Hôm nay & Điểm danh", schedule: "Thời khóa biểu", students: "Học sinh", teachers: "Giáo viên", salary: "Tính lương", tuition: "Học phí học sinh", profit: "Lãi/Lỗ trung tâm", notify: "Thông báo", settings: "Cài đặt" };

  // Môn học & loại lớp (cá nhân / đôi / nhóm)
  const SUBJECTS = ["Piano", "Guitar", "Thanh nhạc", "Múa", "Vẽ", "Cờ vua"];
  const LESSON_TYPES = [{ key: "ca_nhan", label: "Cá nhân" }, { key: "doi", label: "Đôi" }, { key: "nhom", label: "Nhóm" }, { key: "gia_su", label: "Gia sư" }];
  function lessonTypeLabel(k) { const t = LESSON_TYPES.find((x) => x.key === k); return t ? t.label : "Cá nhân"; }
  function fillLessonTypeSelect(sel, val) { sel.innerHTML = LESSON_TYPES.map((t) => `<option value="${t.key}">${t.label}</option>`).join(""); sel.value = val || "ca_nhan"; }
  function fillSubjectSelect(sel, value) {
    let opts = '<option value="">— Chọn môn —</option>' + SUBJECTS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    if (value && SUBJECTS.indexOf(value) < 0) opts += `<option value="${esc(value)}">${esc(value)}</option>`;
    sel.innerHTML = opts;
    sel.value = value || "";
  }
  // Tên hiển thị trên TKB: Môn + Loại lớp + Học sinh (vd "Piano Nhóm Kiên + Vinh")
  function classTitle(s, names) {
    const parts = [s.subject, lessonTypeLabel(s.lesson_type)];
    if (names && names.length) parts.push(names.join(" + "));
    return parts.filter(Boolean).join(" ");
  }
  let settings = {};

  // ===== KHÓA HỌC =====
  //  Mỗi HS học nhiều khóa (12 / 24 buổi / tùy chỉnh). Buổi được xếp vào khóa theo thứ tự thời gian:
  //  khóa đủ số buổi -> sang khóa sau (đánh số lại từ 1); chưa có khóa sau -> "buổi lẻ".
  //  Buổi nào được TRỪ vào khóa do cô chọn (mặc định ở Cài đặt, chỉnh riêng từng khóa):
  const COUNT_RULES = [
    { key: "present",           label: "Chỉ buổi có mặt" },
    { key: "present_unexcused", label: "Có mặt + vắng không phép" },
    { key: "all",               label: "Mọi buổi đã điểm danh (kể cả vắng)" },
  ];
  function defaultCountRule() { const r = settings.course_count_rule; return COUNT_RULES.some((x) => x.key === r) ? r : "present"; }
  function countRuleLabel(k) { const r = COUNT_RULES.find((x) => x.key === k); return r ? r.label : ""; }
  function ruleOf(c) { return (c && c.count_rule) || defaultCountRule(); }
  function sessionCounts(a, rule) {
    if (a.present === true) return true;
    if (a.present !== false) return false;               // chưa điểm danh
    return rule === "all" || (rule === "present_unexcused" && !a.excused);
  }
  // Danh sách khóa của HS. Chưa có dòng nào trong bảng courses -> 1 khóa "ảo" lấy từ hồ sơ HS (dữ liệu cũ).
  function coursesFor(st) {
    const list = coursesByStudent[st.id];
    if (list && list.length) return list;
    return [{ id: null, seq: 1, total_sessions: st.total_sessions || 0, tuition_per_session: st.tuition_per_session || 0, lesson_type: st.lesson_type, start_date: st.start_date, count_rule: null }];
  }
  // rows: [{ schedule_date, start_time, present, excused, ... }] của 1 HS
  //  -> { courses: [{ c, items: [{ a, no }], used }], extra: [{ a, no }], extraUsed, cur }
  //  no = số thứ tự buổi trong khóa (null = buổi không bị trừ, vd vắng có phép / chưa điểm danh)
  function courseBreakdown(st, rows) {
    const list = coursesFor(st);
    const out = { courses: list.map((c) => ({ c, items: [], used: 0 })), extra: [], extraUsed: 0, cur: 0 };
    const sorted = rows.slice().sort((x, y) => (x.schedule_date + (x.start_time || "")).localeCompare(y.schedule_date + (y.start_time || "")));
    let i = 0;
    sorted.forEach((a) => {
      // sang khóa sau khi khóa hiện tại đã đủ buổi, hoặc buổi đã tới ngày bắt đầu của khóa sau
      while (i + 1 < out.courses.length) {
        const cur = out.courses[i], next = out.courses[i + 1].c;
        const full = cur.c.total_sessions > 0 && cur.used >= cur.c.total_sessions;
        if (full || (next.start_date && a.schedule_date >= next.start_date)) i++; else break;
      }
      const cur = out.courses[i];
      const full = cur.c.total_sessions > 0 && cur.used >= cur.c.total_sessions;
      const counts = sessionCounts(a, ruleOf(cur.c));
      if (full) { out.extra.push({ a, no: counts ? ++out.extraUsed : null }); return; }
      cur.items.push({ a, no: counts ? ++cur.used : null });
    });
    out.cur = i;
    return out;
  }
  function rebuildCourseInfo(studentId) {
    const st = studentsById[studentId]; if (!st) return;
    courseInfo[studentId] = courseBreakdown(st, attRowsByStudent[studentId] || []);
  }
  // Quy tắc tính buổi của khóa đang học (dùng khi điểm danh, kể cả tài khoản giáo viên)
  function studentRule(studentId) {
    const st = studentsById[studentId]; if (!st) return defaultCountRule();
    const bd = courseInfo[studentId];
    const list = coursesFor(st);
    return ruleOf(bd ? bd.courses[bd.cur].c : list[list.length - 1]);
  }
  // Cập nhật bộ nhớ đệm điểm danh sau khi điểm danh ở trang Hôm nay (để số buổi/khóa luôn đúng)
  function patchAttCache(scheduleId, studentId, patch) {
    const list = attRowsByStudent[studentId] || (attRowsByStudent[studentId] = []);
    let r = list.find((x) => x.schedule_id === scheduleId);
    if (!r) {
      const s = todayScheds.find((x) => x.id === scheduleId); if (!s) return;
      r = { schedule_id: scheduleId, student_id: studentId, present: null, excused: false, schedule_date: s.schedule_date, start_time: s.start_time };
      list.push(r);
    }
    if (patch === null) list.splice(list.indexOf(r), 1); else Object.assign(r, patch);
    rebuildCourseInfo(studentId);
  }
  // không dấu, chữ thường — để tìm "nguyen an" ra "Nguyễn An"
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().trim(); }

  function defaultPay(type) { const m = settings.default_pay || {}; return Number(m[type]) || 0; }
  function defaultTuition(type) { const m = settings.default_tuition || {}; return Number(m[type]) || 0; }
  function teacherPayFor(teacher, type) {
    if (!teacher) return 0;
    const r = teacher.pay_rates || {};
    if (r[type] != null && r[type] !== "") return Number(r[type]) || 0;
    return Number(teacher.pay_per_session) || 0;
  }
  // Loại lớp HIỆU DỤNG theo sĩ số thực học: HS nghỉ -> lớp hạ bậc -> lương theo bậc thấp hơn.
  // 1 HS học -> Cá nhân, 2 -> Đôi, >=3 -> Nhóm. Chỉ HẠ bậc (không nâng); Gia sư giữ nguyên.
  // Chỉ hạ bậc khi CÓ HS nghỉ (present=false). HS chưa điểm danh vẫn coi là có học -> không trừ oan.
  const LT_TIER = { ca_nhan: 1, doi: 2, nhom: 3 };
  const TIER_LT = { 1: "ca_nhan", 2: "doi", 3: "nhom" };
  function headTier(n) { return n >= 3 ? 3 : (n <= 1 ? 1 : 2); }
  function effectiveLessonType(lessonType, attending, absent) {
    const lt = lessonType || "ca_nhan";
    if (!(lt in LT_TIER) || !absent) return lt;             // Gia sư hoặc không ai nghỉ -> giữ nguyên
    return TIER_LT[Math.min(LT_TIER[lt], headTier(attending))];
  }
  // Lương 1 buổi = giá của loại lớp HIỆU DỤNG (đã hạ bậc theo sĩ số thực học)
  function teacherPayForSession(teacher, lessonType, attending, absent) {
    return teacherPayFor(teacher, effectiveLessonType(lessonType, attending, absent));
  }
  // Gom điểm danh 1 buổi -> {enrolled, present, absent, attending}
  function attendanceAgg(rows) {
    rows = rows || [];
    let present = 0, absent = 0;
    rows.forEach((a) => { if (a.present === true) present++; else if (a.present === false) absent++; });
    return { enrolled: rows.length, present, absent, attending: rows.length - absent };
  }
  // Sinh ô nhập lương theo loại lớp (động theo LESSON_TYPES)
  function renderPayRateInputs(container, rates) {
    rates = rates || {};
    container.innerHTML = LESSON_TYPES.map((t) =>
      `<div class="pr-item"><span>${t.label}</span><input type="number" min="0" step="1000" data-ptype="${t.key}" value="${Number(rates[t.key]) || 0}" /></div>`
    ).join("");
  }
  function readRateInputs(container, attr) {
    const r = {};
    container.querySelectorAll("input[" + attr + "]").forEach((inp) => { r[inp.getAttribute(attr)] = parseInt(inp.value, 10) || 0; });
    return r;
  }

  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>';
  const NOTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>';
  const NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M9 18V5l12-2v13"/><path d="M9 9l12-2"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

  // ---------- TIỆN ÍCH ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const off = (x.getDay() + 6) % 7; x.setDate(x.getDate() - off); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function dmy(d) { return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; }
  function hhmm(t) { return t ? String(t).slice(0, 5) : ""; }
  function ymdToDmy(s) { if (!s) return ""; const p = String(s).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ""; }
  function dmyToYmd(s) {
    const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function normTime(s) {
    const m = String(s || "").trim().match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  function buoiOf(t) { const h = parseInt(String(t).slice(0, 2), 10); return h < 12 ? "sang" : h < 18 ? "chieu" : "toi"; }
  function initials(name) { const p = String(name || "?").trim().split(/\s+/); return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase(); }
  function money(n) { return (Number(n) || 0).toLocaleString("vi-VN") + " đ"; }
  function moneyShort(n) { n = Number(n) || 0; if (n >= 1000000) return (n / 1000000).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + "tr"; if (n >= 1000) return Math.round(n / 1000) + "k"; return String(n); }
  function teacherStatusLabel(s) { return s === "inactive" ? "Nghỉ việc" : "Đang làm"; }
  function isAdmin() { return myProfile && myProfile.role === "admin"; }

  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.textContent = msg;
    $("toastWrap").appendChild(el);
    setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 2600);
  }

  // ---------- THEME ----------
  function applyTheme(t) {
    t = t === 'dark' ? 'dark' : 'light';
    document.documentElement.style.colorScheme = t;
    document.documentElement.style.backgroundColor = t === 'dark' ? '#0b1a18' : '#e7efeb';
    document.documentElement.setAttribute("data-theme", t);
    $("themeBtn").innerHTML = t === "dark" ? MOON : SUN;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0b1a18" : "#e7efeb");
    try { localStorage.setItem("om-theme", t); } catch (e) {}
  }
  function initTheme() {
    let t = "light";
    try { t = localStorage.getItem("om-theme") || "light"; } catch (e) {}
    applyTheme(t);
  }

  // ---------- CÀI ĐẶT NHẮC LỊCH ----------
  function getLeadMin() { let v = 120; try { v = parseInt(localStorage.getItem("om-lead-min"), 10); } catch (e) {} return isNaN(v) ? 120 : v; }
  function setLeadMin(v) { try { localStorage.setItem("om-lead-min", String(v)); } catch (e) {} }

  // =====================================================================
  //  KHỞI TẠO
  // =====================================================================
  async function init() {
    initTheme();
    $("logoBox").innerHTML = '<img src="logo-icon.png" alt="OPENMUSIC" />';
    $("authLogoBox").innerHTML = '<img src="logo-icon.png" alt="OPENMUSIC" />';
    $("themeBtn").innerHTML = document.documentElement.getAttribute("data-theme") === "dark" ? MOON : SUN;
    setupModeUI();
    initSidebarCollapse();
    wireEvents();

    if (B.mode === 'unavailable') {
      showAuth(); setAuthMode('login');
      authErr('Không tải được kết nối dữ liệu. Hãy tải lại trang.');
      $('authPrimary').disabled = true;
      return;
    }
    recovering = B.isRecovery();
    if (recovering) { showAuth(); setAuthMode("reset"); }

    B.onAuthChange((ev, u) => {
      if (ev === "PASSWORD_RECOVERY") { recovering = true; showAuth(); setAuthMode("reset"); return; }
      if (recovering) return;
      if (u) { user = u; afterLogin(); }
      else onSignedOut();
    });

    user = await B.getUser();
    if (user && !recovering) afterLogin();
    else if (!recovering) { showAuth(); setAuthMode("login"); }
  }

  function setupModeUI() {
    $("authDemoHint").hidden = true;
    $("authDemoHint").textContent = "";
  }

  // ---------- THU GỌN SIDEBAR ----------
  function initSidebarCollapse() {
    let collapsed = false;
    try { collapsed = localStorage.getItem("om-sidebar-collapsed") === "1"; } catch (e) {}
    $("sidebar").classList.toggle("collapsed", collapsed);
  }
  function toggleSidebarCollapse() {
    const sb = $("sidebar");
    const collapsed = !sb.classList.contains("collapsed");
    sb.classList.toggle("collapsed", collapsed);
    try { localStorage.setItem("om-sidebar-collapsed", collapsed ? "1" : "0"); } catch (e) {}
    $("sidebarToggle").title = collapsed ? "Mở rộng menu" : "Thu gọn menu";
  }

  // =====================================================================
  //  AUTH
  // =====================================================================
  let authMode = "login";
  const AUTH_LABEL = { login: "Đăng nhập", signup: "Đăng ký", forgot: "Gửi liên kết đặt lại", reset: "Đổi mật khẩu" };

  function showAuth() { $("authOverlay").hidden = false; }
  function hideAuth() { $("authOverlay").hidden = true; }
  function authErr(msg, ok) { const e = $("authErr"); e.textContent = msg || ""; e.style.color = ok ? "var(--good)" : "var(--bad)"; }
  function authBusy(on, txt) { const b = $("authPrimary"); b.disabled = on; b.textContent = on ? txt : AUTH_LABEL[authMode]; }

  function setAuthMode(m) {
    authMode = m; authErr("");
    const meta = {
      login:  ["Đăng nhập", "Đăng nhập để quản lý Trung tâm OPENMUSIC"],
      signup: ["Tạo tài khoản", "Tạo tài khoản giáo viên mới bằng email"],
      forgot: ["Quên mật khẩu", "Nhập email — chúng tôi sẽ gửi liên kết đặt lại mật khẩu"],
      reset:  ["Đặt mật khẩu mới", "Nhập mật khẩu mới cho tài khoản của bạn"],
    }[m] || ["Đăng nhập", ""];
    $("authTitle").textContent = meta[0];
    $("authSub").textContent = meta[1];
    $("authPrimary").textContent = AUTH_LABEL[m];
    $("fName").hidden  = (m !== "signup");
    $("fEmail").hidden = (m === "reset");
    $("fPass").hidden  = (m !== "login" && m !== "signup");
    $("fNew").hidden   = (m !== "reset");
    $("fNew2").hidden  = (m !== "reset");
    $("lnkForgot").hidden = (m !== "login");
    $("lnkSignup").hidden = (m !== "login");
    $("lnkBack").hidden   = (m === "login" || m === "reset");
  }

  function friendlyAuthErr(msg) {
    if (/invalid|credentials/i.test(msg)) return "Sai email hoặc mật khẩu.";
    if (/already registered/i.test(msg)) return "Email này đã được đăng ký.";
    if (/not confirmed/i.test(msg)) return "Email chưa xác nhận. Kiểm tra hộp thư.";
    if (/should be at least/i.test(msg)) return "Mật khẩu cần tối thiểu 6 ký tự.";
    return msg;
  }

  async function doLogin() {
    const email = $("authEmail").value.trim(), password = $("authPass").value;
    if (!email || !password) return authErr("Nhập email và mật khẩu.");
    authBusy(true, "Đang đăng nhập...");
    const { data, error } = await B.signIn(email, password);
    authBusy(false);
    if (error) authErr(friendlyAuthErr(error.message));
    else if (data && data.user) { user = data.user; afterLogin(); }
  }
  async function doSignup() {
    const name = $("authName").value.trim(), email = $("authEmail").value.trim(), password = $("authPass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { authErr("Email chưa đúng định dạng."); $("authEmail").focus(); return; }
    if (password.length < 6) { authErr("Mật khẩu cần tối thiểu 6 ký tự."); $("authPass").focus(); return; }
    authBusy(true, "Đang tạo...");
    const { data, error } = await B.signUp(name, email, password);
    authBusy(false);
    if (error) return authErr(friendlyAuthErr(error.message));
    if (data && data.session) { user = data.user; afterLogin(); }
    else authErr("✅ Đã tạo tài khoản! Kiểm tra email để xác nhận rồi đăng nhập.", true);
  }
  async function doForgot() {
    const email = $("authEmail").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { authErr("Nhập email hợp lệ để nhận liên kết."); $("authEmail").focus(); return; }
    authBusy(true, "Đang gửi...");
    const { error } = await B.resetPassword(email);
    authBusy(false);
    if (error) authErr(error.message);
    else authErr("✅ Đã gửi email! Mở email và bấm liên kết để đặt mật khẩu mới (xem cả Spam/Quảng cáo).", true);
  }
  async function doReset() {
    const p1 = $("authNew").value, p2 = $("authNew2").value;
    if (p1.length < 6) { authErr("Mật khẩu mới cần tối thiểu 6 ký tự."); $("authNew").focus(); return; }
    if (p1 !== p2) { authErr("Hai mật khẩu không khớp."); $("authNew2").focus(); return; }
    authBusy(true, "Đang đổi...");
    const { error } = await B.updatePassword(p1);
    authBusy(false);
    if (error) return authErr(/different|same/i.test(error.message) ? "Mật khẩu mới phải khác mật khẩu cũ." : error.message);
    recovering = false; resetDone = true;
    B.clearRecoveryHash();
    await B.signOut();
  }

  async function afterLogin() {
    if (currentUid === user.id) return;
    currentUid = user.id;
    const loginId = currentUid;
    try {
    const profile = await traceDataLoad('Hồ sơ đăng nhập', () => B.ensureProfile(user));
    if (currentUid !== loginId) return;
    myProfile = profile;
    hideAuth();
    $("app").classList.remove("hidden");
    applyRoleUI();
    $("todayList").innerHTML = '<div class="state" role="status">Đang tải lịch học…</div>';

    const name = (myProfile && myProfile.full_name) || user.email;
    $("accName").textContent = name;
    $("accAvatar").textContent = initials(name);
    $("accRole").innerHTML = isAdmin() ? 'Quản trị viên <span class="badge-admin">ADMIN</span>' : "Giáo viên";

    await loadGlobals();
    if (currentUid !== loginId) return;
    applyRoleUI();
    initSettingsUI();
    switchView("today");
    startReminderLoop();
    refreshDevicePush();
    } catch (error) {
      if (currentUid !== loginId) return;
      currentUid = null;
      $("app").classList.add("hidden");
      showAuth(); setAuthMode('login');
      authErr('Không thể tải dữ liệu: ' + (error.message || error));
    }
  }

  function onSignedOut() {
    devicePushEnabled = false;
    user = null; currentUid = null; myProfile = null;
    profilesList = []; profilesById = {}; teachers = []; teachersById = {}; myTeacher = null;
    students = []; studentsById = {}; presentByStudent = {};
    todayRequest++; weekRequest++; profitRequest++; salaryRequest++;
    allPayments = []; paidByStudent = {}; coursesByStudent = {}; attRowsByStudent = {}; courseInfo = {}; settings = {}; teacherStatsById = {};
    todayScheds = []; todayAtt = []; allForWeek = []; attByWeek = {}; weekStudNames = {}; weekAbsentNames = {};
    remindCache = { date: null, scheds: [] };
    remindedIds = new Set();
    closeSidebar(); closeAccountMenu();
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
    $("app").classList.add("hidden");
    closeAllModals();
    showAuth(); setAuthMode("login");
    $("authPass").value = "";
    if (resetDone) { resetDone = false; authErr("✅ Đổi mật khẩu thành công! Hãy đăng nhập lại bằng mật khẩu mới.", true); }
  }

  function applyRoleUI() {
    const admin = isAdmin();
    document.querySelectorAll(".admin-only").forEach((el) => { el.hidden = !admin; });
    document.querySelectorAll(".nonadmin-only").forEach((el) => { el.hidden = admin; });
    $("accCaret").hidden = true;
    $("accountBtn").classList.add("clickable");
    $("accountBtn").setAttribute("aria-label", "Tài khoản và đăng xuất");
    $("accountBtn").setAttribute("aria-expanded", "false");
  }

  // ---------- MENU TÀI KHOẢN: admin xem lịch dạy của giáo viên khác ----------
  function renderAccountMenu() {
    const cur = $("teacherFilter").value || "all";
    let h = '<div class="am-head">Tài khoản</div>';
    if (isAdmin()) {
    h += '<div class="am-head">Xem lịch dạy của giáo viên</div>';
    h += amItem("all", "Tất cả giáo viên", "Xem toàn bộ lịch", cur === "all");
    teachers.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi")).forEach((t) => {
      const acc = t.user_id && profilesById[t.user_id] ? (profilesById[t.user_id].email || profilesById[t.user_id].full_name) : "chưa gắn tài khoản";
      h += amItem(t.id, t.full_name, acc, cur === t.id);
    });
    }
    h += '<button type="button" class="account-logout" id="logoutBtn">Đăng xuất <span aria-hidden="true">↗</span></button>';
    $("accountMenu").innerHTML = h;
  }
  function amItem(id, name, sub, active) {
    return `<button class="am-item ${active ? "active" : ""}" data-amteacher="${id}"><div class="am-av">${esc(initials(name))}</div>` +
      `<div class="am-info"><div class="am-nm">${esc(name)}</div><div class="am-sub">${esc(sub)}</div></div></button>`;
  }
  function toggleAccountMenu() {
    const m = $("accountMenu");
    if (m.classList.contains("hidden")) { renderAccountMenu(); m.classList.remove("hidden"); }
    else m.classList.add("hidden");
    $("accountBtn").setAttribute("aria-expanded", String(!m.classList.contains("hidden")));
  }
  function closeAccountMenu() { $("accountMenu").classList.add("hidden"); $("accountBtn").setAttribute("aria-expanded", "false"); }
  function viewTeacherSchedule(id) {
    fillTeacherFilter();
    $("teacherFilter").value = id;
    closeAccountMenu();
    switchView("schedule");
    const nm = id === "all" ? "tất cả giáo viên" : (teachersById[id] && teachersById[id].full_name) || "";
    toast("Đang xem lịch của " + nm, "ok");
  }

  // =====================================================================
  //  TẢI DỮ LIỆU DÙNG CHUNG
  // =====================================================================
  async function traceDataLoad(label, read, timeoutMs = 15000) {
    const started = performance.now();
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label + ': máy chủ không phản hồi sau ' + Math.round(timeoutMs / 1000) + ' giây. Hãy thử lại.')), timeoutMs);
    });
    console.info('[OPENMUSIC load] start:', label);
    try {
      const result = await Promise.race([Promise.resolve().then(read), timeout]);
      if (result && result.error) throw new Error(label + ': ' + result.error.message);
      console.info('[OPENMUSIC load] done:', label, Math.round(performance.now() - started) + 'ms');
      return result;
    } catch (error) {
      console.error('[OPENMUSIC load] failed:', label, Math.round(performance.now() - started) + 'ms', error.message);
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function loadGlobals() {
    const loadUid = currentUid;
    // Start all independent reads together; attendance supplies present counts too.
    const [tRes, sRes, pRes, setRes, tsRes, coRes, payRes, attRes] = await Promise.all([
      traceDataLoad('Giáo viên', () => B.listTeachers()),
      traceDataLoad('Học sinh', () => B.listStudents()),
      isAdmin() ? traceDataLoad('Tài khoản', () => B.listProfiles()) : {data: myProfile ? [myProfile] : []},
      traceDataLoad('Cài đặt', () => B.getSettings()),
      traceDataLoad('Thống kê giáo viên', () => B.teacherStats()),
      traceDataLoad('Khóa học', () => B.listCourses()),
      isAdmin() ? traceDataLoad('Học phí', () => B.listPayments()) : {data: []},
      traceDataLoad('Lịch sử điểm danh', () => B.listAttendanceWithDates()),
    ]);
    if (currentUid !== loadUid) return;
    const failed = [tRes, sRes, pRes, setRes, tsRes, coRes, payRes, attRes].find(result => result.error);
    if (failed) throw failed.error;
    if (currentUid !== loadUid) return;
    coursesByStudent = {};
    (coRes.data || []).forEach((c) => (coursesByStudent[c.student_id] || (coursesByStudent[c.student_id] = [])).push(c));
    Object.values(coursesByStudent).forEach((l) => l.sort((a, b) => a.seq - b.seq));
    settings = setRes.data || {};
    teacherStatsById = tsRes.data || {};
    teachers = tRes.data || [];
    teachersById = {}; teachers.forEach((t) => (teachersById[t.id] = t));
    students = (sRes.data || []).slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi"));
    studentsById = {}; students.forEach((s) => (studentsById[s.id] = s));
    profilesList = pRes.data || [];
    profilesById = {}; profilesList.forEach((p) => (profilesById[p.id] = p));
    presentByStudent = {};
    (attRes.data || []).forEach(a => { if (a.present === true) presentByStudent[a.student_id] = (presentByStudent[a.student_id] || 0) + 1; });
    myTeacher = teachers.find((t) => t.user_id === (user && user.id)) || null;

    allPayments = []; paidByStudent = {};
    attRowsByStudent = {}; courseInfo = {};
    // điểm danh kèm ngày -> chia buổi vào khóa (giáo viên chỉ đọc được lớp mình dạy -> tính trên các buổi đó)
    if (currentUid !== loadUid) return;
    if (isAdmin()) {
      allPayments = payRes.data || [];
      allPayments.forEach((p) => {
        const m = paidByStudent[p.student_id] || (paidByStudent[p.student_id] = { amount: 0, sessions: 0 });
        m.amount += Number(p.amount) || 0; m.sessions += Number(p.sessions) || 0;
      });
    }
    (attRes.data || []).forEach((r) => (attRowsByStudent[r.student_id] || (attRowsByStudent[r.student_id] = [])).push(r));
    students.forEach((s) => rebuildCourseInfo(s.id));
  }

  // hồ sơ giáo viên dùng để lọc lịch theo vai trò
  function scheduleTeacherFilter() {
    if (isAdmin()) {
      const f = $("teacherFilter").value;
      return (!f || f === "all") ? null : f;
    }
    return myTeacher ? myTeacher.id : "__none__";
  }
  function teacherDisplay(s) { return (teachersById[s.teacher_id] && teachersById[s.teacher_id].full_name) || s.teacher_name || "Giáo viên"; }

  // =====================================================================
  //  ROUTER
  // =====================================================================
  function switchView(view) {
    currentView = view;
    document.querySelectorAll(".menu-item, .tab[data-view]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-view") === view));
    // các mục không có trên thanh tab (Giáo viên, Lương…) -> sáng nút "Quản lý"
    $("tabMore").classList.toggle("active", !document.querySelector(`.tab[data-view="${view}"]:not([hidden])`));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    $("pageTitle").textContent = PAGE_TITLE[view] || "";
    $("heroTitle").textContent = HERO_TITLE[view] || PAGE_TITLE[view] || "";
    $("topViewTitle").textContent = HERO_TITLE[view] || PAGE_TITLE[view] || "";
    $("studentCount").hidden = view !== "students";
    $("pageSearchBtn").hidden = !['students', 'teachers', 'tuition'].includes(view);
    closeSidebar();
    if (view === "today") loadToday();
    else if (view === "schedule") { fillTeacherFilter(); setViewDate(viewDate); }
    else if (view === "students") renderStudents();
    else if (view === "teachers") renderTeachers();
    else if (view === "salary") { ensureSalaryDates(); }
    else if (view === "tuition") renderTuition();
    else if (view === "profit") { ensureProfitDates(); }
    else if (view === "notify") renderNotify();
    else if (view === "settings") renderSettings();
  }

  // =====================================================================
  //  HÔM NAY & ĐIỂM DANH
  // =====================================================================
  let todayScheds = [], todayAtt = [];

  // Được phép điểm danh/sửa ngày đang xem không?
  function canEditAttendance() {
    if (isAdmin() || MIGRATION_MODE) return true;        // admin luôn được; migration mở cho tất cả
    return ymd(attDate) >= ymd(startOfToday());           // còn lại: chỉ từ hôm nay trở đi
  }
  function setAttDate(d) { attDate = new Date(d); attDate.setHours(0, 0, 0, 0); loadToday(); }

  async function loadToday() {
    const request = ++todayRequest;
    $("todayTitle").textContent = `${DOW[attDate.getDay()]}, ${attDate.getDate()} tháng ${attDate.getMonth() + 1}`;
    $("todayDate").textContent = "";
    $("attDatePicker").value = dmy(attDate);
    $("migrationBanner").hidden = !(MIGRATION_MODE && ymd(attDate) < ymd(startOfToday()));
    const tf = scheduleTeacherFilter();
    if (tf === "__none__") {
      renderWeekStrip([]);
      $("todayList").innerHTML = '<div class="empty"><div class="big">🔗</div>Tài khoản của bạn chưa được gắn vào giáo viên nào.<br>Hãy nhờ Admin gắn ở mục “Giáo viên”.</div>';
      $("todayStats").innerHTML = "";
      return;
    }
    // tải cả tuần 1 lần: vừa lấy lớp của ngày đang xem, vừa đánh dấu các ngày có lớp trên dải tuần
    const t = ymd(attDate), ws = startOfWeek(attDate);
    const { data: weekScheds, error: scheduleError } = await B.listSchedules({ from: ymd(ws), to: ymd(addDays(ws, 6)), teacherId: tf });
    if (request !== todayRequest) return;
    if (scheduleError) { $("todayList").innerHTML = `<div class="empty">Không thể tải lịch: ${esc(scheduleError.message)}</div>`; $("todayStats").innerHTML = ""; return; }
    renderWeekStrip(weekScheds || []);
    todayScheds = (weekScheds || []).filter((s) => s.schedule_date === t);
    const ids = todayScheds.map((s) => s.id);
    const { data: atts, error: attError } = await B.listAttendanceBySchedules(ids);
    if (request !== todayRequest) return;
    if (attError) { $("todayList").innerHTML = `<div class="empty">Không thể tải điểm danh: ${esc(attError.message)}</div>`; return; }
    todayAtt = atts || [];
    renderToday();
  }

  function attFor(scheduleId) { return todayAtt.filter((a) => a.schedule_id === scheduleId); }

  // Dải 7 ngày (T2 → CN) của tuần chứa ngày đang xem; chấm nhỏ = ngày có lớp
  function renderWeekStrip(weekScheds) {
    const ws = startOfWeek(attDate), sel = ymd(attDate), today = ymd(startOfToday());
    const busy = new Set(weekScheds.map((s) => s.schedule_date));
    $("wsMonthLabel").textContent = `Tháng ${attDate.getMonth() + 1}, ${attDate.getFullYear()}`;
    let h = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), k = ymd(d);
      h += `<button type="button" class="ws-day${k === sel ? " active" : ""}${k === today ? " today" : ""}" data-wsday="${k}">` +
        `<span class="wd">${DOW_TINY[d.getDay()]}</span><strong>${d.getDate()}</strong><i class="dot${busy.has(k) ? "" : " none"}"></i></button>`;
    }
    $("wsDays").innerHTML = h;
  }

  function renderToday() {
    // thống kê
    let present = 0, absent = 0, none = 0;
    todayAtt.forEach((a) => { if (a.present === true) present++; else if (a.present === false) absent++; else none++; });
    $("todayStats").innerHTML = [[todayScheds.length,"lớp","primary"],[present,"có mặt","good"],[absent,"vắng","bad"],[none,"chưa ĐD","warn"]]
      .map(([n,label,cls]) => `<span class="today-stat ${cls}" aria-label="${n} ${label}"><b>${n}</b><span>${label}</span></span>`).join("");
    const isToday = ymd(attDate) === ymd(startOfToday());
    $("todayDate").textContent = "";

    if (!todayScheds.length) {
      $("todayList").innerHTML = `<div class="empty"><div class="big">🎵</div>${isToday ? "Hôm nay" : "Ngày này"} không có lớp nào.</div>`;
      return;
    }
    const now = new Date();
    const locked = !canEditAttendance();
    $("todayList").innerHTML = todayScheds.map((s) => classCard(s, now, locked)).join("");
  }
  function chip(n, l, cls) { return `<div class="stat-chip ${cls || ""}"><div class="n">${n}</div><div class="l">${l}</div></div>`; }

  function classCard(s, now, locked) {
    const rows = attFor(s.id);
    const endDt = new Date(`${s.schedule_date}T${s.end_time}`);
    const isPast = endDt < now;
    const tp = s.teacher_present;
    // Quy tắc màu nút "Có dạy": XANH khi đủ (mọi HS đều có mặt), CAM khi vẫn dạy nhưng KHÔNG đủ HS.
    const inClassCount = rows.length;
    const presentCount = rows.filter((a) => a.present === true).length;
    const allPresent = inClassCount > 0 && presentCount === inClassCount;
    const partial = tp === true && !allPresent;
    const tpToggle =
      `<span class="tp-label">Giáo viên:</span><div class="tp-toggle" data-tp="${s.id}">` +
      `<button class="yes ${tp === true ? "on" : ""}" data-tpv="1" aria-pressed="${tp === true}">Dạy</button>` +
      `<button class="no ${tp === false ? "on" : ""}" data-tpv="0" aria-pressed="${tp === false}">Nghỉ</button></div>` +
      (tp == null ? '<span class="tp-unmarked">Chưa xác nhận</span>' : '') +
      (partial ? `<span class="tp-hint" title="Lớp không đủ học sinh – vẫn tính buổi dạy cho lương">${inClassCount ? presentCount + "/" + inClassCount + " có mặt" : "chưa có HS"}</span>` : "");

    const studRows = rows.length
      ? rows.map((a) => {
          const st = studentsById[a.student_id];
          const nm = st ? st.full_name : "(học sinh đã xóa)";
          // admin: buổi này là buổi số mấy của khóa nào (hoặc buổi lẻ)
          let courseTag = "";
          const bd = courseInfo[a.student_id];
          if (bd) {
            let hit = null;
            bd.courses.forEach((x) => x.items.forEach((it) => { if (it.a.schedule_id === s.id) hit = { seq: x.c.seq, no: it.no, total: x.c.total_sessions }; }));
            const ex = !hit && bd.extra.find((it) => it.a.schedule_id === s.id);
            if (hit) courseTag = hit.no ? ` · Khóa ${hit.seq} · buổi ${hit.no}/${hit.total}` : ` · Khóa ${hit.seq} · không trừ buổi`;
            else if (ex) courseTag = ' · <b class="extra-txt">Buổi lẻ — hết khóa</b>';
          }
          const sub = st ? esc(st.subject || "") + courseTag : "";
          const status = a.present === true ? '<span class="att-status present">✓ Có mặt</span>'
            : a.present === false ? '<span class="att-status absent">✕ Vắng</span>'
            : '<span class="att-status none">• Chưa điểm danh</span>';
          // HS vắng -> hiện ô ghi lý do nghỉ (lưu lại để truy xuất trong PDF của HS)
          // khóa tính "có mặt + vắng không phép" -> cho đánh dấu vắng CÓ PHÉP (không trừ buổi)
          const excRow = studentRule(a.student_id) === "present_unexcused"
            ? `<label class="att-exc"><input type="checkbox" data-attexc="${s.id}|${a.student_id}" ${a.excused ? "checked" : ""}/> Có phép — không trừ buổi</label>` : "";
          const noteRow = a.present === false
            ? `<div class="att-note-row"><input class="att-note-input" type="text" maxlength="200" data-attnote="${s.id}|${a.student_id}" value="${esc(a.note || "")}" placeholder="Lý do nghỉ (VD: ốm, bận, xin phép…) — lưu vào PDF của học sinh">${excRow}</div>`
            : "";
          return `<div class="att-item"><div class="att-row">` +
            `<div class="att-name"><div class="att-name-top"><span class="n">${esc(nm)}</span>${status}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>` +
            `<div class="att-actions">` +
            `<button class="att-btn yes ${a.present === true ? "on" : ""}" data-att="${s.id}|${a.student_id}|1" title="Có mặt">✓</button>` +
            `<button class="att-btn no ${a.present === false ? "on" : ""}" data-att="${s.id}|${a.student_id}|0" title="Vắng">✕</button>` +
            `<button class="att-btn rm" data-attrm="${s.id}|${a.student_id}" title="Bỏ khỏi lớp">🗑</button>` +
            `</div></div>` + noteRow + `</div>`;
        }).join("")
      : '<div class="class-empty-students">Chưa có học sinh trong lớp này.</div>';

    // học sinh có thể thêm vào lớp
    const inClass = new Set(rows.map((a) => a.student_id));
    const addable = students.filter((st) => !inClass.has(st.id));
    const addRow = `<div class="cc-foot"><details class="student-picker"><summary>+ Thêm học sinh <span aria-hidden="true">⌄</span></summary><div class="student-picker-panel">` +
      `<input type="search" class="student-picker-search" data-studentquery="${s.id}" placeholder="Tìm tên, môn học hoặc số điện thoại…" aria-label="Tìm học sinh để thêm vào lớp" autocomplete="off" />` +
      `<div class="student-picker-results">${addable.map(st => `<button type="button" data-addstudent="${s.id}|${st.id}" data-studentmatch="${esc(norm(st.full_name + ' ' + (st.subject || '') + ' ' + (st.phone || '')))}"><span>${esc(st.full_name)}</span><small>${esc(st.subject || '')}</small><span aria-hidden="true">+</span></button>`).join('')}</div><p class="student-picker-empty" ${addable.length?'hidden':''}>Không có học sinh phù hợp.</p></div></details></div>`;

    // Đầu thẻ kiểu Liquid Glass: môn · loại lớp / tên học sinh / GV · lớp · phòng / trạng thái + thời lượng
    const names = rows.map((a) => studentsById[a.student_id] ? studentsById[a.student_id].full_name : "").filter(Boolean);
    const title = names.length ? (names.length > 3 ? names.slice(0, 3).join(" · ") + ` +${names.length - 3}` : names.join(" · "))
      : (s.class_name ? "Lớp " + s.class_name : s.subject);
    const marked = rows.filter((a) => a.present === true || a.present === false).length;
    const badge = !rows.length ? ""
      : marked === rows.length ? `<span class="cc-badge done">${CHECK_ICON} Đã điểm danh</span>`
      : `<span class="cc-badge pending" aria-label="Chưa điểm danh đầy đủ: ${marked}/${rows.length}">Chưa ĐD ${marked}/${rows.length}</span>`;
    const [sh, sm] = hhmm(s.start_time).split(":").map(Number), [eh, em] = hhmm(s.end_time).split(":").map(Number);
    const dur = (eh * 60 + em) - (sh * 60 + sm);
    const meta = [teacherDisplay(s), s.class_name && names.length ? "Lớp " + s.class_name : "", s.room || ""].filter(Boolean).map(esc).join(" · ");

    return `<div class="lesson">` +
      `<div class="class-card ${isPast ? "is-past" : ""} ${locked ? "locked" : ""}">` +
        `<div class="cc-head">` +
          `<div class="cc-time-inline"><b>${hhmm(s.start_time)} – ${hhmm(s.end_time)}</b>${dur > 0 ? `<span>${dur} phút</span>` : ''}</div>` +
          `<div class="cc-eyebrow">${esc(s.subject)} · ${lessonTypeLabel(s.lesson_type)}</div>` +
          `<div class="cc-title-row"><div class="cc-title">${esc(title)}</div>${badge}</div>` +
          `<div class="cc-meta">${meta}</div>` +
        `</div>` +
        `<div class="cc-body">${studRows}</div>` +
        `<div class="cc-tpresent">${tpToggle}</div>` +
        addRow +
      `</div>` +
    `</div>`;
  }

  // các <option> học sinh có thể thêm vào lớp (lọc theo ô tìm; iOS không ẩn được option nên dựng lại)
  function addOptions(addable, q) {
    const qq = norm(q);
    const list = qq ? addable.filter((st) => norm(st.full_name + " " + (st.subject || "") + " " + (st.phone || "")).includes(qq)) : addable;
    const head = qq ? `${list.length ? "+ Chọn trong " + list.length + " kết quả…" : "Không có HS phù hợp"}` : "+ Thêm học sinh vào lớp…";
    return `<option value="">${head}</option>` +
      list.map((st) => `<option value="${st.id}">${esc(st.full_name)}${st.subject ? " · " + esc(st.subject) : ""}</option>`).join("");
  }
  function filterAddSelect(scheduleId, q) {
    const inClass = new Set(attFor(scheduleId).map((a) => a.student_id));
    const sel = document.querySelector(`[data-addsel="${scheduleId}"]`); if (!sel) return;
    sel.innerHTML = addOptions(students.filter((st) => !inClass.has(st.id)), q);
  }
  async function markExcused(scheduleId, studentId, excused) {
    if (!canEditAttendance()) return toast("Chỉ điểm danh được từ hôm nay trở đi.", "err");
    const { error } = await B.setAttendanceExcused(scheduleId, studentId, excused, user.id);
    if (error) return toast("Lỗi lưu: " + error.message + (/excused/.test(error.message) ? " — cần chạy supabase-migration-6.sql" : ""), "err");
    const cur = todayAtt.find((a) => a.schedule_id === scheduleId && a.student_id === studentId);
    if (cur) cur.excused = excused;
    patchAttCache(scheduleId, studentId, { excused });
    renderToday();
    toast(excused ? "Đã đánh dấu vắng có phép (không trừ buổi)." : "Đã bỏ có phép — buổi vắng này sẽ bị trừ.", "ok");
  }

  async function markStudent(scheduleId, studentId, present) {
    if (!canEditAttendance()) return toast("Chỉ điểm danh được từ hôm nay trở đi.", "err");
    const cur = todayAtt.find((a) => a.schedule_id === scheduleId && a.student_id === studentId);
    // bấm lại nút đang bật -> bỏ chọn (về "chưa điểm danh")
    const newVal = (cur && cur.present === present) ? null : present;
    const { error } = await B.setAttendance(scheduleId, studentId, newVal, user.id);
    if (error) return toast("Lỗi điểm danh: " + error.message, "err");
    if (cur) cur.present = newVal;
    else todayAtt.push({ schedule_id: scheduleId, student_id: studentId, present: newVal });
    patchAttCache(scheduleId, studentId, { present: newVal });
    renderToday();
  }
  // Lưu ghi chú lý do nghỉ của HS (gọi khi rời ô nhập). Không re-render để không mất con trỏ.
  async function saveAttNote(scheduleId, studentId, note) {
    if (!canEditAttendance()) return;
    const val = (note || "").trim() || null;
    const cur = todayAtt.find((a) => a.schedule_id === scheduleId && a.student_id === studentId);
    if (cur && (cur.note || null) === val) return;   // không đổi -> bỏ qua
    const { error } = await B.setAttendanceNote(scheduleId, studentId, val, user.id);
    if (error) return toast("Lỗi lưu ghi chú: " + error.message, "err");
    if (cur) cur.note = val;
    else todayAtt.push({ schedule_id: scheduleId, student_id: studentId, present: false, note: val });
    if (val) toast("Đã lưu lý do nghỉ.", "ok");
  }
  async function markTeacher(scheduleId, present) {
    if (!canEditAttendance()) return toast("Chỉ điểm danh được từ hôm nay trở đi.", "err");
    const s = todayScheds.find((x) => x.id === scheduleId);
    const newVal = (s && s.teacher_present === present) ? null : present;
    const { error } = await B.updateSchedule(scheduleId, { teacher_present: newVal, teacher_marked_at: new Date().toISOString() });
    if (error) return toast("Lỗi điểm danh GV: " + error.message, "err");
    if (s) s.teacher_present = newVal;
    renderToday();
  }
  async function addStudentToClass(scheduleId, studentId) {
    if (!studentId) return;
    if (!canEditAttendance()) return toast("Chỉ điểm danh được từ hôm nay trở đi.", "err");
    const { error } = await B.setAttendance(scheduleId, studentId, null, user.id);
    if (error) return toast("Lỗi: " + error.message, "err");
    todayAtt.push({ schedule_id: scheduleId, student_id: studentId, present: null });
    patchAttCache(scheduleId, studentId, { present: null });
    renderToday();
    toast("Đã thêm học sinh vào lớp.", "ok");
  }
  async function removeStudentFromClass(scheduleId, studentId) {
    if (!canEditAttendance()) return toast("Chỉ điểm danh được từ hôm nay trở đi.", "err");
    const { error } = await B.removeAttendance(scheduleId, studentId);
    if (error) return toast("Lỗi: " + error.message, "err");
    todayAtt = todayAtt.filter((a) => !(a.schedule_id === scheduleId && a.student_id === studentId));
    patchAttCache(scheduleId, studentId, null);
    renderToday();
  }

  // =====================================================================
  //  THỜI KHÓA BIỂU (tuần)
  // =====================================================================
  let allForWeek = [], attByWeek = {}, weekStudNames = {}, weekAbsentNames = {};

  function fillTeacherFilter() {
    const sel = $("teacherFilter"); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="all">Tất cả giáo viên</option>';
    teachers.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi")).forEach((t) => {
      const o = document.createElement("option"); o.value = t.id; o.textContent = t.full_name || "(không tên)"; sel.appendChild(o);
    });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  function setViewDate(d) {
    viewDate = new Date(d); viewDate.setHours(0, 0, 0, 0);
    const ws = startOfWeek(viewDate), we = addDays(ws, 6);
    $("navRange").textContent = `${dmy(ws).slice(0, 5)} – ${dmy(we).slice(0, 5)}`;
    $("navRange").setAttribute("aria-label", `Tuần từ ${dmy(ws)} đến ${dmy(we)}`);
    $("navMonth").textContent = `Tháng ${ws.getMonth() + 1}, ${ws.getFullYear()}`;
    $("datePicker").value = dmy(viewDate);
    renderScheduleDays();
    loadWeek();
  }
  function navigate(kind, delta) {
    const d = new Date(viewDate);
    if (kind === "week") d.setDate(d.getDate() + delta * 7);
    else if (kind === "month") d.setMonth(d.getMonth() + delta);
    setViewDate(d);
  }

  async function loadWeek() {
    const request = ++weekRequest;
    $("tkbWrap").classList.add("loading"); $("loading").classList.remove("hidden");
    const ws = startOfWeek(viewDate), we = addDays(ws, 6);
    const tf = scheduleTeacherFilter();
    if (tf === "__none__") { allForWeek = []; attByWeek = {}; $("loading").classList.add("hidden"); $("tkbWrap").classList.remove("loading"); renderWeek(); return; }
    const { data, error } = await B.listSchedules({ from: ymd(ws), to: ymd(we), teacherId: tf });
    if (request !== weekRequest) return;
    allForWeek = error ? [] : (data || []);
    const ids = allForWeek.map((s) => s.id);
    const { data: atts, error: attError } = await B.listAttendanceBySchedules(ids);
    if (request !== weekRequest) return;
    if (attError) { $("loading").classList.add("hidden"); $("tkbWrap").classList.remove("loading"); $("weekList").innerHTML = `<div class="empty">Không thể tải điểm danh: ${esc(attError.message)}</div>`; return; }
    attByWeek = {}; weekStudNames = {}; weekAbsentNames = {};
    (atts || []).forEach((a) => {
      const m = attByWeek[a.schedule_id] || (attByWeek[a.schedule_id] = { total: 0, present: 0, absent: 0, none: 0 });
      m.total++; if (a.present === true) m.present++; else if (a.present === false) m.absent++; else m.none++;
      const nm = studentsById[a.student_id] && studentsById[a.student_id].full_name;
      if (nm) (weekStudNames[a.schedule_id] = weekStudNames[a.schedule_id] || []).push(nm);
      if (a.present === false) (weekAbsentNames[a.schedule_id] = weekAbsentNames[a.schedule_id] || []).push(nm || "Học sinh đã xóa");
    });
    $("loading").classList.add("hidden"); $("tkbWrap").classList.remove("loading");
    if (error) toast("Lỗi tải lịch: " + error.message, "err");
    renderWeek();
  }

  function renderScheduleDays() {
    const ws = startOfWeek(viewDate), selected = ymd(viewDate), today = ymd(startOfToday());
    $("scheduleDays").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws, i), date = ymd(d), active = date === selected;
      const hasLessons = allForWeek.some((s) => s.schedule_date === date);
      return `<button type="button" class="schedule-day${active ? " active" : ""}${date === today ? " is-today" : ""}" data-schedule-date="${date}" aria-pressed="${active}" aria-label="Xem lịch ${DOW[d.getDay()]}, ${dmy(d)}">` +
        `<span class="schedule-weekday">${["T2", "T3", "T4", "T5", "T6", "T7", "CN"][i]}</span><strong>${d.getDate()}</strong>` +
        `<span class="schedule-day-dot${hasLessons ? "" : " none"}" aria-hidden="true"></span></button>`;
    }).join("");
  }

  function renderWeek() {
    renderScheduleDays();
    const ws = startOfWeek(viewDate);
    const days = []; for (let i = 0; i < 7; i++) days.push(addDays(ws, i));
    const todayY = ymd(startOfToday());
    const map = {}; days.forEach((d) => (map[ymd(d)] = { sang: [], chieu: [], toi: [] }));
    allForWeek.forEach((s) => { const m = map[s.schedule_date]; if (m) m[buoiOf(s.start_time)].push(s); });
    renderWeekGrid(days, map, todayY);
    renderWeekList(days, map, todayY);
  }

  function attSummary(s) {
    const m = attByWeek[s.id];
    if (!m || !m.total) return "";
    const done = m.none === 0;
    return `<div class="schedule-attendance"><span class="schedule-att-label">${done ? "Đã điểm danh" : "Đang điểm danh"}</span><b>${m.present}/${m.total} có mặt</b>` +
      (m.absent ? `<span class="schedule-absent">Vắng: ${esc((weekAbsentNames[s.id] || []).join(", ")) || m.absent + " học sinh"}</span>` : "") + `</div>`;
  }

  function miniCard(s, compact) {
    const name = teacherDisplay(s);
    const admin = isAdmin();
    const act = admin
      ? `<div class="acts"><button class="edit" data-edit="${s.id}" title="Sửa">${ICON_EDIT}</button>` +
        `<button class="del" data-del="${s.id}" title="Xóa">${ICON_DEL}</button></div>`
      : "";
    const m = attByWeek[s.id];
    const done = m && m.total && m.none === 0;
    const names = (weekStudNames[s.id] || []).join(", ");
    return `<div class="mini ${done ? "att-done" : ""}${compact ? " mini-compact" : ""}">` +
      `<div class="mini-top"><div class="t">${hhmm(s.start_time)} – ${hhmm(s.end_time)}</div>${act}</div>` +
      `<div class="mini-layout"><div class="mini-main"><div class="s">${esc(s.subject)} <span class="mini-type">${esc(lessonTypeLabel(s.lesson_type))}</span></div>` +
      `<div class="mini-students">${esc(names || s.class_name || "Chưa có học sinh")}</div>` +
      `<div class="mini-teacher"><span>Giáo viên</span><strong>${esc(name)}</strong></div></div>` +
      `<div class="mini-side">${s.class_name ? `<span class="mini-detail">Lớp <b>${esc(s.class_name)}</b></span>` : ""}${s.room ? `<span class="mini-detail">Phòng <b>${esc(s.room)}</b></span>` : ""}</div></div>` +
      attSummary(s) + (s.note ? `<div class="mini-note">${esc(s.note)}</div>` : "") + `</div>`;
  }

  function renderWeekGrid(days, map, todayY) {
    const admin = isAdmin();
    let h = '<div class="wg-corner"></div>';
    days.forEach((d) => {
      const t = ymd(d) === todayY ? " today" : "";
      h += `<div class="wg-head${t}"><div class="wd">${DOW_SHORT[d.getDay()]}</div><div class="dt">${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}</div></div>`;
    });
    BUOI.forEach((b) => {
      h += `<div class="wg-buoi"><span class="chip ${b.key}"><span class="ic">${b.icon}</span>${b.label}</span></div>`;
      days.forEach((d) => {
        const dy = ymd(d), t = dy === todayY ? " today" : "";
        const items = map[dy][b.key];
        h += `<div class="wg-cell${t}">` + items.map((s) => miniCard(s, true)).join("") +
          (admin ? `<button class="cell-add" data-add="${dy}|${b.key}" title="Thêm buổi học">+</button>` : "") + `</div>`;
      });
    });
    $("weekGrid").innerHTML = h;
  }

  function renderWeekList(days, map, todayY) {
    const admin = isAdmin();
    let h = "";
    days.forEach((d) => {
      const dy = ymd(d), t = dy === todayY ? " today" : "";
      const dayBuois = BUOI.filter((b) => map[dy][b.key].length);
      h += `<div class="day-block" data-schedule-block="${dy}"><div class="dhead${t}"><div class="day-heading"><span class="dname">${DOW[d.getDay()]} — ${dmy(d)}</span><div class="day-periods">${dayBuois.map(b => `<span class="buoi-pill ${b.key}">${b.icon} ${b.label}</span>`).join('')}</div></div>` +
        (admin ? `<button class="dadd" data-add="${dy}|chieu">+ Thêm</button>` : "") + `</div><div class="dbody">`;
      if (!dayBuois.length) h += `<div class="day-empty">Chưa có lịch.</div>`;
      else dayBuois.forEach((b) => {
        h += `<div class="buoi-row"><div class="buoi-items">` +
          map[dy][b.key].map((s) => miniCard(s, false)).join("") + `</div></div>`;
      });
      h += `</div></div>`;
    });
    $("weekList").innerHTML = h;
  }

  // =====================================================================
  //  MODAL BUỔI HỌC (admin)
  // =====================================================================
  async function openScheduleModal(schedule, presetDate, presetBuoi) {
    if (!isAdmin()) return;
    if (teachers.length === 0) { toast("Chưa có giáo viên — thêm ở mục “Giáo viên” trước.", "err"); return; }
    const isEdit = !!schedule;
    $("modalTitle").textContent = isEdit ? "Sửa buổi học" : "Thêm buổi học";
    $("formErr").classList.add("hidden");
    $("scheduleForm").reset();
    $("schedId").value = isEdit ? schedule.id : "";

    if (isEdit) {
      $("fSubject").value = schedule.subject || "";
      $("fDate").value = ymdToDmy(schedule.schedule_date);
      $("fStart").value = hhmm(schedule.start_time);
      $("fEnd").value = hhmm(schedule.end_time);
      $("fClass").value = schedule.class_name || "";
      $("fRoom").value = schedule.room || "";
      $("fNote").value = schedule.note || "";
    } else {
      $("fDate").value = ymdToDmy(presetDate || ymd(viewDate));
      const preset = { sang: ["08:00", "09:30"], chieu: ["14:00", "15:30"], toi: ["18:30", "20:00"] }[presetBuoi] || ["14:00", "15:30"];
      $("fStart").value = preset[0]; $("fEnd").value = preset[1];
    }
    fillLessonTypeSelect($("fLessonType"), isEdit ? schedule.lesson_type : "ca_nhan");
    fillSubjectSelect($("fSubject"), isEdit ? schedule.subject : "");

    // Admin / chế độ migration được phép xếp lịch (và điểm danh) cho ngày quá khứ
    $("fDateNative").min = (isAdmin() || MIGRATION_MODE) ? "" : ymd(startOfToday());

    // giáo viên phụ trách
    const ownerSel = $("fOwner"); ownerSel.innerHTML = "";
    teachers.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi"))
      .forEach((t) => { const o = document.createElement("option"); o.value = t.id; o.textContent = t.full_name; ownerSel.appendChild(o); });
    ownerSel.value = isEdit ? schedule.teacher_id : (teachers[0] && teachers[0].id);

    // học sinh trong lớp
    let checkedIds = new Set();
    if (isEdit) {
      const { data } = await B.listAttendanceBySchedules([schedule.id]);
      (data || []).forEach((a) => checkedIds.add(a.student_id));
    }
    $("fStudents").innerHTML = students.length
      ? students.map((st) => `<label class="chk-item" data-q="${esc(norm(st.full_name + " " + (st.subject || "") + " " + (st.phone || "")))}"><input type="checkbox" data-sid="${st.id}" ${checkedIds.has(st.id) ? "checked" : ""}/> ${esc(st.full_name)}<span class="ci-sub">${esc(st.subject || "")}</span></label>`).join("")
      : '<div class="chk-empty">Chưa có học sinh — thêm ở mục “Học sinh”.</div>';
    $("fStudentSearch").value = "";

    // reset áp dụng cho các tuần sau
    $("fRepeat").checked = false;
    $("fRepeatWrap").style.display = "none";
    $("fRepeatInfo").textContent = "";
    modalApplyWeeks = []; modalApplyCopy = true;

    $("modal").classList.remove("hidden");
    $("fSubject").focus();
  }
  function closeScheduleModal() { $("modal").classList.add("hidden"); }
  function formErr(msg) { const e = $("formErr"); e.textContent = msg; e.classList.remove("hidden"); }

  async function saveSchedule() {
    const id = $("schedId").value;
    const ownerId = $("fOwner").value;
    const ownerName = teachersById[ownerId] && teachersById[ownerId].full_name;
    const sd = dmyToYmd($("fDate").value), st = normTime($("fStart").value), et = normTime($("fEnd").value);
    const payload = {
      schedule_date: sd, subject: $("fSubject").value.trim(), start_time: st, end_time: et,
      class_name: $("fClass").value.trim() || null, room: $("fRoom").value.trim() || null,
      lesson_type: $("fLessonType").value || "ca_nhan",
      teacher_id: ownerId, teacher_name: ownerName, note: $("fNote").value.trim() || null,
    };
    if (!payload.subject) return formErr("Vui lòng nhập môn / nhạc cụ.");
    if (!ownerId) return formErr("Vui lòng chọn giáo viên phụ trách.");
    if (!sd) return formErr("Ngày không hợp lệ — nhập dd/mm/yyyy.");
    if (!st || !et) return formErr("Giờ không hợp lệ — nhập HH:MM (24h).");
    if (et <= st) return formErr("Giờ kết thúc phải sau giờ bắt đầu.");

    const checked = [...document.querySelectorAll('#fStudents input[type="checkbox"]')].filter((c) => c.checked).map((c) => c.getAttribute("data-sid"));

    $("modalSave").disabled = true;
    try {
      let schedId = id;
      if (id) {
        const { error } = await B.updateSchedule(id, payload);
        if (error) throw error;
      } else {
        const { data, error } = await B.addSchedule(payload);
        if (error) throw error;
        schedId = data && data.id;
      }
      // đồng bộ học sinh trong lớp
      if (!schedId) throw new Error("Không nhận được mã buổi học.");
      $("schedId").value = schedId; // Giữ mã khi thử lại sau lỗi đồng bộ, tránh tạo trùng buổi.
      const { data: existing, error: syncReadError } = await B.listAttendanceBySchedules([schedId]);
      if (syncReadError) throw syncReadError;
      const existingIds = new Set((existing || []).map((a) => a.student_id));
      const checkedSet = new Set(checked);
      const ops = [];
      checked.forEach((sid) => { if (!existingIds.has(sid)) ops.push(B.setAttendance(schedId, sid, null, user.id)); });
      existingIds.forEach((sid) => { if (!checkedSet.has(sid)) ops.push(B.removeAttendance(schedId, sid)); });
      const syncResults = await Promise.all(ops);
      const syncFailure = syncResults.find(r => r && r.error);
      if (syncFailure) throw new Error("Buổi học đã lưu, nhưng đồng bộ học sinh thất bại: " + syncFailure.error.message);

      let repInfo = "";
      if ($("fRepeat").checked && modalApplyWeeks.length) {
        const n = await replicateClassToWeeks(payload, checked, modalApplyWeeks, modalApplyCopy);
        repInfo = ` · +${n} tuần`;
      }
      closeScheduleModal();
      toast((id ? "Đã cập nhật buổi học." : "Đã thêm buổi học.") + repInfo, "ok");
      viewDate = parseYmd(sd);
      if (currentView === "schedule") setViewDate(viewDate);
      if (currentView === "today") loadToday();
      refreshRemindCache();
    } catch (err) {
      formErr("Lưu thất bại: " + (err.message || err));
    } finally {
      $("modalSave").disabled = false;
    }
  }

  async function deleteSchedule(id) {
    const s = allForWeek.find((x) => x.id === id) || todayScheds.find((x) => x.id === id);
    if (!s) return;
    if (!confirm(`Xóa buổi "${s.subject}" (${hhmm(s.start_time)}–${hhmm(s.end_time)})? Không thể hoàn tác.`)) return;
    const { error } = await B.deleteSchedule(id);
    if (error) return toast("Xóa thất bại: " + error.message, "err");
    toast("Đã xóa buổi học.", "ok");
    if (currentView === "schedule") loadWeek();
    if (currentView === "today") loadToday();
  }

  // =====================================================================
  //  NHÂN BẢN TKB SANG CÁC TUẦN (bộ chọn tuần)
  // =====================================================================
  function openWeekPicker(opts) {
    $("wkTitle").textContent = opts.title || "Áp dụng cho các tuần";
    $("wkSub").textContent = opts.subtitle || "";
    $("wkCopyRow").style.display = opts.showCopy === false ? "none" : "";
    $("wkCopyStudents").checked = true;
    const N = opts.weeks || 70;
    let ws = startOfWeek(opts.fromWeekStart || addDays(startOfWeek(viewDate), 7));
    const excludeY = opts.excludeWeekStart ? ymd(startOfWeek(opts.excludeWeekStart)) : null;
    const anchorMon = opts.anchorWeekStart ? (startOfWeek(opts.anchorWeekStart).getFullYear() + "-" + startOfWeek(opts.anchorWeekStart).getMonth()) : null;
    const todayY = ymd(startOfToday());
    let html = "", curMon = null;
    for (let i = 0; i < N; i++) {
      const we = addDays(ws, 6), monKey = ws.getFullYear() + "-" + ws.getMonth();
      if (monKey !== curMon) { curMon = monKey; html += `<div class="wk-month"${monKey === anchorMon ? ' id="wkAnchorMon"' : ""}><label><input type="checkbox" class="wk-mon" data-mon="${monKey}"/> Tháng ${ws.getMonth() + 1}/${ws.getFullYear()}</label></div>`; }
      if (ymd(ws) !== excludeY) {
        const past = ymd(ws) < todayY ? ' <span class="wk-past">(đã qua)</span>' : "";
        html += `<label class="wk-item" data-mon="${monKey}"><input type="checkbox" class="wk-week" value="${ymd(ws)}"/> Tuần ${dmy(ws)} – ${dmy(we)}${past}</label>`;
      }
      ws = addDays(ws, 7);
    }
    $("wkList").innerHTML = html;
    weekPickerCb = opts.onApply || null;
    $("weekModal").classList.remove("hidden");
    const anc = document.getElementById("wkAnchorMon");
    if (anc) requestAnimationFrame(function () { $("wkList").scrollTop = Math.max(0, anc.offsetTop - 6); });
  }
  function closeWeekPicker() { $("weekModal").classList.add("hidden"); }
  function weekPickerConfirm() {
    const weeks = [...document.querySelectorAll("#wkList .wk-week:checked")].map((c) => c.value);
    if (!weeks.length) return toast("Hãy chọn ít nhất 1 tuần.", "err");
    const copy = $("wkCopyStudents").checked;
    closeWeekPicker();
    if (weekPickerCb) weekPickerCb(weeks, copy);
  }

  // Áp dụng TOÀN BỘ lịch tuần nguồn sang các tuần được chọn
  async function applyWeekToWeeks(srcWeekStart, targetWeekStarts, copyStudents) {
    toast("Đang áp dụng lịch…");
    const ws = srcWeekStart, we = addDays(ws, 6);
    const { data: src, error: sourceError } = await B.listSchedules({ from: ymd(ws), to: ymd(we), teacherId: null });
    if (sourceError) return toast("Không thể tải tuần nguồn: " + sourceError.message, "err");
    if (!src || !src.length) return toast("Tuần nguồn chưa có lịch để áp dụng.", "err");
    let srcStudents = {};
    if (copyStudents) {
      const { data: atts, error: attError } = await B.listAttendanceBySchedules(src.map((s) => s.id));
      if (attError) return toast("Không thể tải học sinh: " + attError.message, "err");
      (atts || []).forEach((a) => { (srcStudents[a.schedule_id] = srcStudents[a.schedule_id] || []).push(a.student_id); });
    }
    const sorted = targetWeekStarts.slice().sort();
    const { data: existing, error: existingError } = await B.listSchedules({ from: sorted[0], to: ymd(addDays(parseYmd(sorted[sorted.length - 1]), 6)), teacherId: null });
    if (existingError) return toast("Không thể kiểm tra lịch hiện có: " + existingError.message, "err");
    const exKey = new Set((existing || []).map((s) => s.schedule_date + "|" + s.start_time + "|" + s.teacher_id));
    const newRows = [], srcOf = [];
    targetWeekStarts.forEach((twY) => {
      const tw = parseYmd(twY);
      src.forEach((s) => {
        const off = Math.round((parseYmd(s.schedule_date) - srcWeekStart) / 86400000);
        const nd = ymd(addDays(tw, off)), key = nd + "|" + s.start_time + "|" + s.teacher_id;
        if (exKey.has(key)) return;
        exKey.add(key);
        newRows.push({ teacher_id: s.teacher_id, schedule_date: nd, subject: s.subject, class_name: s.class_name, start_time: s.start_time, end_time: s.end_time, room: s.room, lesson_type: s.lesson_type || "ca_nhan", teacher_name: s.teacher_name, note: s.note });
        srcOf.push(s.id);
      });
    });
    if (!newRows.length) return toast("Các tuần đã chọn đều đã có lịch — không thêm trùng.", "ok");
    const { data: inserted, error } = await B.addSchedulesBulk(newRows);
    if (error) return toast("Lỗi áp dụng: " + error.message, "err");
    if (copyStudents) {
      const insMap = {}; (inserted || []).forEach((r) => { insMap[r.schedule_date + "|" + r.start_time + "|" + r.teacher_id] = r.id; });
      const attRows = [];
      newRows.forEach((nr, i) => { const id = insMap[nr.schedule_date + "|" + nr.start_time + "|" + nr.teacher_id], studs = srcStudents[srcOf[i]] || []; if (id) studs.forEach((sid) => attRows.push({ schedule_id: id, student_id: sid })); });
      if (attRows.length) { const result = await B.addAttendanceBulk(attRows); if (result.error) return toast("Lịch đã thêm, nhưng học sinh chưa được sao chép: " + result.error.message, "err"); }
    }
    toast(`Đã áp dụng ${(inserted || []).length} buổi cho ${targetWeekStarts.length} tuần.`, "ok");
    if (currentView === "schedule") loadWeek();
  }

  // Nhân bản 1 buổi học sang các tuần được chọn (cùng thứ)
  async function replicateClassToWeeks(payload, studentIds, weekStarts, copyStudents) {
    const baseDate = parseYmd(payload.schedule_date), off = (baseDate.getDay() + 6) % 7;
    const sorted = weekStarts.slice().sort();
    const { data: existing, error: existingError } = await B.listSchedules({ from: sorted[0], to: ymd(addDays(parseYmd(sorted[sorted.length - 1]), 6)), teacherId: payload.teacher_id });
    if (existingError) throw existingError;
    const exKey = new Set((existing || []).map((s) => s.schedule_date + "|" + s.start_time + "|" + s.teacher_id));
    const newRows = [];
    weekStarts.forEach((twY) => {
      const nd = ymd(addDays(parseYmd(twY), off)), key = nd + "|" + payload.start_time + "|" + payload.teacher_id;
      if (exKey.has(key)) return;
      exKey.add(key);
      newRows.push({ teacher_id: payload.teacher_id, schedule_date: nd, subject: payload.subject, class_name: payload.class_name, start_time: payload.start_time, end_time: payload.end_time, room: payload.room, lesson_type: payload.lesson_type, teacher_name: payload.teacher_name, note: payload.note });
    });
    if (!newRows.length) return 0;
    const { data: inserted, error: insertError } = await B.addSchedulesBulk(newRows);
    if (insertError) throw insertError;
    if (copyStudents && studentIds && studentIds.length) {
      const attRows = [];
      (inserted || []).forEach((r) => studentIds.forEach((sid) => attRows.push({ schedule_id: r.id, student_id: sid })));
      if (attRows.length) { const result = await B.addAttendanceBulk(attRows); if (result.error) throw new Error("Lịch lặp đã thêm, nhưng sao chép học sinh thất bại: " + result.error.message); }
    }
    return (inserted || []).length;
  }

  // =====================================================================
  //  HỌC SINH (admin)
  // =====================================================================
  // Tiến độ KHÓA ĐANG HỌC (admin: chia theo khóa; giáo viên: đếm tổng như cũ)
  //  -> { used, total, remaining, ratio, seq, courseCount, extra (số buổi lẻ), fee, done }
  function studentProgress(st) {
    const bd = courseInfo[st.id];
    if (bd) {
      const cur = bd.courses[bd.cur];
      const total = cur.c.total_sessions || 0, used = cur.used;
      const remaining = Math.max(0, total - used);
      return { used, total, remaining, ratio: total ? Math.min(1, used / total) : 0, seq: cur.c.seq || bd.cur + 1, courseCount: bd.courses.length,
        extra: bd.extraUsed, fee: Number(cur.c.tuition_per_session) || 0, done: !!total && remaining === 0 };
    }
    const used = presentByStudent[st.id] || 0;
    const total = st.total_sessions || 0;
    const remaining = Math.max(0, total - used);
    return { used, total, remaining, ratio: total ? Math.min(1, used / total) : 0, seq: 1, courseCount: 1, extra: 0, fee: Number(st.tuition_per_session) || 0, done: !!total && remaining === 0 };
  }
  // Tổng học phí phát sinh theo buổi đã trừ: Σ (buổi đã học của từng khóa × HP khóa) + buổi lẻ × HP/buổi của HS
  function earnedTuition(st) {
    const bd = courseInfo[st.id];
    if (!bd) return studentProgress(st).used * (st.tuition_per_session || 0);
    return bd.courses.reduce((s, x) => s + x.used * (Number(x.c.tuition_per_session) || 0), 0) + bd.extraUsed * (Number(st.tuition_per_session) || 0);
  }

  // Tổng học phí PHẢI ĐÓNG tới hiện tại: mọi khóa (trọn khóa) + buổi lẻ — để so với tổng tiền đã đóng
  function billedTuition(st) {
    const bd = courseInfo[st.id];
    if (!bd) return (st.total_sessions || 0) * (st.tuition_per_session || 0);
    return bd.courses.reduce((s, x) => s + (x.c.total_sessions || 0) * (Number(x.c.tuition_per_session) || 0), 0) + bd.extraUsed * (Number(st.tuition_per_session) || 0);
  }

  function renderPageSearch() {
    const teacherMode = currentView === 'teachers';
    const sourceId = teacherMode ? 'teacherSearch' : currentView === 'tuition' ? 'tuitionSearch' : 'studentSearch';
    const query = norm($("pageSearchInput").value);
    $(sourceId).value = $("pageSearchInput").value;
    if (teacherMode) renderTeachers(); else if (currentView === 'tuition') renderTuition(); else renderStudents();
    const records = teacherMode ? teachers : students;
    const matches = records.filter(r => norm([r.full_name,r.phone,r.guardian,r.subject,r.specialty,(teachersById[r.teacher_id] || {}).full_name,(profilesById[r.user_id] || {}).email].filter(Boolean).join(' ')).includes(query));
    $("pageSearchResults").innerHTML = matches.length ? matches.slice(0,12).map(r => `<button type="button" data-search-name="${esc(r.full_name)}"><strong>${esc(r.full_name)}</strong><span>${esc(r.specialty || r.subject || '')}</span></button>`).join('') : '<p>Không có kết quả phù hợp.</p>';
    $("pageSearchDone").textContent = `Xem ${matches.length} kết quả`;
  }
  function openPageSearch() {
    const teacherMode = currentView === 'teachers';
    const sourceId = teacherMode ? 'teacherSearch' : currentView === 'tuition' ? 'tuitionSearch' : 'studentSearch';
    $("pageSearchTitle").textContent = teacherMode ? 'Tìm giáo viên' : currentView === 'tuition' ? 'Tìm học phí' : 'Tìm học sinh';
    $("pageSearchInput").placeholder = teacherMode ? 'Tìm tên, chuyên môn, email…' : 'Tìm tên, số điện thoại, phụ huynh…';
    $("pageSearchInput").value = $(sourceId).value;
    renderPageSearch(); $("pageSearchDialog").showModal(); $("pageSearchInput").focus();
  }
  function renderStudents() {
    const q = norm($("studentSearch").value);
    // tìm theo tên, môn, SĐT, phụ huynh, giáo viên (không cần gõ dấu)
    const list = students.filter((s) => !q || [s.full_name, s.subject, s.phone, s.guardian, teachersById[s.teacher_id] && teachersById[s.teacher_id].full_name, s.note]
      .some((v) => norm(v).includes(q)));
    $("studentCount").textContent = q ? `${list.length}/${students.length} học sinh` : `${students.length} học sinh`;
    if (!list.length) { $("studentList").innerHTML = `<div class="empty"><div class="big">🎓</div>${q ? "Không tìm thấy học sinh phù hợp." : "Chưa có học sinh nào."}</div>`; return; }
    $("studentList").innerHTML = list.map((s) => {
      const p = studentProgress(s);
      const paid = paidByStudent[s.id] || { amount: 0, sessions: 0 };
      const owed = Math.max(0, billedTuition(s) - paid.amount);
      const tag = p.done ? `<span class="tag-done">Hết khóa ${p.seq}</span>` + (p.extra ? ` <span class="tag-extra">${p.extra} buổi lẻ</span>` : "")
        : s.status === "completed" ? '<span class="tag-done">Đã kết thúc</span>'
        : (p.remaining <= 2 && p.total ? '<span class="tag-near">Sắp hết khóa</span>' : "");
      const pcls = p.done ? "done" : (p.remaining <= 2 && p.total ? "near" : "");
      return `<div class="info-card">` +
        `<div class="ic-head"><div class="ic-avatar">${esc(initials(s.full_name))}</div>` +
        `<div class="ic-title"><div class="nm">${esc(s.full_name)} ${tag}</div><div class="sb">${esc(s.subject || "—")} · ${lessonTypeLabel(s.lesson_type)} · ${esc((teachersById[s.teacher_id] && teachersById[s.teacher_id].full_name) || "Chưa gắn GV")}</div></div>` +
        `<span class="status-pill ${s.status}">${statusLabel(s.status)}</span></div>` +
        `<div class="ic-rows">` +
          row("Khóa đang học", `Khóa ${p.seq}${p.courseCount > 1 ? ` / ${p.courseCount} khóa` : ""}`) +
          row("Buổi đã học", `${p.used}/${p.total} buổi`) +
          row("Còn lại", `${p.remaining} buổi`) +
          (p.extra ? row("Buổi lẻ (ngoài khóa)", `<span style="color:var(--bad)">${p.extra} buổi</span>`) : "") +
          row("Học phí/buổi", money(p.fee)) +
          row("Đã đóng", money(paid.amount) + (paid.sessions ? ` · ${paid.sessions} buổi` : "")) +
          (owed > 0 ? row("Còn thiếu", `<span style="color:var(--bad)">${money(owed)}</span>`) : row("Học phí", '<span style="color:var(--good)">Đã đóng đủ</span>')) +
        `</div>` +
        `<div class="progress ${pcls}"><span style="width:${Math.round(p.ratio * 100)}%"></span></div>` +
        (p.done ? `<button class="btn primary course-cta" data-stnewcourse="${s.id}">＋ Mở khóa mới${p.extra ? ` (chuyển ${p.extra} buổi lẻ sang)` : ""}</button>` : "") +
        `<div class="ic-acts"><button class="btn btn-sm" data-stcourse="${s.id}">📚 Khóa học</button>` +
        `<button class="btn btn-sm" data-stpdf="${s.id}">🖨 Lịch học</button>` +
        `<button class="btn btn-sm" data-stpay="${s.id}">💳 Học phí</button>` +
        `<button class="btn btn-sm" data-stedit="${s.id}">${ICON_EDIT} Sửa</button>` +
        `<button class="btn btn-sm danger" data-stdel="${s.id}">${ICON_DEL} Xóa</button></div>` +
      `</div>`;
    }).join("");
  }
  function row(k, v) { return `<div class="ic-row"><span class="k">${k}</span><span class="v">${v}</span></div>`; }
  function statusLabel(s) { return s === "completed" ? "Đã kết thúc" : s === "paused" ? "Tạm nghỉ" : "Đang học"; }

  function openStudentModal(st) {
    const isEdit = !!st;
    $("smTitle").textContent = isEdit ? "Sửa học sinh" : "Thêm học sinh";
    $("smErr").classList.add("hidden");
    $("studentForm").reset();
    $("smId").value = isEdit ? st.id : "";
    const sel = $("smTeacher");
    sel.innerHTML = '<option value="">— Chưa gắn —</option>' +
      teachers.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi")).map((t) => `<option value="${t.id}">${esc(t.full_name)}</option>`).join("");
    fillLessonTypeSelect($("smLessonType"), isEdit ? st.lesson_type : "ca_nhan");
    fillSubjectSelect($("smSubject"), isEdit ? st.subject : "");
    if (isEdit) {
      $("smName").value = st.full_name || ""; $("smPhone").value = st.phone || ""; $("smGuardian").value = st.guardian || "";
      sel.value = st.teacher_id || "";
      $("smTotal").value = st.total_sessions || 12; $("smFee").value = st.tuition_per_session || 0;
      $("smStart").value = ymdToDmy(st.start_date); $("smStatus").value = st.status || "active"; $("smNote").value = st.note || "";
    } else {
      $("smTotal").value = 12; $("smFee").value = defaultTuition("ca_nhan") || 0; $("smStatus").value = "active"; $("smStart").value = dmy(startOfToday());
    }
    $("studentModal").classList.remove("hidden");
    $("smName").focus();
  }
  function closeStudentModal() { $("studentModal").classList.add("hidden"); }

  async function saveStudent() {
    const id = $("smId").value;
    const name = $("smName").value.trim();
    if (!name) { const e = $("smErr"); e.textContent = "Nhập họ tên học sinh."; e.classList.remove("hidden"); return; }
    const payload = {
      full_name: name, phone: $("smPhone").value.trim() || null, guardian: $("smGuardian").value.trim() || null,
      subject: $("smSubject").value.trim() || null, teacher_id: $("smTeacher").value || null,
      lesson_type: $("smLessonType").value || "ca_nhan",
      total_sessions: parseInt($("smTotal").value, 10) || 12, tuition_per_session: parseInt($("smFee").value, 10) || 0,
      start_date: dmyToYmd($("smStart").value), status: $("smStatus").value || "active", note: $("smNote").value.trim() || null,
    };
    $("smSave").disabled = true;
    try {
      const { error } = id ? await B.updateStudent(id, payload) : await B.addStudent(payload);
      if (error) throw error;
      // HS đã có nhiều khóa: số buổi / học phí / ngày bắt đầu trong form = của KHÓA MỚI NHẤT
      const cl = id && coursesByStudent[id];
      if (cl && cl.length) {
        const r = await B.updateCourse(cl[cl.length - 1].id, { total_sessions: payload.total_sessions, tuition_per_session: payload.tuition_per_session, start_date: payload.start_date, lesson_type: payload.lesson_type });
        if (r && r.error) throw r.error;
      }
      closeStudentModal();
      toast(id ? "Đã cập nhật học sinh." : "Đã thêm học sinh.", "ok");
      await loadGlobals();
      renderStudents();
    } catch (err) { const e = $("smErr"); e.textContent = "Lưu thất bại: " + (err.message || err); e.classList.remove("hidden"); }
    finally { $("smSave").disabled = false; }
  }
  async function deleteStudent(id) {
    const st = studentsById[id]; if (!st) return;
    if (!confirm(`Xóa học sinh "${st.full_name}"? Mọi điểm danh của em này cũng bị xóa.`)) return;
    const { error } = await B.deleteStudent(id);
    if (error) return toast("Xóa thất bại: " + error.message, "err");
    toast("Đã xóa học sinh.", "ok");
    await loadGlobals(); renderStudents();
  }

  // =====================================================================
  //  KHÓA HỌC (admin) — danh sách khóa + mở / sửa / xóa khóa
  // =====================================================================
  function fillRuleSelect(sel, val, withDefault) {
    sel.innerHTML = (withDefault ? `<option value="">Theo Cài đặt (${countRuleLabel(defaultCountRule()).toLowerCase()})</option>` : "") +
      COUNT_RULES.map((r) => `<option value="${r.key}">${r.label}</option>`).join("");
    sel.value = val || "";
  }
  function openCourseModal(studentId, editCourseIdx) {
    const st = studentsById[studentId]; if (!st) return;
    $("cmStudentId").value = studentId;
    $("cmTitle").textContent = st.full_name;
    renderCourseList(st);
    fillCourseForm(st, editCourseIdx);
    $("courseModal").classList.remove("hidden");
  }
  function closeCourseModal() { $("courseModal").classList.add("hidden"); }
  function renderCourseList(st) {
    const bd = courseInfo[st.id] || courseBreakdown(st, []);
    const span = (items) => {
      const ds = items.map((it) => it.a.schedule_date).filter(Boolean);
      return ds.length ? `${ymdToDmy(ds[0])} → ${ymdToDmy(ds[ds.length - 1])}` : "chưa có buổi";
    };
    const html = bd.courses.map((x, idx) => {
      const total = x.c.total_sessions || 0, done = total && x.used >= total, isCur = idx === bd.cur;
      const status = done ? '<span class="tag-done">Đã xong</span>' : isCur ? '<span class="status-pill active">Đang học</span>' : '<span class="tag-near">Chưa bắt đầu</span>';
      return `<div class="course-item${isCur ? " current" : ""}">` +
        `<div class="ci-main"><div class="ci-name">Khóa ${x.c.seq || idx + 1} — ${total} buổi ${status}</div>` +
        `<div class="course-facts"><div><span>Tiến độ</span><b>${x.used}/${total} buổi</b></div><div><span>Buổi học</span><b>${span(x.items)}</b></div>${x.c.start_date ? `<div><span>Bắt đầu khóa</span><b>${ymdToDmy(x.c.start_date)}</b></div>` : ''}` +
        `<div><span>Học phí mỗi buổi</span><b>${money(x.c.tuition_per_session)}</b></div><div><span>Cách tính buổi</span><b>${countRuleLabel(ruleOf(x.c))}</b></div>${x.c.note ? `<div><span>Ghi chú</span><b>${esc(x.c.note)}</b></div>` : ''}</div></div>` +
        `<div class="ci-acts"><button class="att-btn" data-cmedit="${idx}" title="Sửa khóa">${ICON_EDIT}</button>` +
        (x.c.id && bd.courses.length > 1 ? `<button class="att-btn no" data-cmdel="${x.c.id}" title="Xóa khóa">${ICON_DEL}</button>` : "") + `</div>` +
      `</div>`;
    }).join("") +
    (bd.extra.length ? `<div class="course-item extra"><div class="ci-main"><div class="ci-name">Buổi lẻ ngoài khóa · <span class="extra-txt">${bd.extraUsed} buổi</span></div>` +
      `<div class="ci-sub">${span(bd.extra)} — mở khóa mới bắt đầu từ ${ymdToDmy(bd.extra[0].a.schedule_date)} để chuyển các buổi này sang khóa mới (đánh số lại từ 1).</div></div></div>` : "");
    $("cmList").innerHTML = html;
  }
  // editIdx: số thứ tự khóa cần sửa; bỏ trống = form mở khóa mới
  function fillCourseForm(st, editIdx) {
    const bd = courseInfo[st.id] || courseBreakdown(st, []);
    $("cmErr").classList.add("hidden");
    const editing = editIdx != null ? bd.courses[editIdx] : null;
    const last = bd.courses[bd.courses.length - 1].c;
    const c = editing ? editing.c : null;
    $("cmId").value = editing ? String(editIdx) : "";
    $("cmFormTitle").textContent = editing ? `Sửa khóa ${c.seq || editIdx + 1}` : `Mở khóa mới (khóa ${bd.courses.length + 1})`;
    $("cmSave").textContent = editing ? "Lưu khóa" : "Mở khóa mới";
    setCmTotal(c ? c.total_sessions : (last.total_sessions || 12));
    setMoneyInput('cmFee', c ? (c.tuition_per_session || 0) : (last.tuition_per_session ?? defaultTuition(st.lesson_type) ?? 0));
    // khóa mới bắt đầu từ buổi lẻ đầu tiên (để chuyển buổi lẻ sang) hoặc hôm nay
    $("cmStart").value = c ? ymdToDmy(c.start_date) : (bd.extra.length ? ymdToDmy(bd.extra[0].a.schedule_date) : dmy(startOfToday()));
    fillRuleSelect($("cmRule"), c ? c.count_rule : "", true);
    $("cmNote").value = c ? (c.note || "") : "";
    const seq = c ? (c.seq || editIdx + 1) : ((last.seq || bd.courses.length) + 1);
    const saved = settings[tuitionAdjustmentKey(st.id, seq)];
    const validSaved = saved && Number(saved.net) === readMoneyInput('cmFee');
    $("cmFeeMode").value = validSaved ? saved.mode : 'custom';
    setMoneyInput('cmBaseFee', validSaved ? saved.base : (defaultTuition(st.lesson_type) || readMoneyInput('cmFee')));
    $("cmDiscount").value = validSaved ? saved.percent : 0;
    updateCourseFee();
  }
  function tuitionAdjustmentKey(studentId, seq) { return `tuition_adjustment_${studentId}_${seq}`; }
  function readMoneyInput(id) {
    const raw = $(id).value.replace(/\./g, '').trim();
    return /^\d+$/.test(raw) ? Number(raw) : NaN;
  }
  function setMoneyInput(id, amount) {
    const formatted = Number.isSafeInteger(Number(amount)) && Number(amount) >= 0 ? Number(amount).toLocaleString('vi-VN') : '';
    if ($(id).value !== formatted) $(id).value = formatted;
  }
  function formatMoneyTyping(input) {
    const leftDigits = input.value.slice(0, input.selectionStart || 0).replace(/\D/g, '').length;
    const digits = input.value.replace(/\D/g, '').slice(0, 12);
    input.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
    let caret = 0, seen = 0;
    while (caret < input.value.length && seen < leftDigits) { if (/\d/.test(input.value[caret])) seen++; caret++; }
    input.setSelectionRange(caret, caret);
  }
  function calculateTuition(base, percent) {
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Giá phải từ 0 đ; giảm giá từ 0 đến 100%.');
    return Math.round(base * (100 - percent) / 100);
  }
  function courseFeeQuote() {
    const mode = $("cmFeeMode").value;
    const st = studentsById[$("cmStudentId").value];
    const base = mode === 'default' ? defaultTuition(st && st.lesson_type) : readMoneyInput('cmBaseFee');
    const percent = mode === 'percent' ? Number($("cmDiscount").value || NaN) : 0;
    const net = mode === 'custom' ? calculateTuition(readMoneyInput('cmFee'), 0) : calculateTuition(base, percent);
    return {mode,base:mode === 'custom' ? net : base,percent,net};
  }
  function updateCourseFee() {
    const mode = $("cmFeeMode").value;
    $("cmDiscountFields").hidden = mode !== 'percent';
    $("cmBaseFee").disabled = mode !== 'percent';
    $("cmDiscount").disabled = mode !== 'percent';
    $("cmFee").readOnly = mode !== 'custom';
    try {
      const q = courseFeeQuote(); setMoneyInput('cmFee', q.net);
      const count = Number($("cmTotal").value) || 0;
      $("cmFeePreview").textContent = `${money(q.net)}/buổi — ${money(q.net * count)} cho ${count} buổi` + (mode === 'percent' ? ` (giảm ${q.percent}%)` : '');
    } catch(e) { $("cmFeePreview").textContent = e.message; }
  }
  function setCmTotal(n) {
    $("cmTotal").value = n || 12;
    document.querySelectorAll("#cmTotalPick [data-total]").forEach((b) => b.classList.toggle("on", Number(b.getAttribute("data-total")) === Number($("cmTotal").value)));
  }
  // Ghi khóa "ảo" (lấy từ hồ sơ HS) thành khóa 1 trong DB trước khi thêm khóa thứ 2
  async function materializeFirstCourse(st) {
    // ngày bắt đầu khóa 1 = buổi học sớm nhất (hồ sơ cũ có thể ghi ngày muộn hơn buổi thật)
    const dates = (attRowsByStudent[st.id] || []).map((a) => a.schedule_date).filter(Boolean).sort();
    const start = [st.start_date, dates[0]].filter(Boolean).sort()[0] || null;
    const r = await B.addCourse({ student_id: st.id, seq: 1, total_sessions: st.total_sessions || 12, tuition_per_session: st.tuition_per_session || 0, lesson_type: st.lesson_type, start_date: start, count_rule: null });
    if (r.error) throw r.error;
    return r.data;
  }
  async function saveCourse() {
    const sid = $("cmStudentId").value, st = studentsById[sid]; if (!st) return;
    const err = (m) => { const e = $("cmErr"); e.textContent = m; e.classList.remove("hidden"); };
    const total = parseInt($("cmTotal").value, 10);
    if (!total || total < 1) return err("Nhập số buổi của khóa.");
    const startRaw = $("cmStart").value.trim(), start = startRaw ? dmyToYmd(startRaw) : null;
    if (startRaw && !start) return err("Ngày bắt đầu không hợp lệ (dd/mm/yyyy).");
    let adjustment;
    try { adjustment = courseFeeQuote(); } catch(e) { return err(e.message); }
    const data = { total_sessions: total, tuition_per_session: adjustment.net, start_date: start, count_rule: $("cmRule").value || null, note: $("cmNote").value.trim() || null };
    const bd = courseInfo[sid] || courseBreakdown(st, []);
    const editIdx = $("cmId").value === "" ? null : Number($("cmId").value);
    const list = (coursesByStudent[sid] || []).slice();
    const adjustmentSeq = editIdx != null ? (bd.courses[editIdx].c.seq || editIdx + 1) : ((bd.courses[bd.courses.length - 1].c.seq || bd.courses.length) + 1);
    $("cmSave").disabled = true;
    try {
      let isLatest;
      if (editIdx != null) {
        const c = bd.courses[editIdx].c;
        isLatest = editIdx === bd.courses.length - 1;
        if (c.id) { const r = await B.updateCourse(c.id, data); if (r.error) throw r.error; }
        else if (data.count_rule || data.note) {         // khóa "ảo" cần lưu thêm cách tính/ghi chú -> ghi thành khóa 1
          const made = await materializeFirstCourse(st);
          const r = await B.updateCourse(made.id, data); if (r.error) throw r.error;
        }
      } else {
        // khóa mới không được "nuốt" hết khóa đang học: phải bắt đầu sau buổi đầu tiên của khóa cuối
        const lastC = bd.courses[bd.courses.length - 1];
        const firstDate = lastC.items.length ? lastC.items[0].a.schedule_date : null;
        if (start && firstDate && start <= firstDate) throw new Error(`Ngày bắt đầu khóa mới phải sau buổi đầu tiên của khóa ${lastC.c.seq || bd.courses.length} (${ymdToDmy(firstDate)}).`);
        if (!list.length) list.push(await materializeFirstCourse(st));
        const prev = list[list.length - 1];
        const r = await B.addCourse(Object.assign({ student_id: sid, seq: (prev.seq || list.length) + 1, lesson_type: st.lesson_type }, data));
        if (r.error) throw r.error;
        isLatest = true;
      }
      // hồ sơ HS luôn phản ánh khóa mới nhất (học phí, số buổi... dùng ở các màn khác)
      if (isLatest) {
        const r = await B.updateStudent(sid, { total_sessions: data.total_sessions, tuition_per_session: data.tuition_per_session, start_date: data.start_date || st.start_date || null, status: editIdx == null ? "active" : st.status });
        if (r.error) throw r.error;
      }
      const savedAdjustment = await B.saveSetting(tuitionAdjustmentKey(sid, adjustmentSeq), adjustment);
      if (savedAdjustment.error) toast("Đã lưu học phí áp dụng, nhưng chưa lưu được cách giảm giá: " + savedAdjustment.error.message, "err");
      else toast(editIdx != null ? "Đã lưu khóa và học phí riêng." : "Đã mở khóa mới — buổi được đánh số lại từ 1.", "ok");
      await loadGlobals();
      renderCourseList(studentsById[sid]); fillCourseForm(studentsById[sid]);
      if (currentView === "students") renderStudents();
    } catch (e) {
      err("Lưu thất bại: " + (e.message || e) + (/courses/.test(e.message || "") ? " — cần chạy supabase-migration-6.sql trên Supabase." : ""));
    } finally { $("cmSave").disabled = false; }
  }
  async function deleteCourse(courseId) {
    const sid = $("cmStudentId").value, st = studentsById[sid];
    const list = coursesByStudent[sid] || [];
    const c = list.find((x) => x.id === courseId); if (!c) return;
    if (!confirm(`Xóa khóa ${c.seq}? Buổi học KHÔNG bị xóa — chỉ được chia lại vào các khóa còn lại.`)) return;
    const { error } = await B.deleteCourse(courseId);
    if (error) return toast("Xóa thất bại: " + error.message, "err");
    const rest = list.filter((x) => x.id !== courseId);
    // đánh số lại khóa 1, 2, 3… cho liền mạch
    await Promise.all(rest.map((x, i) => x.seq !== i + 1 ? B.updateCourse(x.id, { seq: i + 1 }) : null));
    if (rest.length && c === list[list.length - 1]) {   // xóa khóa mới nhất -> hồ sơ HS lấy lại khóa trước
      const p = rest[rest.length - 1];
      await B.updateStudent(sid, { total_sessions: p.total_sessions, tuition_per_session: p.tuition_per_session, start_date: p.start_date || st.start_date || null });
    }
    toast("Đã xóa khóa.", "ok");
    await loadGlobals();
    renderCourseList(studentsById[sid]); fillCourseForm(studentsById[sid]);
    if (currentView === "students") renderStudents();
  }

  // =====================================================================
  //  HỌC PHÍ — ĐÓNG TIỀN (admin)
  // =====================================================================
  async function reloadPayments() {
    const r = await B.listPayments();
    allPayments = r.data || [];
    paidByStudent = {};
    allPayments.forEach((p) => { const m = paidByStudent[p.student_id] || (paidByStudent[p.student_id] = { amount: 0, sessions: 0 }); m.amount += Number(p.amount) || 0; m.sessions += Number(p.sessions) || 0; });
  }
  function openPaymentModal(studentId) {
    const st = studentsById[studentId]; if (!st) return;
    $("payStudentId").value = studentId;
    $("payTitle").textContent = st.full_name;
    $("payErr").classList.add("hidden");
    const now = new Date();
    $("payDate").value = dmy(now);
    $("payTime").value = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    $("payAmount").value = (st.tuition_per_session || 0) * (st.total_sessions || 0);
    $("paySessions").value = st.total_sessions || 0;
    $("payNote").value = "";
    renderPaymentSummary(st);
    renderPaymentHistory(studentId);
    $("paymentModal").classList.remove("hidden");
  }
  function closePaymentModal() { $("paymentModal").classList.add("hidden"); }
  function renderPaymentSummary(st) {
    const paid = paidByStudent[st.id] || { amount: 0, sessions: 0 };
    const p = studentProgress(st);
    const billed = billedTuition(st);
    const owed = Math.max(0, billed - paid.amount);
    $("paySummary").innerHTML =
      chip(money(p.fee), "Học phí mỗi buổi", "") +
      chip(money(billed), p.courseCount > 1 || p.extra ? `Tổng ${p.courseCount} khóa${p.extra ? " + lẻ" : ""}` : "Cả khóa", "primary") +
      chip(money(paid.amount), "Đã đóng", "good") +
      chip(money(owed), "Còn thiếu", owed > 0 ? "bad" : "good");
  }
  function renderPaymentHistory(studentId) {
    const list = allPayments.filter((p) => p.student_id === studentId).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)));
    if (!list.length) { $("payHistory").innerHTML = '<div class="empty" style="padding:18px;">Chưa có lần đóng nào.</div>'; return; }
    $("payHistory").innerHTML = list.map((p) => {
      const d = new Date(p.paid_at);
      const dt = isNaN(d.getTime()) ? "" : `${dmy(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      return `<div class="pay-item"><div class="pi-main"><div class="pi-amt">${money(p.amount)}</div>` +
        `<div class="pi-sub">${dt}${p.sessions ? " · " + p.sessions + " buổi" : ""}${p.note ? " · " + esc(p.note) : ""}</div></div>` +
        `<button class="att-btn no" data-paydel="${p.id}" title="Xóa">🗑</button></div>`;
    }).join("");
  }
  async function addPaymentRecord() {
    const sid = $("payStudentId").value;
    const ymd2 = dmyToYmd($("payDate").value), tm = normTime($("payTime").value) || "00:00";
    if (!ymd2) { const e = $("payErr"); e.textContent = "Ngày đóng không hợp lệ (dd/mm/yyyy)."; e.classList.remove("hidden"); return; }
    const [y, mo, da] = ymd2.split("-").map(Number), [hh, mi] = tm.split(":").map(Number);
    const payload = { student_id: sid, paid_at: new Date(y, mo - 1, da, hh, mi).toISOString(), amount: parseInt($("payAmount").value, 10) || 0, sessions: parseInt($("paySessions").value, 10) || 0, note: $("payNote").value.trim() || null, created_by: user.id };
    $("payAdd").disabled = true;
    const { error } = await B.addPayment(payload);
    $("payAdd").disabled = false;
    if (error) { const e = $("payErr"); e.textContent = "Lưu thất bại: " + error.message; e.classList.remove("hidden"); return; }
    await reloadPayments();
    renderPaymentSummary(studentsById[sid]); renderPaymentHistory(sid);
    if (currentView === "students") renderStudents();
    toast("Đã ghi nhận đóng học phí.", "ok");
    $("payNote").value = "";
  }
  async function deletePaymentRecord(id) {
    if (!confirm("Xóa lần đóng học phí này?")) return;
    const { error } = await B.deletePayment(id);
    if (error) return toast("Xóa thất bại: " + error.message, "err");
    const sid = $("payStudentId").value;
    await reloadPayments();
    renderPaymentSummary(studentsById[sid]); renderPaymentHistory(sid);
    if (currentView === "students") renderStudents();
    toast("Đã xóa.", "ok");
  }

  // Xuất PDF lịch sử đi học của 1 học sinh (cho phụ huynh xem)
  async function exportStudentAttendancePDF(studentId) {
    const st = studentsById[studentId]; if (!st) return toast("Không tìm thấy học sinh.", "err");
    const { data: atts, error } = await B.listAttendanceByStudent(studentId);
    if (error) return toast("Lỗi tải dữ liệu: " + error.message, "err");
    const ids = (atts || []).map((a) => a.schedule_id);
    const { data: scheds } = await B.listSchedulesByIds(ids);
    const schById = {}; (scheds || []).forEach((s) => (schById[s.id] = s));
    const todayY = ymd(startOfToday());
    // chia buổi vào từng khóa (tính trên mọi buổi kể cả tương lai để khớp màn hình), rồi chỉ in buổi đến hôm nay
    const all = (atts || []).filter((a) => schById[a.schedule_id]).map((a) => {
      const s = schById[a.schedule_id];
      return { schedule_id: a.schedule_id, present: a.present, excused: !!a.excused, note: a.note, schedule_date: s.schedule_date, start_time: s.start_time, s };
    });
    const bd = courseBreakdown(st, all);
    const past = (items) => items.filter((it) => it.a.schedule_date <= todayY);
    let present = 0, absent = 0, none = 0;
    all.filter((a) => a.schedule_date <= todayY).forEach((a) => { if (a.present === true) present++; else if (a.present === false) absent++; else none++; });
    const rowHtml = (it) => {
      const s = it.a.s, d = parseYmd(s.schedule_date);
      const status = it.a.present === true ? "✓ Có mặt" : it.a.present === false ? (it.a.excused ? "✕ Vắng (có phép)" : "✕ Vắng") : "• Chưa điểm danh";
      const noteCell = it.a.note ? esc(it.a.note) : (it.a.present === false ? "—" : "");
      return `<tr><td class='num'>${it.no || "–"}</td><td>${dmy(d)}</td><td>${DOW[d.getDay()]}</td><td>${hhmm(s.start_time)}–${hhmm(s.end_time)}</td><td>${esc(s.subject)}</td><td>${lessonTypeLabel(s.lesson_type)}</td><td>${esc(teacherDisplay(s))}</td><td>${status}</td><td>${noteCell}</td></tr>`;
    };
    let detailRows = "";
    bd.courses.forEach((x, idx) => {
      const items = past(x.items);
      if (!items.length && idx !== bd.cur) return;
      const total = x.c.total_sessions || 0, done = total && x.used >= total;
      detailRows += `<tr class='grp'><td colspan='9'>KHÓA ${x.c.seq || idx + 1} · ${total} buổi · đã học ${x.used}/${total}${done ? " · ĐÃ HOÀN THÀNH" : idx === bd.cur ? " · ĐANG HỌC" : ""}${x.c.start_date ? " · bắt đầu " + ymdToDmy(x.c.start_date) : ""}</td></tr>` +
        (items.length ? items.map(rowHtml).join("") : "<tr><td colspan='9' style='text-align:center;color:#888'>Chưa có buổi nào.</td></tr>");
    });
    const extraPast = past(bd.extra);
    if (extraPast.length) detailRows += `<tr class='grp extra'><td colspan='9'>BUỔI LẺ (ngoài khóa) · ${bd.extraUsed} buổi</td></tr>` + extraPast.map(rowHtml).join("");
    const paid = paidByStudent[studentId] || { amount: 0, sessions: 0 };
    const curC = bd.courses[bd.cur], total = curC.c.total_sessions || 0, remaining = Math.max(0, total - curC.used);
    const now = new Date();
    const logoUrl = new URL("logo-wordmark.png", location.href).href;
    const teacherName = (teachersById[st.teacher_id] && teachersById[st.teacher_id].full_name) || "—";

    const css = "*{box-sizing:border-box;}html,body{background:#fff;}body{font-family:'Segoe UI',-apple-system,Roboto,Arial,sans-serif;color:#111;margin:0;padding:22px;font-size:12.5px;}" +
      ".doc-head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:12px;}" +
      ".doc-logo-img{height:52px;width:auto;display:block;border-radius:6px;}" +
      ".center-name{font-size:15px;font-weight:800;letter-spacing:.3px;}.center-sub{font-size:11px;color:#666;}" +
      "h1.report-title{text-align:center;font-size:18px;margin:14px 0 2px;text-transform:uppercase;}" +
      ".report-gen{text-align:center;font-size:10.5px;color:#888;margin-bottom:14px;}" +
      ".info{margin:8px 0 10px;font-size:13px;line-height:1.8;}.info .lbl{color:#666;display:inline-block;min-width:160px;}" +
      ".sumline{margin:6px 0 12px;padding:10px 12px;background:#eef0fb;border:1px solid #c9c9e6;border-radius:8px;font-size:13px;font-weight:700;}" +
      "table{width:100%;border-collapse:collapse;margin-bottom:6px;}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;}" +
      "th{background:#eef0fb;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;}td.num,th.num{text-align:right;white-space:nowrap;}" +
      "tr.grp td{background:#e3f1ec;color:#0b5a50;font-weight:800;font-size:11.5px;letter-spacing:.3px;}tr.grp.extra td{background:#fbe9ea;color:#a5303a;}" +
      ".sign-row{display:flex;justify-content:flex-end;margin-top:30px;text-align:center;font-size:12px;}.sign-row .col{width:46%;}" +
      ".sign-row .role{font-weight:700;}.sign-row .hint{font-size:10px;color:#888;font-style:italic;}.sign-row .space{height:56px;}" +
      "@page{size:A4;margin:14mm;}";
    const html = "<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Lịch học - " + esc(st.full_name) + "</title><style>" + css + "</style></head><body>" +
      "<div class='doc-head'><img class='doc-logo-img' src='" + logoUrl + "' alt='OpenMusic'><div><div class='center-name'>TRUNG TÂM NGHỆ THUẬT OPENMUSIC</div><div class='center-sub'>Bảng theo dõi buổi học của học sinh</div></div></div>" +
      "<h1 class='report-title'>Bảng theo dõi buổi học</h1>" +
      "<div class='report-gen'>Lập lúc " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") + " ngày " + dmy(now) + "</div>" +
      "<div class='info'><div><span class='lbl'>Họ và tên học sinh:</span> <b>" + esc(st.full_name) + "</b></div>" +
      "<div><span class='lbl'>Môn / Loại lớp:</span> " + esc(st.subject || "—") + " · " + lessonTypeLabel(st.lesson_type) + "</div>" +
      "<div><span class='lbl'>Giáo viên phụ trách:</span> " + esc(teacherName) + "</div>" +
      "<div><span class='lbl'>Khóa đang học:</span> Khóa " + (curC.c.seq || bd.cur + 1) + " · " + total + " buổi" + (curC.c.start_date ? " · bắt đầu " + ymdToDmy(curC.c.start_date) : "") + (bd.courses.length > 1 ? " · đã học " + bd.courses.length + " khóa" : "") + "</div>" +
      "<div><span class='lbl'>Học phí đã đóng:</span> " + money(paid.amount) + (paid.sessions ? " · " + paid.sessions + " buổi" : "") + "</div></div>" +
      "<div class='sumline'>Khóa " + (curC.c.seq || bd.cur + 1) + ": đã học " + curC.used + "/" + total + " · còn lại " + remaining + " buổi" + (bd.extraUsed ? " · Buổi lẻ ngoài khóa: " + bd.extraUsed : "") +
      " &nbsp;|&nbsp; Toàn bộ: có mặt " + present + " · vắng " + absent + " · chưa điểm danh " + none + "</div>" +
      "<table><thead><tr><th class='num'>Buổi</th><th>Ngày</th><th>Thứ</th><th>Giờ</th><th>Môn</th><th>Loại lớp</th><th>Giáo viên</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>" +
      "<tbody>" + (detailRows || "<tr><td colspan='9' style='text-align:center;color:#888'>Chưa có buổi học nào.</td></tr>") + "</tbody></table>" +
      "<div class='sign-row'><div class='col'><div class='role'>XÁC NHẬN CỦA TRUNG TÂM</div><div class='hint'>(Ký, ghi rõ họ tên)</div><div class='space'></div></div></div>" +
      "<scr" + "ipt>window.onload=function(){var g=document.images,n=g.length,d=0;function go(){if(++d>=n)setTimeout(function(){window.print();},250);}if(!n){setTimeout(function(){window.print();},250);return;}for(var i=0;i<n;i++){var m=g[i];if(m.complete)go();else{m.onload=go;m.onerror=go;}}};</scr" + "ipt>" +
      "</body></html>";

    const w = window.open("", "_blank");
    if (!w) { toast("Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi thử lại.", "err"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // =====================================================================
  //  LÃI / LỖ TRUNG TÂM (admin)
  // =====================================================================
  function ensureProfitDates() { if (!$("proFrom").value || !$("proTo").value) { setProfitMonth(); runProfit(); } }
  function setProfitMonth() {
    const now = startOfToday();
    $("proFrom").value = dmy(new Date(now.getFullYear(), now.getMonth(), 1));
    $("proTo").value = dmy(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    updateReportMonthLabel('pro');
  }
  function paymentDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date);
    const field = type => parts.find(p => p.type === type).value;
    return `${field('year')}-${field('month')}-${field('day')}`;
  }
  async function runProfit() {
    const request = ++profitRequest;
    try {
    updateReportMonthLabel('pro');
    const from = dmyToYmd($("proFrom").value), to = dmyToYmd($("proTo").value);
    if (!from || !to) return toast("Nhập khoảng ngày hợp lệ.", "err");
    if (from > to) return toast("Ngày bắt đầu phải trước ngày kết thúc.", "err");
    $("profitResult").innerHTML = '<div class="state">Đang tính…</div>';
    const [{data: payments, error: payError}, {data: scheds, error: scheduleError}] = await Promise.all([B.listPayments(), B.listSchedules({ from, to, teacherId: null })]);
    if (request !== profitRequest) return;
    if (payError || scheduleError) throw payError || scheduleError;
    const income = (payments || []).filter(p => { const d = paymentDateKey(p.paid_at); return d >= from && d <= to; }).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const taught = (scheds || []).filter((s) => s.teacher_present === true);
    const rowsBy = {};
    const { data: pAtts, error: attError } = await B.listAttendanceBySchedules(taught.map((s) => s.id));
    if (request !== profitRequest) return;
    if (attError) throw attError;
    (pAtts || []).forEach((a) => { (rowsBy[a.schedule_id] || (rowsBy[a.schedule_id] = [])).push(a); });
    let salary = 0;
    taught.forEach((s) => { const g = attendanceAgg(rowsBy[s.id]); salary += teacherPayForSession(teachersById[s.teacher_id], s.lesson_type || "ca_nhan", g.attending, g.absent); });
    const profit = income - salary;
    $("profitResult").innerHTML = `<section class="profit-summary" aria-label="Kết quả thu và lương"><div class="profit-period">${dmy(parseYmd(from))} — ${dmy(parseYmd(to))}</div><div class="profit-net ${profit < 0 ? 'negative' : ''}"><span>${profit >= 0 ? 'Chênh lệch thu và lương' : 'Chi lương vượt thu'}</span><strong>${money(Math.abs(profit))}</strong><small>${profit >= 0 ? 'Lãi trong kỳ' : 'Lỗ trong kỳ'}</small></div><dl class="profit-breakdown"><div><dt>Học phí đã thu</dt><dd>${money(income)}</dd></div><div><dt>Lương giáo viên</dt><dd>${money(salary)}</dd></div></dl></section>`;
      } catch (error) {
      if (request === profitRequest) $("profitResult").innerHTML = `<div class="empty">Không thể tính lãi: ${esc(error.message || error)}</div>`;
    }
  }
  function profitCard(label, value, cls, icon) {
    return `<div class="profit-card ${cls}"><div class="pc-ic">${icon}</div><div class="pc-label">${label}</div><div class="pc-value">${value}</div></div>`;
  }

  // =====================================================================
  //  GIÁO VIÊN (admin)
  // =====================================================================
  function renderTeachers() {
    if (!teachers.length) { $("teacherList").innerHTML = '<div class="empty"><div class="big">👨‍🏫</div>Chưa có giáo viên nào.</div>'; return; }
    const linkedName = (uid) => { const p = profilesById[uid]; return p ? (p.email || p.full_name) : "—"; };
    const query = norm($("teacherSearch").value);
    const filtered = teachers.filter(t => norm([t.full_name, t.specialty, t.phone, linkedName(t.user_id)].filter(Boolean).join(' ')).includes(query));
    if (!filtered.length) { $("teacherList").innerHTML = '<div class="empty">Không tìm thấy giáo viên phù hợp.</div>'; return; }
    $("teacherList").innerHTML = filtered.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi")).map((t) => {
      const st = teacherStatsById[t.id] || { taught: 0, off: 0 };
      const statusCls = t.status === "inactive" ? "paused" : "active";
      const badge = `<span class="status-pill ${statusCls}">${teacherStatusLabel(t.status)}</span>`;
      const payCompact = LESSON_TYPES.map((lt) => moneyShort(teacherPayFor(t, lt.key))).join(" / ");
      return `<div class="info-card${t.status === "inactive" ? " is-inactive" : ""}">` +
        `<div class="ic-head"><div class="ic-avatar">${esc(initials(t.full_name))}</div>` +
        `<div class="ic-title"><div class="nm">${esc(t.full_name)}</div><div class="sb">${esc(t.specialty || "Giáo viên")}</div></div>${badge}</div>` +
        `<div class="ic-rows">` +
          (t.hometown ? row("Quê quán", esc(t.hometown)) : "") +
          (t.hire_date ? row("Ngày vào làm", ymdToDmy(t.hire_date)) : "") +
          row("Đã dạy / nghỉ", `${st.taught} / ${st.off} buổi`) +
          row("Lương CN/Đôi/Nhóm/GS", payCompact) +
          row("Tài khoản", t.user_id ? esc(linkedName(t.user_id)) : '<span style="color:var(--muted-2)">chưa gắn</span>') +
          (t.phone ? row("Điện thoại", esc(t.phone)) : "") +
          (t.email ? row("Email", esc(t.email)) : "") +
        `</div>` +
        `<div class="ic-acts"><button class="btn btn-sm" data-tcedit="${t.id}">${ICON_EDIT} Sửa</button>` +
        `<button class="btn btn-sm danger" data-tcdel="${t.id}">${ICON_DEL} Xóa</button></div>` +
      `</div>`;
    }).join("");
  }

  function openTeacherModal(t) {
    const isEdit = !!t;
    $("tmTitle").textContent = isEdit ? "Sửa giáo viên" : "Thêm giáo viên";
    $("tmErr").classList.add("hidden");
    $("teacherForm").reset();
    $("tmId").value = isEdit ? t.id : "";
    // tài khoản: loại các tài khoản đã gắn cho GV khác
    const usedBy = {}; teachers.forEach((x) => { if (x.user_id) usedBy[x.user_id] = x.id; });
    const acc = $("tmAcc");
    acc.innerHTML = '<option value="">— chưa gắn —</option>' +
      profilesList.slice().sort((a, b) => (a.email || "").localeCompare(b.email || "")).filter((p) => !usedBy[p.id] || (isEdit && usedBy[p.id] === t.id))
        .map((p) => `<option value="${p.id}">${esc((p.email || p.full_name || "?") + (p.role === "admin" ? " (admin)" : ""))}</option>`).join("");
    if (isEdit) {
      $("tmName").value = t.full_name || ""; $("tmPhone").value = t.phone || ""; $("tmEmail").value = t.email || "";
      $("tmGender").value = t.gender || ""; $("tmDob").value = ymdToDmy(t.dob);
      $("tmHometown").value = t.hometown || ""; $("tmNationalId").value = t.national_id || "";
      $("tmAddress").value = t.address || ""; $("tmSpecialty").value = t.specialty || "";
      $("tmHire").value = ymdToDmy(t.hire_date); $("tmStatus").value = t.status || "active";
      const r = Object.assign({}, t.pay_rates || {});
      if (r.ca_nhan == null) r.ca_nhan = t.pay_per_session || 0;
      renderPayRateInputs($("tmPayRates"), r);
      acc.value = t.user_id || ""; $("tmNote").value = t.note || "";
    } else {
      renderPayRateInputs($("tmPayRates"), settings.default_pay || {});
      $("tmStatus").value = "active"; $("tmHire").value = dmy(startOfToday());
    }
    $("teacherModal").classList.remove("hidden");
    $("tmName").focus();
  }
  function closeTeacherModal() { $("teacherModal").classList.add("hidden"); }

  async function saveTeacher() {
    const id = $("tmId").value;
    const name = $("tmName").value.trim();
    if (!name) { const e = $("tmErr"); e.textContent = "Nhập tên giáo viên."; e.classList.remove("hidden"); return; }
    const pr = readRateInputs($("tmPayRates"), "data-ptype");
    const payload = {
      full_name: name, phone: $("tmPhone").value.trim() || null, email: $("tmEmail").value.trim() || null,
      gender: $("tmGender").value || null, dob: dmyToYmd($("tmDob").value),
      hometown: $("tmHometown").value.trim() || null, national_id: $("tmNationalId").value.trim() || null,
      address: $("tmAddress").value.trim() || null, specialty: $("tmSpecialty").value.trim() || null,
      hire_date: dmyToYmd($("tmHire").value), status: $("tmStatus").value || "active",
      pay_rates: pr, pay_per_session: pr.ca_nhan || 0,
      user_id: $("tmAcc").value || null, note: $("tmNote").value.trim() || null,
    };
    $("tmSave").disabled = true;
    try {
      const { error } = id ? await B.updateTeacher(id, payload) : await B.addTeacher(payload);
      if (error) throw error;
      closeTeacherModal();
      toast(id ? "Đã cập nhật giáo viên." : "Đã thêm giáo viên.", "ok");
      await loadGlobals(); renderTeachers();
    } catch (err) { const e = $("tmErr"); e.textContent = "Lưu thất bại: " + (err.message || err); e.classList.remove("hidden"); }
    finally { $("tmSave").disabled = false; }
  }
  async function deleteTeacher(id) {
    const t = teachersById[id]; if (!t) return;
    if (!confirm(`Xóa giáo viên "${t.full_name}"? TẤT CẢ buổi học của giáo viên này cũng bị xóa.`)) return;
    const { error } = await B.deleteTeacher(id);
    if (error) return toast("Xóa thất bại: " + error.message, "err");
    toast("Đã xóa giáo viên.", "ok");
    await loadGlobals(); renderTeachers();
  }

  // =====================================================================
  //  TÍNH LƯƠNG (admin)
  // =====================================================================
  function ensureSalaryDates() {
    if (!$("salFrom").value || !$("salTo").value) setSalaryMonth();
  }
  function setSalaryMonth() {
    const now = startOfToday();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    $("salFrom").value = dmy(first); $("salTo").value = dmy(last);
    updateReportMonthLabel('sal');
  }
  function updateReportMonthLabel(prefix) {
    const key = dmyToYmd($(prefix + 'From').value);
    const d = key ? parseYmd(key) : startOfToday(), now = startOfToday();
    $(prefix + 'MonthBtn').textContent = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() ? 'Tháng này' : `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
  }
  function shiftReportMonth(prefix, delta) {
    const key = dmyToYmd($(prefix + 'From').value), current = key ? parseYmd(key) : startOfToday();
    const first = new Date(current.getFullYear(), current.getMonth() + delta, 1);
    $(prefix + 'From').value = dmy(first);
    $(prefix + 'To').value = dmy(new Date(first.getFullYear(), first.getMonth() + 1, 0));
    updateReportMonthLabel(prefix);
    if (prefix === 'sal') runSalary(); else runProfit();
  }
  async function runSalary() {
    const request = ++salaryRequest;
    updateReportMonthLabel('sal');
    const from = dmyToYmd($("salFrom").value), to = dmyToYmd($("salTo").value);
    if (!from || !to) return toast("Nhập khoảng ngày hợp lệ (dd/mm/yyyy).", "err");
    if (from > to) return toast("Ngày bắt đầu phải trước ngày kết thúc.", "err");
    $("salaryResult").innerHTML = '<div class="state">Đang tính…</div>';
    const { data, error } = await B.listSchedules({ from, to, teacherId: null });
    if (error) { $("salaryResult").innerHTML = '<div class="empty">Lỗi tải dữ liệu.</div>'; return; }
    if (request !== salaryRequest) return;
    // Sĩ số thực học từng buổi (để hạ bậc lương khi HS nghỉ)
    const taughtIds = (data || []).filter((s) => s.teacher_present === true).map((s) => s.id);
    const rowsBy = {};
    const { data: sAtts, error: attError } = await B.listAttendanceBySchedules(taughtIds);
    if (request !== salaryRequest) return;
    if (attError) { $("salaryResult").innerHTML = `<div class="empty">Không thể tính lương: ${esc(attError.message)}</div>`; return; }
    (sAtts || []).forEach((a) => { (rowsBy[a.schedule_id] || (rowsBy[a.schedule_id] = [])).push(a); });
    const rows = {};
    teachers.forEach((t) => (rows[t.id] = { t: t, name: t.full_name, counts: {}, off: 0, planned: 0 }));
    (data || []).forEach((s) => {
      const r = rows[s.teacher_id]; if (!r) return;
      r.planned++;
      if (s.teacher_present === true) { const g = attendanceAgg(rowsBy[s.id]); const k = effectiveLessonType(s.lesson_type || "ca_nhan", g.attending, g.absent); r.counts[k] = (r.counts[k] || 0) + 1; }
      else if (s.teacher_present === false) r.off++;
    });
    const list = Object.values(rows).sort((a, b) => a.name.localeCompare(b.name, "vi"));
    let grand = 0, salaryCards = "";
    const body = list.map((r) => {
      let taught = 0, amount = 0;
      const cells = LESSON_TYPES.map((lt) => { const c = r.counts[lt.key] || 0; taught += c; amount += c * teacherPayFor(r.t, lt.key); return `<td class="num">${c}</td>`; }).join("");
      grand += amount;
      const pdfBtn = taught ? `<button class="btn btn-sm" data-salpdf="${r.t.id}">🖨 PDF</button>` : "";
      salaryCards += `<article class="salary-card"><header><h3>${esc(r.name)}</h3><strong>${money(amount)}</strong></header><dl class="salary-types">` +
        LESSON_TYPES.map(lt => `<div><dt>${lt.label}</dt><dd>${r.counts[lt.key] || 0}</dd></div>`).join('') +
        `</dl><footer><div><span>Đã dạy <b>${taught} buổi</b></span><span>Nghỉ <b>${r.off} buổi</b></span></div>${pdfBtn}</footer></article>`;
      return `<tr><td>${esc(r.name)}</td>${cells}<td class="num">${taught}</td><td class="num">${r.off}</td><td class="num money total">${money(amount)}</td><td class="num">${pdfBtn}</td></tr>`;
    }).join("");
    const typeHeaders = LESSON_TYPES.map((lt) => `<th class="num">${lt.label}</th>`).join("");
    const nCols = LESSON_TYPES.length;
    $("salaryResult").innerHTML =
      `<div class="salary-overview"><span>Tổng chi lương</span><strong>${money(grand)}</strong><small>${list.length} giáo viên</small></div>` +
      `<details class="salary-all" ${window.matchMedia('(min-width: 901px)').matches ? 'open' : ''}><summary>Xem tất cả <span>Bảng tổng quan</span></summary><div class="table-wrap salary-table"><table class="tbl"><thead><tr>` +
      `<th>Giáo viên</th>${typeHeaders}<th class="num">Tổng dạy</th><th class="num">Nghỉ</th><th class="num">Thành tiền</th><th class="num">Phiếu lương</th>` +
      `</tr></thead><tbody>${body || `<tr><td colspan="${nCols + 5}" style="text-align:center;color:var(--muted)">Không có dữ liệu.</td></tr>`}</tbody>` +
      `<tfoot><tr><td colspan="${nCols + 3}">TỔNG CHI LƯƠNG</td><td class="num money total">${money(grand)}</td><td></td></tr></tfoot></table></div></details>` +
      `<div class="salary-cards">${salaryCards || '<div class="empty">Không có giáo viên.</div>'}</div>`;
  }

  // Xuất PHIẾU LƯƠNG PDF cho TỪNG giáo viên (mở cửa sổ in -> Lưu thành PDF)
  async function exportTeacherSalaryPDF(teacherId) {
    const from = dmyToYmd($("salFrom").value), to = dmyToYmd($("salTo").value);
    if (!from || !to) return toast("Nhập khoảng ngày hợp lệ (dd/mm/yyyy).", "err");
    if (from > to) return toast("Ngày bắt đầu phải trước ngày kết thúc.", "err");
    const t = teachersById[teacherId];
    if (!t) return toast("Không tìm thấy giáo viên.", "err");
    const { data, error } = await B.listSchedules({ from, to, teacherId: teacherId });
    if (error) return toast("Lỗi tải dữ liệu: " + error.message, "err");
    const ss = (data || []).filter((s) => s.teacher_present === true)
      .sort((a, b) => (a.schedule_date + a.start_time).localeCompare(b.schedule_date + b.start_time));
    // Điểm danh HS từng buổi -> sĩ số, lý do nghỉ, và HẠ BẬC lương theo sĩ số thực đến
    const attBySched = {};
    const { data: salAtts, error: attError } = await B.listAttendanceBySchedules(ss.map((s) => s.id));
    if (attError) return toast("Không thể xuất phiếu lương: " + attError.message, "err");
    (salAtts || []).forEach((a) => { (attBySched[a.schedule_id] || (attBySched[a.schedule_id] = [])).push(a); });
    const counts = {}; let total = 0;   // đếm & cộng lương theo loại lớp HIỆU DỤNG
    ss.forEach((s) => { const g = attendanceAgg(attBySched[s.id]); const k = effectiveLessonType(s.lesson_type || "ca_nhan", g.attending, g.absent); counts[k] = (counts[k] || 0) + 1; total += teacherPayFor(t, k); });
    const now = new Date();
    const logoUrl = new URL("logo-wordmark.png", location.href).href;

    const brkRows = LESSON_TYPES.filter((lt) => counts[lt.key]).map((lt) => {
      const c = counts[lt.key], rate = teacherPayFor(t, lt.key);
      return `<tr><td>${lt.label}</td><td class='num'>${c}</td><td class='num'>${money(rate)}</td><td class='num'>${money(c * rate)}</td></tr>`;
    }).join("");
    let absentSessions = 0, downgradeCount = 0;
    const detailRows = ss.map((s) => {
      const d = parseYmd(s.schedule_date);
      const arows = attBySched[s.id] || [];
      const g = attendanceAgg(arows);
      const absents = arows.filter((a) => a.present === false).map((a) => {
        const nm = (studentsById[a.student_id] && studentsById[a.student_id].full_name) || "HS";
        return a.note ? esc(nm) + " (" + esc(a.note) + ")" : esc(nm);
      });
      const hasAbsent = g.absent > 0;
      if (hasAbsent) absentSessions++;
      const nominal = s.lesson_type || "ca_nhan";
      const eff = effectiveLessonType(nominal, g.attending, g.absent);
      const downgraded = eff !== nominal;
      if (downgraded) downgradeCount++;
      const ltCell = downgraded ? lessonTypeLabel(nominal) + " <span class='warn-cell'>→ " + lessonTypeLabel(eff) + "</span>" : lessonTypeLabel(nominal);
      const nominalRate = teacherPayFor(t, nominal);  // Đơn giá = giá chuẩn theo loại lớp gốc (thu HP)
      const actualRate = teacherPayFor(t, eff);        // Lương buổi = lương thực trả GV (đã hạ bậc)
      const sizeCell = g.enrolled ? (hasAbsent ? "<span class='warn-cell'>" + g.attending + "/" + g.enrolled + "</span>" : g.attending + "/" + g.enrolled) : "—";
      const noteCell = absents.length ? absents.join("; ") : "";
      const salaryCell = downgraded ? "<span class='warn-cell'>" + money(actualRate) + "</span>" : money(actualRate);
      return `<tr class='${hasAbsent ? "row-partial" : ""}'><td>${dmy(d)}</td><td>${DOW[d.getDay()]}</td><td>${hhmm(s.start_time)}–${hhmm(s.end_time)}</td>` +
        `<td>${esc(s.subject)}</td><td>${esc(s.class_name || "")}</td><td>${ltCell}</td>` +
        `<td class='num'>${sizeCell}</td><td>${noteCell}</td>` +
        `<td class='num'>${money(nominalRate)}</td><td class='num'>${salaryCell}</td></tr>`;
    }).join("");

    const css = "*{box-sizing:border-box;}html,body{background:#fff;}body{font-family:'Segoe UI',-apple-system,Roboto,Arial,sans-serif;color:#111;margin:0;padding:22px;font-size:12.5px;}" +
      ".doc-head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:12px;}" +
      ".doc-logo-img{height:52px;width:auto;display:block;border-radius:6px;}" +
      ".center-name{font-size:15px;font-weight:800;letter-spacing:.3px;}.center-sub{font-size:11px;color:#666;}" +
      "h1.report-title{text-align:center;font-size:18px;margin:14px 0 2px;text-transform:uppercase;}" +
      ".report-range{text-align:center;font-size:12.5px;color:#333;}.report-gen{text-align:center;font-size:10.5px;color:#888;margin-bottom:14px;}" +
      ".info{margin:8px 0 12px;font-size:13px;line-height:1.8;}.info .lbl{color:#666;display:inline-block;min-width:150px;}" +
      "table{width:100%;border-collapse:collapse;margin-bottom:6px;}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;}" +
      "th{background:#eef0fb;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;}td.num,th.num{text-align:right;white-space:nowrap;}" +
      "tfoot td{font-weight:800;background:#f6f6fa;}h2.section-title{font-size:14px;margin:16px 0 6px;}" +
      ".row-partial td{background:#fff5e6;}.warn-cell{color:#b26a00;font-weight:800;}.legend{font-size:10.5px;color:#777;margin:5px 0 0;font-style:italic;}" +
      ".grand{margin-top:14px;padding:11px 14px;background:#eef0fb;border:1px solid #c9c9e6;border-radius:8px;font-size:15px;font-weight:800;display:flex;justify-content:space-between;}" +
      ".sign-row{display:flex;justify-content:space-around;margin-top:36px;text-align:center;font-size:12px;}.sign-row .col{width:45%;}" +
      ".sign-row .role{font-weight:700;}.sign-row .hint{font-size:10px;color:#888;font-style:italic;}.sign-row .space{height:58px;}" +
      "@page{size:A4;margin:14mm;}";
    const html = "<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Phiếu lương - " + esc(t.full_name) + "</title><style>" + css + "</style></head><body>" +
      "<div class='doc-head'><img class='doc-logo-img' src='" + logoUrl + "' alt='OpenMusic'><div><div class='center-name'>TRUNG TÂM NGHỆ THUẬT OPENMUSIC</div><div class='center-sub'>Phiếu lương giáo viên</div></div></div>" +
      "<h1 class='report-title'>Phiếu lương giáo viên</h1>" +
      "<div class='report-range'>Kỳ lương: từ <b>" + dmy(parseYmd(from)) + "</b> đến <b>" + dmy(parseYmd(to)) + "</b></div>" +
      "<div class='report-gen'>Lập lúc " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") + " ngày " + dmy(now) + "</div>" +
      "<div class='info'><div><span class='lbl'>Họ và tên giáo viên:</span> <b>" + esc(t.full_name) + "</b></div>" +
      (t.specialty ? "<div><span class='lbl'>Chuyên môn:</span> " + esc(t.specialty) + "</div>" : "") +
      "<div><span class='lbl'>Tổng số buổi đã dạy:</span> " + ss.length + " buổi" + (absentSessions ? " <span style='color:#b26a00;font-weight:700'>(trong đó " + absentSessions + " buổi có HS nghỉ" + (downgradeCount ? ", " + downgradeCount + " buổi hạ bậc lương" : "") + ")</span>" : "") + "</div></div>" +
      "<h2 class='section-title'>1. Bảng lương theo loại lớp</h2>" +
      "<table><thead><tr><th>Loại lớp</th><th class='num'>Số buổi</th><th class='num'>Đơn giá</th><th class='num'>Thành tiền</th></tr></thead>" +
      "<tbody>" + (brkRows || "<tr><td colspan='4' style='text-align:center;color:#888'>Không có buổi dạy nào trong kỳ.</td></tr>") + "</tbody>" +
      "<tfoot><tr><td colspan='3'>TỔNG LƯƠNG</td><td class='num'>" + money(total) + "</td></tr></tfoot></table>" +
      "<div class='grand'><span>TỔNG LƯƠNG KỲ NÀY</span><span>" + money(total) + "</span></div>" +
      (ss.length ? "<h2 class='section-title'>2. Chi tiết buổi dạy</h2><table><thead><tr><th>Ngày</th><th>Thứ</th><th>Giờ</th><th>Môn</th><th>Lớp</th><th>Loại lớp</th><th class='num'>Sĩ số</th><th>HS nghỉ (lý do)</th><th class='num'>Đơn giá</th><th class='num'>Lương buổi</th></tr></thead><tbody>" + detailRows + "</tbody></table><div class='legend'>Dòng nền cam = buổi có HS nghỉ. <b>Đơn giá</b> = giá chuẩn theo loại lớp (thu học phí HS), giữ nguyên. <b>Lương buổi</b> = lương thực trả GV (hạ bậc theo sĩ số thực học khi HS nghỉ: VD Nhóm còn 2 HS → tính lương Đôi; Đôi còn 1 HS → tính lương Cá nhân). Sĩ số = số HS đi học / tổng HS trong lớp.</div>" : "") +
      "<div class='sign-row'><div class='col'><div class='role'>NGƯỜI LẬP BẢNG</div><div class='hint'>(Ký, ghi rõ họ tên)</div><div class='space'></div></div>" +
      "<div class='col'><div class='role'>NGƯỜI NHẬN</div><div class='hint'>(Ký, ghi rõ họ tên)</div><div class='space'></div></div></div>" +
      "<scr" + "ipt>window.onload=function(){var g=document.images,n=g.length,d=0;function go(){if(++d>=n)setTimeout(function(){window.print();},250);}if(!n){setTimeout(function(){window.print();},250);return;}for(var i=0;i<n;i++){var m=g[i];if(m.complete)go();else{m.onload=go;m.onerror=go;}}};</scr" + "ipt>" +
      "</body></html>";

    const w = window.open("", "_blank");
    if (!w) { toast("Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi thử lại.", "err"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // =====================================================================
  //  HỌC PHÍ HỌC SINH (admin)
  // =====================================================================
  function renderTuition() {
    const q = norm($("tuitionSearch").value);
    const list = students.filter((s) => !q || [s.full_name, s.subject, s.phone, s.guardian].some((v) => norm(v).includes(q)));
    if (!list.length) { $("tuitionResult").innerHTML = `<div class="empty"><div class="big">🧮</div>${q ? "Không tìm thấy học sinh phù hợp." : "Chưa có học sinh."}</div>`; return; }
    let totalCollected = 0, totalCourse = 0;
    const body = list.map((s) => {
      const p = studentProgress(s);
      const collected = earnedTuition(s);
      const courseFee = p.total * p.fee;
      totalCollected += collected; totalCourse += courseFee;
      const tag = p.done ? `<span class="tag-done">Hết khóa</span>${p.extra ? ` <span class="tag-extra">+${p.extra} lẻ</span>` : ""}`
        : s.status === "completed" ? '<span class="tag-done">Đã KT</span>'
        : (p.remaining <= 2 && p.total ? '<span class="tag-near">Sắp hết</span>' : "");
      return `<tr><td>${esc(s.full_name)} ${tag}</td><td>${esc(s.subject || "—")}</td><td><span class="lt-badge">${lessonTypeLabel(s.lesson_type)}</span></td>` +
        `<td class="num">${p.seq}</td><td class="num">${p.used}/${p.total}</td><td class="num">${p.remaining}</td>` +
        `<td class="num">${money(p.fee)}</td><td class="num money">${money(courseFee)}</td>` +
        `<td class="num money total">${money(collected)}</td></tr>`;
    }).join("");
    $("tuitionResult").innerHTML =
      `<div class="table-wrap"><table class="tbl"><thead><tr>` +
      `<th>Học sinh</th><th>Môn</th><th>Loại</th><th class="num">Khóa</th><th class="num">Đã học</th><th class="num">Còn lại</th><th class="num">HP/buổi</th><th class="num">HP khóa này</th><th class="num">Thực thu (mọi khóa)</th>` +
      `</tr></thead><tbody>${body}</tbody>` +
      `<tfoot><tr><td colspan="7">TỔNG</td><td class="num money">${money(totalCourse)}</td><td class="num money total">${money(totalCollected)}</td></tr></tfoot></table></div>`;
  }
  function exportTuitionCSV() {
    const rows = [["Học sinh", "Môn", "Loại lớp", "Khóa", "Đã học", "Tổng buổi", "Còn lại", "Buổi lẻ", "HP mỗi buổi", "HP khóa này", "Thực thu (mọi khóa)", "Trạng thái"]];
    students.forEach((s) => {
      const p = studentProgress(s);
      rows.push([s.full_name, s.subject || "", lessonTypeLabel(s.lesson_type), p.seq, p.used, p.total, p.remaining, p.extra, p.fee, p.total * p.fee, earnedTuition(s), statusLabel(s.status)]);
    });
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "hoc-phi-openmusic.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // =====================================================================
  //  THÔNG BÁO
  // =====================================================================
  async function renderNotify() {
    // lớp hôm nay
    const tf = scheduleTeacherFilter();
    let scheds = [];
    if (tf !== "__none__") {
      const t = ymd(startOfToday());
      const { data } = await B.listSchedules({ from: t, to: t, teacherId: tf });
      scheds = data || [];
    }
    const now = new Date();
    $("notifyToday").innerHTML = scheds.length ? scheds.map((s) => {
      const startDt = new Date(`${s.schedule_date}T${s.start_time}`);
      const mins = Math.round((startDt - now) / 60000);
      let when;
      if (mins > 0) when = `<span class="tag-near">còn ${fmtMins(mins)}</span>`;
      else if (new Date(`${s.schedule_date}T${s.end_time}`) > now) when = `<span class="tag-done">đang diễn ra</span>`;
      else when = `<span style="color:var(--muted-2)">đã xong</span>`;
      return `<div class="info-card"><div class="ic-head"><div class="ic-avatar">⏰</div><div class="ic-title"><div class="nm">${hhmm(s.start_time)} · ${esc(s.subject)} ${when}</div><div class="sb">${esc(teacherDisplay(s))}${s.room ? " · 📍 " + esc(s.room) : ""}</div></div></div></div>`;
    }).join("") : '<div class="empty">Hôm nay không có lớp.</div>';

    // khóa học sắp / đã kết thúc
    const alerts = students.map((s) => ({ s, p: studentProgress(s) }))
      .filter((x) => x.p.total && (x.p.remaining <= 2 || x.s.status === "completed"))
      .sort((a, b) => a.p.remaining - b.p.remaining);
    $("notifyCourses").innerHTML = alerts.length ? alerts.map(({ s, p }) => {
      const done = p.remaining === 0 || s.status === "completed";
      return `<div class="info-card"><div class="ic-head"><div class="ic-avatar">${done ? "🎉" : "⚠️"}</div>` +
        `<div class="ic-title"><div class="nm">${esc(s.full_name)} ${done ? `<span class="tag-done">Hết khóa ${p.seq}</span>` : '<span class="tag-near">Còn ' + p.remaining + ' buổi</span>'}${p.extra ? ` <span class="tag-extra">${p.extra} buổi lẻ</span>` : ""}</div>` +
        `<div class="sb">${esc(s.subject || "")} · khóa ${p.seq}: đã học ${p.used}/${p.total} buổi · ${esc((teachersById[s.teacher_id] && teachersById[s.teacher_id].full_name) || "")}${done && isAdmin() ? " · vào Học sinh → “Mở khóa mới”" : ""}</div></div></div></div>`;
    }).join("") : '<div class="empty">Chưa có khóa nào sắp kết thúc.</div>';

    updateNotifyBadge(scheds, now, alerts.length);
  }
  function fmtMins(m) { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h${mm ? mm + "p" : ""}` : `${mm} phút`; }

  function updateNotifyBadge(scheds, now, courseAlerts) {
    const upcoming = (scheds || []).filter((s) => new Date(`${s.schedule_date}T${s.start_time}`) > now).length;
    const n = upcoming + (courseAlerts || 0);
    const b = $("notifyBadge");
    if (n > 0) { b.hidden = false; b.textContent = n; } else b.hidden = true;
    $("topNotifyBadge").hidden = n === 0; $("topNotifyBadge").textContent = n > 99 ? '99+' : n;
  }

  // =====================================================================
  //  NHẮC LỊCH (thông báo trước X phút)
  // =====================================================================
  async function refreshRemindCache() {
    const today = ymd(startOfToday());
    const tf = scheduleTeacherFilter();
    if (tf === "__none__") { remindCache = { date: today, scheds: [] }; return; }
    const { data } = await B.listSchedules({ from: today, to: today, teacherId: tf });
    remindCache = { date: today, scheds: data || [] };
    updateBadgeFromCache();
  }
  function updateBadgeFromCache() {
    const now = new Date();
    const alerts = students.map((s) => studentProgress(s)).filter((p) => p.total && p.remaining <= 2).length;
    updateNotifyBadge(remindCache.scheds, now, alerts);
  }

  function startReminderLoop() {
    refreshRemindCache();
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = setInterval(tickReminders, 60000);
    setTimeout(tickReminders, 1500);
  }
  function tickReminders() {
    const today = ymd(startOfToday());
    if (remindCache.date !== today) { refreshRemindCache(); return; }
    const now = new Date();
    const lead = getLeadMin();
    let next = null;
    remindCache.scheds.forEach((s) => {
      const startDt = new Date(`${s.schedule_date}T${s.start_time}`);
      const mins = Math.round((startDt - now) / 60000);
      if (mins > 0 && (!next || mins < next.mins)) next = { s, mins };
      if (mins > 0 && mins <= lead && !remindedIds.has(s.id)) {
        remindedIds.add(s.id);
        fireReminder(s, mins);
      }
    });
    // thanh nhắc lịch
    const bar = $("reminderBar");
    if (next) {
      bar.classList.remove("hidden");
      bar.innerHTML = `<span class="rb-ic">${NOTE_ICON}</span>` +
        `<div class="rb-text"><span class="rb-label">Buổi tiếp theo · còn ${fmtMins(next.mins)}</span>` +
        `<strong>${hhmm(next.s.start_time)}<i>·</i>${esc(next.s.subject)}${next.s.room ? `<i>·</i>${esc(next.s.room)}` : ""}</strong>` +
        `<span class="rb-sub">${esc(teacherDisplay(next.s))}</span></div>` +
        `<button class="rb-x" title="Ẩn" aria-label="Ẩn">×</button>`;
    } else bar.classList.add("hidden");
  }
  let devicePushEnabled = false;
  async function pushCall(action, extra = {}) {
    if (!B.raw) throw new Error('Thông báo máy chủ chỉ dùng trên tài khoản Supabase thật.');
    const {data,error} = await B.raw.functions.invoke('web-push', {body:{action,...extra}});
    if (error) {
      let message = 'Máy chủ thông báo chưa được kích hoạt. Cần triển khai Web Push trên Supabase.';
      try { const detail = await error.context.json(); if (detail.error) message = detail.error; } catch (_) {}
      throw new Error(message);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  async function pushRegistration() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !(navigator.standalone || window.matchMedia('(display-mode: standalone)').matches)) throw new Error('Mở OPENMUSIC từ biểu tượng đã Thêm vào màn hình chính để bật thông báo.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.Notification) throw new Error('Trình duyệt này chưa hỗ trợ Web Push.');
    await navigator.serviceWorker.register('sw.js');
    return navigator.serviceWorker.ready;
  }
  function pushKeyBytes(value) {
    const raw = atob(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4));
    return Uint8Array.from(raw, c=>c.charCodeAt(0));
  }
  async function setDevicePush(enabled) {
    if (!enabled) {
      const registration = await navigator.serviceWorker?.getRegistration();
      const sub = await registration?.pushManager.getSubscription();
      if (sub) { await pushCall('unsubscribe',{subscription:sub.toJSON()}); await sub.unsubscribe(); }
      devicePushEnabled = false; $('notifPerm').checked = false;
      return;
    }
    // iOS permission request must start in the user's click/change handler.
    if (!window.Notification) throw new Error('Hãy mở app từ màn hình chính để bật thông báo.');
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Chưa được cấp quyền thông báo. Kiểm tra Cài đặt iPhone → Thông báo.');
    const registration = await pushRegistration();
    const {publicKey} = await pushCall('config');
    const current = await registration.pushManager.getSubscription();
    const subscription = current || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKeyBytes(publicKey)});
    try { await pushCall('subscribe',{subscription:subscription.toJSON(),leadMinutes:getLeadMin()}); }
    catch (error) { if (!current) await subscription.unsubscribe(); throw error; }
    devicePushEnabled = true; $('notifPerm').checked = true;
  }
  async function refreshDevicePush() {
    devicePushEnabled = false;
    if (B.raw && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          const {data,error} = await B.raw.from('push_subscriptions').select('id').eq('endpoint',sub.endpoint).maybeSingle();
          devicePushEnabled = !error && !!data;
        }
      } catch (_) {}
    }
    $('notifPerm').checked = devicePushEnabled;
  }
  async function toggleDevicePush(enabled) {
    $('notifPerm').disabled = true;
    try { await setDevicePush(enabled); toast(enabled ? 'Đã bật thông báo trên thiết bị này, kể cả khi đóng app.' : 'Đã tắt thông báo trên thiết bị này.','ok'); }
    catch (error) { $('notifPerm').checked = devicePushEnabled; toast(error.message,'err'); }
    finally { $('notifPerm').disabled = false; }
  }
  async function testDevicePush() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub || !devicePushEnabled) throw new Error('Hãy bật thông báo trên thiết bị này trước.');
      await pushCall('test',{subscription:sub.toJSON()});
      toast('Máy chủ đã gửi thông báo thử.','ok');
    } catch (error) { toast(error.message,'err'); }
  }
  async function fireReminder(s, mins) {
    if (devicePushEnabled) return; // Scheduled push owns delivery; avoid duplicate reminders.
    if (window.Notification && Notification.permission === 'granted' && $('notifPerm').checked) {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification('OPENMUSIC — Sắp đến giờ lớp',{body:`${hhmm(s.start_time)} — ${s.subject} — Còn ${fmtMins(mins)}`,tag:'lesson-'+s.id});
      } catch (_) {}
    }
  }

  // =====================================================================
  //  CÀI ĐẶT
  // =====================================================================
  function initSettingsUI() {
    $("leadMin").value = getLeadMin();
    $("notifPerm").checked = devicePushEnabled;
    refreshDevicePush();
  }
  function renderPricing() {
    $("pricingStudent").innerHTML = '<option value="">Chọn học sinh…</option>' + students.slice().sort((a,b) => a.full_name.localeCompare(b.full_name,'vi')).map(s => `<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join('');
    const dp = settings.default_pay || {}, dt = settings.default_tuition || {};
    $("pricingBody").innerHTML = LESSON_TYPES.map((t) =>
      `<div class="price-row"><div class="pr-type">${t.label}</div>` +
      `<label class="pr-field"><span>Lương GV/buổi</span><input type="number" min="0" step="1000" data-dp="${t.key}" value="${Number(dp[t.key]) || 0}" /></label>` +
      `<label class="pr-field"><span>Học phí HS/buổi</span><input type="number" min="0" step="1000" data-dt="${t.key}" value="${Number(dt[t.key]) || 0}" /></label>` +
      `</div>`
    ).join("");
  }
  function renderSettings() { initSettingsUI(); renderPricing(); fillRuleSelect($("courseRuleDefault"), defaultCountRule(), false); }
  async function savePricing() {
    const dp = readRateInputs($("pricingBody"), "data-dp");
    const dt = readRateInputs($("pricingBody"), "data-dt");
    $("savePricing").disabled = true;
    const r1 = await B.saveSetting("default_pay", dp);
    const r2 = await B.saveSetting("default_tuition", dt);
    $("savePricing").disabled = false;
    if ((r1 && r1.error) || (r2 && r2.error)) return toast("Lưu bảng giá thất bại: " + ((r1 && r1.error && r1.error.message) || (r2 && r2.error && r2.error.message) || ""), "err");
    settings.default_pay = dp; settings.default_tuition = dt;
    toast("Đã lưu bảng giá mặc định.", "ok");
  }

  // =====================================================================
  //  NHẬP LIỆU NGÀY/GIỜ
  // =====================================================================
  function maskDate(el) { if (!el) return; el.addEventListener("input", () => { const v = el.value.replace(/\D/g, "").slice(0, 8); el.value = [v.slice(0, 2), v.slice(2, 4), v.slice(4, 8)].filter((x) => x.length).join("/"); }); }
  function maskTime(el) { if (!el) return; el.addEventListener("input", () => { const v = el.value.replace(/\D/g, "").slice(0, 4); el.value = [v.slice(0, 2), v.slice(2, 4)].filter((x) => x.length).join(":"); }); }
  function wireCal(btn) {
    const id = btn.getAttribute("data-cal");
    const text = $(id), native = $(id + "Native");
    if (!text || !native) return;
    btn.addEventListener("click", () => {
      native.value = dmyToYmd(text.value) || ymd(startOfToday());
      try { if (native.showPicker) native.showPicker(); else native.focus(); } catch (e) { native.focus(); }
    });
    native.addEventListener("change", () => { if (native.value) { text.value = ymdToDmy(native.value); text.dispatchEvent(new Event("change")); } });
  }

  // =====================================================================
  //  SIDEBAR (mobile)
  // =====================================================================
  let managementFocus = null;
  function openSidebar() {
    managementFocus = document.activeElement;
    $("sidebar").classList.add("open"); $("scrim").hidden = false;
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.body.classList.add('management-open');
      $("sidebar").setAttribute('role', 'dialog'); $("sidebar").setAttribute('aria-modal', 'true'); $("sidebar").setAttribute('aria-label', 'Quản lý');
      $("managementClose").focus();
    }
  }
  function closeSidebar() {
    const wasOpen = $("sidebar").classList.contains('open');
    $("sidebar").classList.remove("open"); $("scrim").hidden = true;
    document.body.classList.remove('management-open');
    ['role','aria-modal','aria-label'].forEach(a => $("sidebar").removeAttribute(a));
    if (wasOpen && managementFocus) managementFocus.focus();
  }

  function closeAllModals() { document.querySelectorAll(".modal-backdrop").forEach(el => el.classList.add("hidden")); ["modal", "studentModal", "teacherModal", "courseModal", "payModal", "weekModal"].forEach(id => { if ($(id)) $(id).classList.add("hidden"); }); }

  // =====================================================================
  //  GẮN SỰ KIỆN
  // =====================================================================
  function wireEvents() {
    $("pageSearchBtn").addEventListener('click', openPageSearch);
    $("pageSearchInput").addEventListener('input', renderPageSearch);
    $("pageSearchInput").addEventListener('keydown', e => { if (e.key === 'Enter') $("pageSearchDialog").close(); });
    $("pageSearchClose").addEventListener('click', () => $("pageSearchDialog").close());
    $("pageSearchDone").addEventListener('click', () => $("pageSearchDialog").close());
    $("pageSearchResults").addEventListener('click', e => { const b=e.target.closest('[data-search-name]'); if(b) { $("pageSearchInput").value=b.dataset.searchName; renderPageSearch(); $("pageSearchDialog").close(); } });
    $("pageSearchDialog").addEventListener('click', e => { if(e.target!==e.currentTarget)return; const r=e.currentTarget.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close(); });
    $("notificationsBtn").addEventListener('click', async () => {
      const dialog = $("notificationsDialog");
      $("notificationsContent").innerHTML = '<p class="state">Đang tải thông báo…</p>';
      dialog.showModal();
      await renderNotify();
      $("notificationsContent").innerHTML = '<h3>Lịch học hôm nay</h3>' + $("notifyToday").innerHTML + '<h3>Khóa học cần chú ý</h3>' + $("notifyCourses").innerHTML;
    });
    $("notificationsClose").addEventListener('click', () => $("notificationsDialog").close());
    $("notificationsDialog").addEventListener('click', e => { if (e.target !== e.currentTarget) return; const r=e.currentTarget.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close(); });
    document.querySelectorAll('[data-report-month]').forEach(button => button.addEventListener('click', () => { const [prefix,delta] = button.dataset.reportMonth.split(':'); shiftReportMonth(prefix, Number(delta)); }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeAccountMenu(); document.querySelectorAll('.student-picker[open]').forEach(p => p.open = false); }
      if (e.key !== 'Tab' || !document.body.classList.contains('management-open')) return;
      const controls = [...$("sidebar").querySelectorAll('button:not([disabled])')].filter(b => b.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // Theme
    $("themeBtn").addEventListener("click", () => applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"));

    // Auth
    $("authPrimary").addEventListener("click", () => {
      if (authMode === "login") doLogin();
      else if (authMode === "signup") doSignup();
      else if (authMode === "forgot") doForgot();
      else if (authMode === "reset") doReset();
    });
    $("lnkForgot").addEventListener("click", () => setAuthMode("forgot"));
    $("lnkSignup").addEventListener("click", () => setAuthMode("signup"));
    $("lnkBack").addEventListener("click", () => setAuthMode("login"));
    ["authName", "authEmail", "authPass", "authNew", "authNew2"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") $("authPrimary").click(); }));

    // Menu tài khoản (admin xem lịch GV khác)
    $("accountBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleAccountMenu(); });
    $("accountMenu").addEventListener("click", (e) => {
      if (e.target.closest("#logoutBtn")) {
        closeAccountMenu();
        (async () => { try { if (devicePushEnabled) await setDevicePush(false); } catch (_) { toast('Chưa tắt được thông báo máy chủ trên thiết bị này. Hãy tắt quyền trong Cài đặt iPhone nếu máy dùng chung.','err'); } await B.signOut(); })();
        return;
      }
      const it = e.target.closest("[data-amteacher]");
      if (it) viewTeacherSchedule(it.getAttribute("data-amteacher"));
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".account-wrap")) closeAccountMenu(); });

    // Menu / sidebar
    $("menu").addEventListener("click", (e) => { const b = e.target.closest(".menu-item"); if (b) switchView(b.getAttribute("data-view")); });
    $("menuBtn").addEventListener("click", openSidebar);
    $("scrim").addEventListener("click", closeSidebar);
    $("managementClose").addEventListener("click", closeSidebar);
    $("sidebarToggle").addEventListener("click", toggleSidebarCollapse);

    // Reminder bar đóng
    $("reminderBar").addEventListener("click", (e) => { if (e.target.classList.contains("rb-x")) $("reminderBar").classList.add("hidden"); });

    // Lịch tuần — điều hướng
    document.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => { const [k, d] = btn.getAttribute("data-nav").split(":"); navigate(k, parseInt(d, 10)); }));
    $("datePicker").addEventListener("change", () => { const y = dmyToYmd($("datePicker").value); if (y) setViewDate(parseYmd(y)); });
    $("todayBtn").addEventListener("click", () => setViewDate(startOfToday()));
    $("scheduleDays").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-schedule-date]");
      if (!btn) return;
      viewDate = parseYmd(btn.dataset.scheduleDate);
      $("datePicker").value = dmy(viewDate);
      renderScheduleDays();
      const block = document.querySelector(`[data-schedule-block="${btn.dataset.scheduleDate}"]`);
      if (block && block.getClientRects().length) block.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("#scheduleMore")) $("scheduleMore").open = false; });
    $("scheduleMore").addEventListener("keydown", (e) => {
      if (e.key === "Escape") { $("scheduleMore").open = false; $("scheduleMore").querySelector("summary").focus(); }
    });
    $("teacherFilter").addEventListener("change", () => { loadWeek(); });
    $("addBtn").addEventListener("click", () => openScheduleModal(null, ymd(viewDate), buoiOf(new Date().toTimeString())));

    // Áp dụng cả tuần cho các tuần sau
    $("applyWeekBtn").addEventListener("click", () => {
      $("scheduleMore").open = false;
      const ws = startOfWeek(viewDate);
      const backStart = startOfWeek(new Date(ws.getFullYear(), ws.getMonth() - 3, 1));
      openWeekPicker({
        title: "Áp dụng lịch tuần này cho các tuần khác",
        subtitle: `Sao chép toàn bộ lớp trong tuần ${dmy(ws)} – ${dmy(addDays(ws, 6))} sang các tuần được chọn — gồm cả tuần TRƯỚC (backfill điểm danh/lương) lẫn tuần SAU. Cùng thứ, giờ, giáo viên. Tuần đã có lịch sẽ được bỏ qua.`,
        fromWeekStart: backStart,
        anchorWeekStart: ws,
        excludeWeekStart: ws,
        onApply: (weeks, copy) => applyWeekToWeeks(ws, weeks, copy),
      });
    });
    // Bộ chọn tuần
    $("wkClose").addEventListener("click", closeWeekPicker);
    $("wkCancel").addEventListener("click", closeWeekPicker);
    $("wkApply").addEventListener("click", weekPickerConfirm);
    $("weekModal").addEventListener("click", (e) => { if (e.target === $("weekModal")) closeWeekPicker(); });
    $("wkAll").addEventListener("click", () => document.querySelectorAll("#wkList input[type=checkbox]").forEach((c) => (c.checked = true)));
    $("wkNone").addEventListener("click", () => document.querySelectorAll("#wkList input[type=checkbox]").forEach((c) => (c.checked = false)));
    $("wkList").addEventListener("change", (e) => {
      const m = e.target.closest(".wk-mon");
      if (m) document.querySelectorAll(`#wkList .wk-item[data-mon="${m.getAttribute("data-mon")}"] .wk-week`).forEach((c) => (c.checked = m.checked));
    });
    // Nút lặp trong modal đặt buổi
    $("fRepeat").addEventListener("change", () => {
      $("fRepeatWrap").style.display = $("fRepeat").checked ? "" : "none";
      if (!$("fRepeat").checked) { modalApplyWeeks = []; $("fRepeatInfo").textContent = ""; }
    });
    $("fRepeatPick").addEventListener("click", () => {
      const base = parseYmd(dmyToYmd($("fDate").value) || ymd(viewDate));
      const backStart = startOfWeek(new Date(base.getFullYear(), base.getMonth() - 3, 1));
      openWeekPicker({
        title: "Áp dụng buổi học cho các tuần khác",
        subtitle: "Buổi sẽ được tạo cùng thứ trong mỗi tuần bạn chọn — gồm cả tuần trước & sau (kèm học sinh nếu tick).",
        fromWeekStart: backStart,
        anchorWeekStart: startOfWeek(base),
        excludeWeekStart: startOfWeek(base),
        onApply: (weeks, copy) => { modalApplyWeeks = weeks; modalApplyCopy = copy; $("fRepeatInfo").textContent = "Đã chọn " + weeks.length + " tuần."; },
      });
    });

    // Lịch tuần — click vào ô (sửa/xóa/thêm)
    $("tkbWrap").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-edit]"), de = e.target.closest("[data-del]"), ad = e.target.closest("[data-add]");
      if (ed) { const s = allForWeek.find((x) => x.id === ed.getAttribute("data-edit")); if (s) openScheduleModal(s); }
      else if (de) deleteSchedule(de.getAttribute("data-del"));
      else if (ad) { const [d, b] = ad.getAttribute("data-add").split("|"); openScheduleModal(null, d, b); }
    });

    // Hôm nay — điểm danh
    $("todayList").addEventListener("click", (e) => {
      const add = e.target.closest("[data-addstudent]");
      if (add) { const [sid, stid] = add.dataset.addstudent.split('|'); addStudentToClass(sid, stid); return; }
      const att = e.target.closest("[data-att]"), tp = e.target.closest("[data-tpv]"), rm = e.target.closest("[data-attrm]");
      if (att) { const [sid, stid, v] = att.getAttribute("data-att").split("|"); markStudent(sid, stid, v === "1"); }
      else if (tp) { const wrap = tp.closest("[data-tp]"); markTeacher(wrap.getAttribute("data-tp"), tp.getAttribute("data-tpv") === "1"); }
      else if (rm) { const [sid, stid] = rm.getAttribute("data-attrm").split("|"); removeStudentFromClass(sid, stid); }
    });
    $("todayList").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-addsel]");
      if (sel) { addStudentToClass(sel.getAttribute("data-addsel"), sel.value); return; }
      const exc = e.target.closest("[data-attexc]");
      if (exc) { const [sid, stid] = exc.getAttribute("data-attexc").split("|"); markExcused(sid, stid, exc.checked); return; }
      const note = e.target.closest("[data-attnote]");
      if (note) { const [sid, stid] = note.getAttribute("data-attnote").split("|"); saveAttNote(sid, stid, note.value); }
    });
    // ô tìm học sinh để thêm vào lớp
    $("todayList").addEventListener("input", (e) => {
      const q = e.target.closest("[data-studentquery]");
      if (q) {
        const panel = q.closest('.student-picker-panel'), query = norm(q.value); let count = 0;
        panel.querySelectorAll('[data-studentmatch]').forEach(b => { b.hidden = !b.dataset.studentmatch.includes(query); if (!b.hidden) count++; });
        panel.querySelector('.student-picker-empty').hidden = count > 0;
      }
    });
    // Hôm nay — điều hướng ngày điểm danh
    document.querySelectorAll("[data-attnav]").forEach((btn) =>
      btn.addEventListener("click", () => setAttDate(addDays(attDate, parseInt(btn.getAttribute("data-attnav"), 10)))));
    // dải tuần: chọn ngày / lùi-tiến 1 tuần / bấm tên tháng để mở lịch
    $("wsDays").addEventListener("click", (e) => { const b = e.target.closest("[data-wsday]"); if (b) setAttDate(new Date(b.getAttribute("data-wsday") + "T00:00:00")); });
    $("wsPrev").addEventListener("click", () => setAttDate(addDays(attDate, -7)));
    $("wsNext").addEventListener("click", () => setAttDate(addDays(attDate, 7)));
    // thanh tab dưới (mobile)
    $("tabbar").addEventListener("click", (e) => {
      const b = e.target.closest(".tab"); if (!b) return;
      if (b.id === "tabMore") openSidebar(); else switchView(b.getAttribute("data-view"));
    });
    $("attDatePicker").addEventListener("change", () => { const y = dmyToYmd($("attDatePicker").value); if (y) setAttDate(parseYmd(y)); });

    // Modal buổi học
    $("modalClose").addEventListener("click", closeScheduleModal);
    $("modalCancel").addEventListener("click", closeScheduleModal);
    $("modalSave").addEventListener("click", saveSchedule);
    $("scheduleForm").addEventListener("submit", (e) => { e.preventDefault(); saveSchedule(); });
    $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeScheduleModal(); });
    // lọc danh sách HS trong popup buổi học (HS đã tick luôn hiện)
    $("fStudentSearch").addEventListener("input", () => {
      const q = norm($("fStudentSearch").value);
      document.querySelectorAll("#fStudents .chk-item").forEach((el) => {
        el.hidden = !!q && !el.getAttribute("data-q").includes(q) && !el.querySelector("input").checked;
      });
    });

    // Học sinh
    $("addStudentBtn").addEventListener("click", () => openStudentModal(null));
    $("studentSearch").addEventListener("input", renderStudents);
    $("studentSearchToggle").addEventListener("click", () => $("studentSearch").focus());
    $("studentSearch").addEventListener("input", () => $("studentSearch").closest('.student-search').classList.toggle('has-query', !!$("studentSearch").value));
    $("studentList").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-stedit]"), de = e.target.closest("[data-stdel]"), pa = e.target.closest("[data-stpay]"), pf = e.target.closest("[data-stpdf]");
      if (pf) exportStudentAttendancePDF(pf.getAttribute("data-stpdf"));
      else if (pa) openPaymentModal(pa.getAttribute("data-stpay"));
      else if (e.target.closest("[data-stcourse]")) openCourseModal(e.target.closest("[data-stcourse]").getAttribute("data-stcourse"));
      else if (e.target.closest("[data-stnewcourse]")) openCourseModal(e.target.closest("[data-stnewcourse]").getAttribute("data-stnewcourse"));
      else if (ed) openStudentModal(studentsById[ed.getAttribute("data-stedit")]);
      else if (de) deleteStudent(de.getAttribute("data-stdel"));
    });
    // Modal khóa học
    $("cmClose").addEventListener("click", closeCourseModal);
    $("cmCancel").addEventListener("click", closeCourseModal);
    $("cmSave").addEventListener("click", saveCourse);
    $("courseForm").addEventListener("submit", (e) => { e.preventDefault(); saveCourse(); });
    $("courseModal").addEventListener("click", (e) => { if (e.target === $("courseModal")) closeCourseModal(); });
    $("cmTotalPick").addEventListener("click", (e) => { const b = e.target.closest("[data-total]"); if (b) setCmTotal(b.getAttribute("data-total")); });
    $("cmTotal").addEventListener("input", () => setCmTotal($("cmTotal").value));
    $("cmList").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-cmedit]"), de = e.target.closest("[data-cmdel]");
      if (ed) fillCourseForm(studentsById[$("cmStudentId").value], Number(ed.getAttribute("data-cmedit")));
      else if (de) deleteCourse(de.getAttribute("data-cmdel"));
    });
    // Cài đặt — cách trừ buổi mặc định
    $("saveCourseRule").addEventListener("click", async () => {
      const v = $("courseRuleDefault").value;
      const { error } = await B.saveSetting("course_count_rule", v);
      if (error) return toast("Lưu thất bại: " + error.message, "err");
      settings.course_count_rule = v;
      students.forEach((s) => rebuildCourseInfo(s.id));
      toast("Đã lưu cách trừ buổi mặc định.", "ok");
    });
    // Modal học phí
    $("payClose").addEventListener("click", closePaymentModal);
    $("payDone").addEventListener("click", closePaymentModal);
    $("payAdd").addEventListener("click", addPaymentRecord);
    $("paymentModal").addEventListener("click", (e) => { if (e.target === $("paymentModal")) closePaymentModal(); });
    $("payHistory").addEventListener("click", (e) => { const d = e.target.closest("[data-paydel]"); if (d) deletePaymentRecord(d.getAttribute("data-paydel")); });
    // Lãi/Lỗ
    $("proRun").addEventListener("click", runProfit);
    $("proMonthBtn").addEventListener("click", () => { setProfitMonth(); runProfit(); });
    $("smClose").addEventListener("click", closeStudentModal);
    $("smCancel").addEventListener("click", closeStudentModal);
    $("smSave").addEventListener("click", saveStudent);
    $("studentForm").addEventListener("submit", (e) => { e.preventDefault(); saveStudent(); });
    $("studentModal").addEventListener("click", (e) => { if (e.target === $("studentModal")) closeStudentModal(); });

    // Giáo viên
    $("addTeacherBtn").addEventListener("click", () => openTeacherModal(null));
    $("teacherSearchToggle").addEventListener("click", () => $("teacherSearch").focus());
    $("teacherSearch").addEventListener("input", () => { $("teacherSearch").closest('.teacher-search').classList.toggle('has-query', !!$("teacherSearch").value); renderTeachers(); });
    $("teacherList").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-tcedit]"), de = e.target.closest("[data-tcdel]");
      if (ed) openTeacherModal(teachersById[ed.getAttribute("data-tcedit")]);
      else if (de) deleteTeacher(de.getAttribute("data-tcdel"));
    });
    $("tmClose").addEventListener("click", closeTeacherModal);
    $("tmCancel").addEventListener("click", closeTeacherModal);
    $("tmSave").addEventListener("click", saveTeacher);
    $("teacherForm").addEventListener("submit", (e) => { e.preventDefault(); saveTeacher(); });
    $("teacherModal").addEventListener("click", (e) => { if (e.target === $("teacherModal")) closeTeacherModal(); });

    // Lương
    $("salMonthBtn").addEventListener("click", () => { setSalaryMonth(); runSalary(); });
    $("salRun").addEventListener("click", runSalary);
    $("salaryResult").addEventListener("click", (e) => { const b = e.target.closest("[data-salpdf]"); if (b) exportTeacherSalaryPDF(b.getAttribute("data-salpdf")); });

    // Học phí
    $("tuitionSearch").addEventListener("input", renderTuition);
    $("tuitionExport").addEventListener("click", exportTuitionCSV);

    // Cài đặt
    $('leadMin').addEventListener('change', async () => {
      const value = Math.min(1440,Math.max(0,Math.floor(Number($('leadMin').value)||0)));
      $('leadMin').value = value; setLeadMin(value); remindedIds = new Set();
      if (devicePushEnabled) { try { await setDevicePush(true); } catch (error) { toast(error.message,'err'); return; } }
      toast('Đã lưu: nhắc trước '+value+' phút.','ok');
    });
    $('notifPerm').addEventListener('change',()=>toggleDevicePush($('notifPerm').checked));
    $('enableDevicePush').addEventListener('click',()=>toggleDevicePush(true));
    $('testDevicePush').addEventListener('click',testDevicePush);
    $('testNotify').addEventListener('click',testDevicePush);
    $("savePricing").addEventListener("click", savePricing);
    $("adjustStudentPricing").addEventListener("click", () => {
      const sid = $("pricingStudent").value;
      if (!sid) return toast('Chọn học sinh cần điều chỉnh học phí.', 'err');
      const st = studentsById[sid], bd = courseInfo[sid] || courseBreakdown(st, []);
      openCourseModal(sid, bd.courses.length - 1);
    });
    ['cmFee','cmBaseFee'].forEach(id => $(id).addEventListener('input', e => formatMoneyTyping(e.target)));
    ["cmFeeMode","cmBaseFee","cmDiscount","cmFee","cmTotal"].forEach(id => $(id).addEventListener(id === 'cmFeeMode' ? 'change' : 'input', updateCourseFee));
    $("cmTotalPick").addEventListener('click', updateCourseFee);
    // Tự điền học phí theo bảng giá khi đổi loại lớp (chỉ khi đang THÊM mới)
    $("smLessonType").addEventListener("change", () => { if (!$("smId").value) { const d = defaultTuition($("smLessonType").value); if (d) $("smFee").value = d; } });

    // Mask ngày/giờ + nút lịch
    ["fDate", "datePicker", "smStart", "salFrom", "salTo", "attDatePicker", "tmDob", "tmHire", "payDate", "proFrom", "proTo", "cmStart"].forEach((id) => maskDate($(id)));
    ["fStart", "fEnd", "payTime"].forEach((id) => maskTime($(id)));
    document.querySelectorAll(".cal-btn").forEach(wireCal);

    // ESC đóng modal/sidebar
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("weekModal").classList.contains("hidden")) closeWeekPicker();
      else if (!$("accountMenu").classList.contains("hidden")) closeAccountMenu();
      else if (!$("modal").classList.contains("hidden")) closeScheduleModal();
      else if (!$("studentModal").classList.contains("hidden")) closeStudentModal();
      else if (!$("teacherModal").classList.contains("hidden")) closeTeacherModal();
      else if (!$("paymentModal").classList.contains("hidden")) closePaymentModal();
      else if (!$("courseModal").classList.contains("hidden")) closeCourseModal();
      else if ($("sidebar").classList.contains("open")) closeSidebar();
    });
  }

  // ===== PWA =====
  //  Service worker (sw.js): cài app ra màn hình chính + mở được khi mất mạng.
  //  Bỏ qua trên localhost để khi sửa code không bị dính cache cũ.
  function setupPWA() {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if ("serviceWorker" in navigator && location.protocol === "https:" && !isLocal) {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW:", err));
    }
    showIosInstallHint();
  }

  //  iPhone/iPad không có nút "Cài đặt" tự động như Android → hiện hướng dẫn
  //  "Chia sẻ → Thêm vào MH chính" khi mở bằng Safari (chưa cài). Bấm × là ẩn hẳn.
  function showIosInstallHint() {
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
    const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    let dismissed = false;
    try { dismissed = localStorage.getItem("om-ios-hint") === "1"; } catch (_) {}
    if (!isIOS || !isSafari || standalone || dismissed) return;

    const bar = document.createElement("div");
    bar.className = "ios-install";
    bar.innerHTML = `<img src="apple-touch-icon.png" alt="" />
      <div class="ii-text"><b>Cài OPENMUSIC lên iPhone</b>
        <span>Nhấn <svg class="ii-share" viewBox="0 0 24 24" aria-label="Chia sẻ"><path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> rồi chọn <b>“Thêm vào MH chính”</b></span></div>
      <button class="ii-x" aria-label="Đóng">×</button>`;
    bar.querySelector(".ii-x").addEventListener("click", () => {
      bar.remove();
      try { localStorage.setItem("om-ios-hint", "1"); } catch (_) {}
    });
    document.body.appendChild(bar);
  }

  document.addEventListener("DOMContentLoaded", init);
  document.addEventListener("DOMContentLoaded", setupPWA);
})();
