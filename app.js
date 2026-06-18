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
  let myProfile = null;
  let profilesList = [], profilesById = {};
  let teachers = [], teachersById = {}, myTeacher = null;
  let students = [], studentsById = {};
  let presentByStudent = {};        // student_id -> số buổi đã có mặt (toàn thời gian)
  let teacherStatsById = {};        // teacher_id -> { taught, off }
  let viewDate = startOfToday();
  let attDate = startOfToday();   // ngày đang điểm danh (mặc định hôm nay)
  let currentView = "today";
  let recovering = false, resetDone = false;

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
  const PAGE_TITLE = { today: "Hôm nay & Điểm danh", schedule: "Thời khóa biểu", students: "Học sinh", teachers: "Giáo viên", salary: "Tính lương", tuition: "Học phí học sinh", notify: "Thông báo", settings: "Cài đặt" };

  // Môn học & loại lớp (cá nhân / đôi / nhóm)
  const SUBJECTS = ["Piano", "Guitar", "Thanh nhạc", "Múa", "Vẽ", "Cờ vua"];
  const LESSON_TYPES = [{ key: "ca_nhan", label: "Cá nhân" }, { key: "doi", label: "Đôi" }, { key: "nhom", label: "Nhóm" }, { key: "gia_su", label: "Gia sư" }];
  function lessonTypeLabel(k) { const t = LESSON_TYPES.find((x) => x.key === k); return t ? t.label : "Cá nhân"; }
  function fillLessonTypeSelect(sel, val) { sel.innerHTML = LESSON_TYPES.map((t) => `<option value="${t.key}">${t.label}</option>`).join(""); sel.value = val || "ca_nhan"; }
  let settings = {};
  function defaultPay(type) { const m = settings.default_pay || {}; return Number(m[type]) || 0; }
  function defaultTuition(type) { const m = settings.default_tuition || {}; return Number(m[type]) || 0; }
  function teacherPayFor(teacher, type) {
    if (!teacher) return 0;
    const r = teacher.pay_rates || {};
    if (r[type] != null && r[type] !== "") return Number(r[type]) || 0;
    return Number(teacher.pay_per_session) || 0;
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
    document.documentElement.setAttribute("data-theme", t);
    $("themeBtn").innerHTML = t === "dark" ? MOON : SUN;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0a0e1a" : "#f6f9fc");
    try { localStorage.setItem("om-theme", t); } catch (e) {}
  }
  function initTheme() {
    let t = "dark";
    try { t = localStorage.getItem("om-theme") || "dark"; } catch (e) {}
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
    const demo = window.BACKEND_MODE === "demo";
    const accStr = "admin@openmusic.vn · co.lan@openmusic.vn · thay.nam@openmusic.vn — mật khẩu: 123456";
    $("demoAccounts").textContent = demo ? accStr : "Đang dùng Supabase — đăng nhập bằng tài khoản thật của trung tâm.";
    $("demoCard").hidden = !demo;
    if (demo) {
      const h = $("authDemoHint");
      h.hidden = false;
      h.innerHTML = "<b>Chế độ DEMO</b> — đăng nhập thử:<br>• Admin: <b>admin@openmusic.vn</b><br>• Giáo viên: <b>co.lan@openmusic.vn</b> / <b>thay.nam@openmusic.vn</b><br>Mật khẩu: <b>123456</b>";
    }
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
    myProfile = await B.ensureProfile(user);
    hideAuth();
    $("app").classList.remove("hidden");

    const name = (myProfile && myProfile.full_name) || user.email;
    $("accName").textContent = name;
    $("accAvatar").textContent = initials(name);
    $("accRole").innerHTML = isAdmin() ? 'Quản trị viên <span class="badge-admin">ADMIN</span>' : "Giáo viên";

    await loadGlobals();
    applyRoleUI();
    initSettingsUI();
    switchView("today");
    startReminderLoop();
  }

  function onSignedOut() {
    user = null; currentUid = null; myProfile = null;
    profilesList = []; profilesById = {}; teachers = []; teachersById = {}; myTeacher = null;
    students = []; studentsById = {}; presentByStudent = {};
    remindedIds = new Set();
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
    $("accCaret").hidden = !admin;
    $("accountBtn").classList.toggle("clickable", admin);
  }

  // ---------- MENU TÀI KHOẢN: admin xem lịch dạy của giáo viên khác ----------
  function renderAccountMenu() {
    const cur = $("teacherFilter").value || "all";
    let h = '<div class="am-head">Xem lịch dạy của giáo viên</div>';
    h += amItem("all", "Tất cả giáo viên", "Xem toàn bộ lịch", cur === "all");
    teachers.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi")).forEach((t) => {
      const acc = t.user_id && profilesById[t.user_id] ? (profilesById[t.user_id].email || profilesById[t.user_id].full_name) : "chưa gắn tài khoản";
      h += amItem(t.id, t.full_name, acc, cur === t.id);
    });
    $("accountMenu").innerHTML = h;
  }
  function amItem(id, name, sub, active) {
    return `<button class="am-item ${active ? "active" : ""}" data-amteacher="${id}"><div class="am-av">${esc(initials(name))}</div>` +
      `<div class="am-info"><div class="am-nm">${esc(name)}</div><div class="am-sub">${esc(sub)}</div></div></button>`;
  }
  function toggleAccountMenu() {
    if (!isAdmin()) return;
    const m = $("accountMenu");
    if (m.classList.contains("hidden")) { renderAccountMenu(); m.classList.remove("hidden"); }
    else m.classList.add("hidden");
  }
  function closeAccountMenu() { $("accountMenu").classList.add("hidden"); }
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
  async function loadGlobals() {
    const [tRes, sRes, pRes, cRes, setRes, tsRes] = await Promise.all([
      B.listTeachers(), B.listStudents(), B.listProfiles(), B.countPresentByStudent(), B.getSettings(), B.teacherStats(),
    ]);
    settings = setRes.data || {};
    teacherStatsById = tsRes.data || {};
    teachers = tRes.data || [];
    teachersById = {}; teachers.forEach((t) => (teachersById[t.id] = t));
    students = (sRes.data || []).slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi"));
    studentsById = {}; students.forEach((s) => (studentsById[s.id] = s));
    profilesList = pRes.data || [];
    profilesById = {}; profilesList.forEach((p) => (profilesById[p.id] = p));
    presentByStudent = cRes.data || {};
    myTeacher = teachers.find((t) => t.user_id === (user && user.id)) || null;
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
    document.querySelectorAll(".menu-item").forEach((b) => b.classList.toggle("active", b.getAttribute("data-view") === view));
    document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    $("pageTitle").textContent = PAGE_TITLE[view] || "";
    closeSidebar();
    if (view === "today") loadToday();
    else if (view === "schedule") { fillTeacherFilter(); setViewDate(viewDate); }
    else if (view === "students") renderStudents();
    else if (view === "teachers") renderTeachers();
    else if (view === "salary") { ensureSalaryDates(); }
    else if (view === "tuition") renderTuition();
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
    const isToday = ymd(attDate) === ymd(startOfToday());
    $("todayTitle").textContent = isToday ? "Lớp học hôm nay" : "Lớp học ngày " + dmy(attDate);
    $("todayDate").textContent = `${DOW[attDate.getDay()]}, ${dmy(attDate)}`;
    $("attDatePicker").value = dmy(attDate);
    $("migrationBanner").hidden = !(MIGRATION_MODE && ymd(attDate) < ymd(startOfToday()));
    const tf = scheduleTeacherFilter();
    if (tf === "__none__") {
      $("todayList").innerHTML = '<div class="empty"><div class="big">🔗</div>Tài khoản của bạn chưa được gắn vào giáo viên nào.<br>Hãy nhờ Admin gắn ở mục “Giáo viên”.</div>';
      $("todayStats").innerHTML = "";
      return;
    }
    const t = ymd(attDate);
    const { data: scheds } = await B.listSchedules({ from: t, to: t, teacherId: tf });
    todayScheds = scheds || [];
    const ids = todayScheds.map((s) => s.id);
    const { data: atts } = await B.listAttendanceBySchedules(ids);
    todayAtt = atts || [];
    renderToday();
  }

  function attFor(scheduleId) { return todayAtt.filter((a) => a.schedule_id === scheduleId); }

  function renderToday() {
    // thống kê
    let present = 0, absent = 0, none = 0;
    todayAtt.forEach((a) => { if (a.present === true) present++; else if (a.present === false) absent++; else none++; });
    $("todayStats").innerHTML =
      chip(todayScheds.length, "Lớp", "primary") +
      chip(present, "Có mặt", "good") +
      chip(absent, "Vắng", "bad") +
      chip(none, "Chưa ĐD", "warn");

    if (!todayScheds.length) {
      const isToday = ymd(attDate) === ymd(startOfToday());
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
    const tpToggle =
      `<span class="tp-label">GV:</span><div class="tp-toggle" data-tp="${s.id}">` +
      `<button class="yes ${tp === true ? "on" : ""}" data-tpv="1">Có dạy</button>` +
      `<button class="no ${tp === false ? "on" : ""}" data-tpv="0">Nghỉ</button></div>`;

    const studRows = rows.length
      ? rows.map((a) => {
          const st = studentsById[a.student_id];
          const nm = st ? st.full_name : "(học sinh đã xóa)";
          const sub = st ? esc(st.subject || "") : "";
          const status = a.present === true ? '<span class="att-status present">✓ Có mặt</span>'
            : a.present === false ? '<span class="att-status absent">✕ Vắng</span>'
            : '<span class="att-status none">• Chưa điểm danh</span>';
          return `<div class="att-row">` +
            `<div class="att-name"><div class="n">${esc(nm)}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>` +
            status +
            `<div class="att-actions">` +
            `<button class="att-btn yes ${a.present === true ? "on" : ""}" data-att="${s.id}|${a.student_id}|1" title="Có mặt">✓</button>` +
            `<button class="att-btn no ${a.present === false ? "on" : ""}" data-att="${s.id}|${a.student_id}|0" title="Vắng">✕</button>` +
            `<button class="att-btn rm" data-attrm="${s.id}|${a.student_id}" title="Bỏ khỏi lớp">🗑</button>` +
            `</div></div>`;
        }).join("")
      : '<div class="class-empty-students">Chưa có học sinh trong lớp này.</div>';

    // học sinh có thể thêm vào lớp
    const inClass = new Set(rows.map((a) => a.student_id));
    const addable = students.filter((st) => !inClass.has(st.id));
    const addRow = `<div class="cc-foot"><div class="add-stud-row">` +
      `<select data-addsel="${s.id}"><option value="">+ Thêm học sinh vào lớp…</option>` +
      addable.map((st) => `<option value="${st.id}">${esc(st.full_name)}${st.subject ? " · " + esc(st.subject) : ""}</option>`).join("") +
      `</select></div></div>`;

    return `<div class="class-card ${isPast ? "is-past" : ""} ${locked ? "locked" : ""}">` +
      `<div class="cc-head">` +
        `<span class="cc-time">${hhmm(s.start_time)}–${hhmm(s.end_time)}</span>` +
        `<div class="cc-info"><div class="cc-subj">${esc(s.subject)}</div>` +
        `<div class="cc-meta">${[teacherDisplay(s), lessonTypeLabel(s.lesson_type), s.class_name ? "Lớp " + esc(s.class_name) : "", s.room ? "📍 " + esc(s.room) : ""].filter(Boolean).join(" · ")}</div></div>` +
        `<div class="cc-tpresent">${tpToggle}</div>` +
      `</div>` +
      `<div class="cc-body">${studRows}</div>` +
      addRow +
    `</div>`;
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
    renderToday();
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
    renderToday();
    toast("Đã thêm học sinh vào lớp.", "ok");
  }
  async function removeStudentFromClass(scheduleId, studentId) {
    if (!canEditAttendance()) return toast("Chỉ điểm danh được từ hôm nay trở đi.", "err");
    const { error } = await B.removeAttendance(scheduleId, studentId);
    if (error) return toast("Lỗi: " + error.message, "err");
    todayAtt = todayAtt.filter((a) => !(a.schedule_id === scheduleId && a.student_id === studentId));
    renderToday();
  }

  // =====================================================================
  //  THỜI KHÓA BIỂU (tuần)
  // =====================================================================
  let allForWeek = [], attByWeek = {};

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
    $("navRange").textContent = `${dmy(ws)} – ${dmy(we)}`;
    $("navMonth").textContent = `Tháng ${we.getMonth() + 1}, ${we.getFullYear()}`;
    $("datePicker").value = dmy(viewDate);
    loadWeek();
  }
  function navigate(kind, delta) {
    const d = new Date(viewDate);
    if (kind === "week") d.setDate(d.getDate() + delta * 7);
    else if (kind === "month") d.setMonth(d.getMonth() + delta);
    setViewDate(d);
  }

  async function loadWeek() {
    $("tkbWrap").classList.add("loading"); $("loading").classList.remove("hidden");
    const ws = startOfWeek(viewDate), we = addDays(ws, 6);
    const tf = scheduleTeacherFilter();
    if (tf === "__none__") { allForWeek = []; attByWeek = {}; $("loading").classList.add("hidden"); $("tkbWrap").classList.remove("loading"); renderWeek(); return; }
    const { data, error } = await B.listSchedules({ from: ymd(ws), to: ymd(we), teacherId: tf });
    allForWeek = error ? [] : (data || []);
    const ids = allForWeek.map((s) => s.id);
    const { data: atts } = await B.listAttendanceBySchedules(ids);
    attByWeek = {};
    (atts || []).forEach((a) => {
      const m = attByWeek[a.schedule_id] || (attByWeek[a.schedule_id] = { total: 0, present: 0, absent: 0, none: 0 });
      m.total++; if (a.present === true) m.present++; else if (a.present === false) m.absent++; else m.none++;
    });
    $("loading").classList.add("hidden"); $("tkbWrap").classList.remove("loading");
    if (error) toast("Lỗi tải lịch: " + error.message, "err");
    renderWeek();
  }

  function renderWeek() {
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
    return `<div class="m">${done ? "✅" : "📝"} Điểm danh ${m.present}/${m.total}${m.absent ? " · vắng " + m.absent : ""}</div>`;
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
    const metaLines = compact
      ? `<div class="m">${esc(name)}${s.class_name ? " · Lớp " + esc(s.class_name) : ""}</div>` + (s.room ? `<div class="m">📍 ${esc(s.room)}</div>` : "")
      : `<div class="m">${["GV: " + esc(name), s.class_name ? "Lớp " + esc(s.class_name) : "", s.room ? "📍 " + esc(s.room) : ""].filter(Boolean).join(" · ")}</div>`;
    return `<div class="mini ${done ? "att-done" : ""}">` +
      `<div class="t">${hhmm(s.start_time)}–${hhmm(s.end_time)}</div>` +
      `<div class="s">${esc(s.subject)}</div>` +
      metaLines + attSummary(s) +
      (s.note ? `<div class="m">📝 ${esc(s.note)}</div>` : "") +
      act + `</div>`;
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
      h += `<div class="day-block"><div class="dhead${t}"><span class="dname">${DOW[d.getDay()]} · ${dmy(d)}</span>` +
        (admin ? `<button class="dadd" data-add="${dy}|chieu">+ Thêm</button>` : "") + `</div><div class="dbody">`;
      if (!dayBuois.length) h += `<div class="day-empty">Chưa có lịch.</div>`;
      else dayBuois.forEach((b) => {
        h += `<div class="buoi-row"><span class="buoi-pill ${b.key}">${b.icon} ${b.label}</span><div class="buoi-items">` +
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
      ? students.map((st) => `<label class="chk-item"><input type="checkbox" data-sid="${st.id}" ${checkedIds.has(st.id) ? "checked" : ""}/> ${esc(st.full_name)}<span class="ci-sub">${esc(st.subject || "")}</span></label>`).join("")
      : '<div class="chk-empty">Chưa có học sinh — thêm ở mục “Học sinh”.</div>';

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
      const { data: existing } = await B.listAttendanceBySchedules([schedId]);
      const existingIds = new Set((existing || []).map((a) => a.student_id));
      const checkedSet = new Set(checked);
      const ops = [];
      checked.forEach((sid) => { if (!existingIds.has(sid)) ops.push(B.setAttendance(schedId, sid, null, user.id)); });
      existingIds.forEach((sid) => { if (!checkedSet.has(sid)) ops.push(B.removeAttendance(schedId, sid)); });
      await Promise.all(ops);

      closeScheduleModal();
      toast(id ? "Đã cập nhật buổi học." : "Đã thêm buổi học.", "ok");
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
  //  HỌC SINH (admin)
  // =====================================================================
  function studentProgress(st) {
    const used = presentByStudent[st.id] || 0;
    const total = st.total_sessions || 0;
    const remaining = Math.max(0, total - used);
    return { used, total, remaining, ratio: total ? Math.min(1, used / total) : 0 };
  }

  function renderStudents() {
    const q = ($("studentSearch").value || "").trim().toLowerCase();
    const list = students.filter((s) => !q || (s.full_name || "").toLowerCase().includes(q) || (s.subject || "").toLowerCase().includes(q) || (s.phone || "").includes(q));
    if (!list.length) { $("studentList").innerHTML = '<div class="empty"><div class="big">🎓</div>Chưa có học sinh nào.</div>'; return; }
    $("studentList").innerHTML = list.map((s) => {
      const p = studentProgress(s);
      const tag = s.status === "completed" || p.remaining === 0 && p.total ? '<span class="tag-done">Đã kết thúc</span>'
        : (p.remaining <= 2 && p.total ? '<span class="tag-near">Sắp kết thúc</span>' : "");
      const pcls = (p.remaining === 0 && p.total) ? "done" : (p.remaining <= 2 && p.total ? "near" : "");
      return `<div class="info-card">` +
        `<div class="ic-head"><div class="ic-avatar">${esc(initials(s.full_name))}</div>` +
        `<div class="ic-title"><div class="nm">${esc(s.full_name)} ${tag}</div><div class="sb">${esc(s.subject || "—")} · ${lessonTypeLabel(s.lesson_type)} · ${esc((teachersById[s.teacher_id] && teachersById[s.teacher_id].full_name) || "Chưa gắn GV")}</div></div>` +
        `<span class="status-pill ${s.status}">${statusLabel(s.status)}</span></div>` +
        `<div class="ic-rows">` +
          row("Buổi đã học", `${p.used}/${p.total} buổi`) +
          row("Còn lại", `${p.remaining} buổi`) +
          row("Học phí/buổi", money(s.tuition_per_session)) +
          (s.phone ? row("Điện thoại", esc(s.phone)) : "") +
          (s.guardian ? row("Phụ huynh", esc(s.guardian)) : "") +
        `</div>` +
        `<div class="progress ${pcls}"><span style="width:${Math.round(p.ratio * 100)}%"></span></div>` +
        `<div class="ic-acts"><button class="btn btn-sm" data-stedit="${s.id}">${ICON_EDIT} Sửa</button>` +
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
    if (isEdit) {
      $("smName").value = st.full_name || ""; $("smPhone").value = st.phone || ""; $("smGuardian").value = st.guardian || "";
      $("smSubject").value = st.subject || ""; sel.value = st.teacher_id || "";
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
  //  GIÁO VIÊN (admin)
  // =====================================================================
  function renderTeachers() {
    if (!teachers.length) { $("teacherList").innerHTML = '<div class="empty"><div class="big">👨‍🏫</div>Chưa có giáo viên nào.</div>'; return; }
    const linkedName = (uid) => { const p = profilesById[uid]; return p ? (p.email || p.full_name) : "—"; };
    $("teacherList").innerHTML = teachers.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi")).map((t) => {
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
  }
  async function runSalary() {
    const from = dmyToYmd($("salFrom").value), to = dmyToYmd($("salTo").value);
    if (!from || !to) return toast("Nhập khoảng ngày hợp lệ (dd/mm/yyyy).", "err");
    if (from > to) return toast("Ngày bắt đầu phải trước ngày kết thúc.", "err");
    $("salaryResult").innerHTML = '<div class="state">Đang tính…</div>';
    const { data, error } = await B.listSchedules({ from, to, teacherId: null });
    if (error) { $("salaryResult").innerHTML = '<div class="empty">Lỗi tải dữ liệu.</div>'; return; }
    const rows = {};
    teachers.forEach((t) => (rows[t.id] = { t: t, name: t.full_name, counts: {}, off: 0, planned: 0 }));
    (data || []).forEach((s) => {
      const r = rows[s.teacher_id]; if (!r) return;
      r.planned++;
      if (s.teacher_present === true) { const k = s.lesson_type || "ca_nhan"; r.counts[k] = (r.counts[k] || 0) + 1; }
      else if (s.teacher_present === false) r.off++;
    });
    const list = Object.values(rows).sort((a, b) => a.name.localeCompare(b.name, "vi"));
    let grand = 0;
    const body = list.map((r) => {
      let taught = 0, amount = 0;
      const cells = LESSON_TYPES.map((lt) => { const c = r.counts[lt.key] || 0; taught += c; amount += c * teacherPayFor(r.t, lt.key); return `<td class="num">${c}</td>`; }).join("");
      grand += amount;
      return `<tr><td>${esc(r.name)}</td>${cells}<td class="num">${taught}</td><td class="num">${r.off}</td><td class="num money total">${money(amount)}</td></tr>`;
    }).join("");
    const typeHeaders = LESSON_TYPES.map((lt) => `<th class="num">${lt.label}</th>`).join("");
    const nCols = LESSON_TYPES.length;
    $("salaryResult").innerHTML =
      `<div class="table-wrap"><table class="tbl"><thead><tr>` +
      `<th>Giáo viên</th>${typeHeaders}<th class="num">Tổng dạy</th><th class="num">Nghỉ</th><th class="num">Thành tiền</th>` +
      `</tr></thead><tbody>${body || `<tr><td colspan="${nCols + 4}" style="text-align:center;color:var(--muted)">Không có dữ liệu.</td></tr>`}</tbody>` +
      `<tfoot><tr><td colspan="${nCols + 3}">TỔNG CHI LƯƠNG</td><td class="num money total">${money(grand)}</td></tr></tfoot></table></div>`;
  }

  // Xuất PDF bảng lương (mở cửa sổ in -> Lưu thành PDF)
  async function exportSalaryPDF() {
    const from = dmyToYmd($("salFrom").value), to = dmyToYmd($("salTo").value);
    if (!from || !to) return toast("Nhập khoảng ngày hợp lệ (dd/mm/yyyy).", "err");
    if (from > to) return toast("Ngày bắt đầu phải trước ngày kết thúc.", "err");
    const { data, error } = await B.listSchedules({ from, to, teacherId: null });
    if (error) return toast("Lỗi tải dữ liệu: " + error.message, "err");
    const taught = (data || []).filter((s) => s.teacher_present === true);
    const byT = {};
    taught.forEach((s) => { (byT[s.teacher_id] = byT[s.teacher_id] || []).push(s); });

    const perT = teachers.slice().sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "vi")).map((t) => {
      const ss = (byT[t.id] || []).slice().sort((a, b) => (a.schedule_date + a.start_time).localeCompare(b.schedule_date + b.start_time));
      const counts = {}; let amt = 0;
      ss.forEach((s) => { const k = s.lesson_type || "ca_nhan"; counts[k] = (counts[k] || 0) + 1; amt += teacherPayFor(t, k); });
      return { t: t, ss: ss, counts: counts, amt: amt };
    });
    const grand = perT.reduce((g, x) => g + x.amt, 0);
    const now = new Date();

    const typeHead = LESSON_TYPES.map((lt) => `<th class="num">${lt.label}</th>`).join("");
    const summaryRows = perT.map((x) => {
      const cells = LESSON_TYPES.map((lt) => `<td class="num">${x.counts[lt.key] || 0}</td>`).join("");
      return `<tr><td>${esc(x.t.full_name)}</td>${cells}<td class="num">${x.ss.length}</td><td class="num">${money(x.amt)}</td></tr>`;
    }).join("");

    const sections = perT.filter((x) => x.ss.length).map((x) => {
      const rows = x.ss.map((s) => {
        const d = parseYmd(s.schedule_date);
        return `<tr><td>${dmy(d)}</td><td>${DOW[d.getDay()]}</td><td>${hhmm(s.start_time)}–${hhmm(s.end_time)}</td>` +
          `<td>${esc(s.subject)}</td><td>${esc(s.class_name || "")}</td><td>${lessonTypeLabel(s.lesson_type)}</td>` +
          `<td class="num">${money(teacherPayFor(x.t, s.lesson_type || "ca_nhan"))}</td></tr>`;
      }).join("");
      const meta = [x.t.specialty ? "Chuyên môn: " + esc(x.t.specialty) : "", "Tổng buổi dạy: " + x.ss.length].filter(Boolean).join(" · ");
      return `<div class="section"><h2 class="t-name">${esc(x.t.full_name)}</h2><div class="t-meta">${meta}</div>` +
        `<table><thead><tr><th>Ngày</th><th>Thứ</th><th>Giờ</th><th>Môn</th><th>Lớp</th><th>Loại lớp</th><th class="num">Đơn giá</th></tr></thead>` +
        `<tbody>${rows}</tbody></table><div class="subtotal">Cộng lương <b>${esc(x.t.full_name)}</b>: ${money(x.amt)}</div></div>`;
    }).join("");

    const logo = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M9 18V5l12-2v13"/><path d="M9 9l12-2"/></svg>';
    const css = "*{box-sizing:border-box;}html,body{background:#fff;}body{font-family:'Segoe UI',-apple-system,Roboto,Arial,sans-serif;color:#111;margin:0;padding:22px;font-size:12.5px;}" +
      ".doc-head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #333;padding-bottom:12px;}" +
      ".doc-logo{width:46px;height:46px;border-radius:10px;background:#6d63ff;display:grid;place-items:center;flex-shrink:0;}.doc-logo svg{width:26px;height:26px;}" +
      ".center-name{font-size:15px;font-weight:800;letter-spacing:.3px;}.center-sub{font-size:11px;color:#666;}" +
      "h1.report-title{text-align:center;font-size:18px;margin:14px 0 2px;text-transform:uppercase;}" +
      ".report-range{text-align:center;font-size:12.5px;color:#333;}.report-gen{text-align:center;font-size:10.5px;color:#888;margin-bottom:16px;}" +
      "table{width:100%;border-collapse:collapse;margin-bottom:6px;}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;}" +
      "th{background:#eef0fb;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;}td.num,th.num{text-align:right;white-space:nowrap;}" +
      "tfoot td{font-weight:800;background:#f6f6fa;}h2.section-title{font-size:14px;margin:18px 0 6px;}" +
      "h2.t-name{font-size:13.5px;margin:16px 0 4px;padding:6px 10px;background:#eef0fb;border-left:4px solid #6d63ff;}" +
      ".t-meta{font-size:11px;color:#555;margin-bottom:6px;}.subtotal{text-align:right;font-size:12.5px;margin:4px 0 2px;}" +
      ".grand{margin-top:16px;padding:11px 14px;background:#eef0fb;border:1px solid #c9c9e6;border-radius:8px;font-size:14.5px;font-weight:800;display:flex;justify-content:space-between;}" +
      ".sign-row{display:flex;justify-content:space-around;margin-top:34px;text-align:center;font-size:12px;}.sign-row .col{width:45%;}" +
      ".sign-row .role{font-weight:700;}.sign-row .hint{font-size:10px;color:#888;font-style:italic;}.sign-row .space{height:58px;}" +
      ".section{page-break-inside:avoid;}@page{size:A4;margin:14mm;}";
    const html = "<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Bảng lương OPENMUSIC</title><style>" + css + "</style></head><body>" +
      "<div class='doc-head'><div class='doc-logo'>" + logo + "</div><div><div class='center-name'>TRUNG TÂM NGHỆ THUẬT OPENMUSIC</div><div class='center-sub'>Bảng kê lương giáo viên theo buổi dạy</div></div></div>" +
      "<h1 class='report-title'>Bảng tính lương giáo viên</h1>" +
      "<div class='report-range'>Kỳ lương: từ <b>" + dmy(parseYmd(from)) + "</b> đến <b>" + dmy(parseYmd(to)) + "</b></div>" +
      "<div class='report-gen'>Lập lúc " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0") + " ngày " + dmy(now) + "</div>" +
      "<h2 class='section-title'>1. Tổng hợp</h2>" +
      "<table><thead><tr><th>Giáo viên</th>" + typeHead + "<th class='num'>Tổng buổi</th><th class='num'>Thành tiền</th></tr></thead>" +
      "<tbody>" + summaryRows + "</tbody>" +
      "<tfoot><tr><td colspan='" + (LESSON_TYPES.length + 2) + "'>TỔNG CHI LƯƠNG</td><td class='num'>" + money(grand) + "</td></tr></tfoot></table>" +
      "<div class='grand'><span>TỔNG CHI LƯƠNG KỲ NÀY</span><span>" + money(grand) + "</span></div>" +
      (sections ? "<h2 class='section-title'>2. Chi tiết buổi dạy</h2>" + sections : "") +
      "<div class='sign-row'><div class='col'><div class='role'>NGƯỜI LẬP BẢNG</div><div class='hint'>(Ký, ghi rõ họ tên)</div><div class='space'></div></div>" +
      "<div class='col'><div class='role'>GIÁM ĐỐC TRUNG TÂM</div><div class='hint'>(Ký, ghi rõ họ tên)</div><div class='space'></div></div></div>" +
      "<scr" + "ipt>window.onload=function(){setTimeout(function(){window.print();},300);};</scr" + "ipt>" +
      "</body></html>";

    const w = window.open("", "_blank");
    if (!w) { toast("Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi thử lại.", "err"); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // =====================================================================
  //  HỌC PHÍ HỌC SINH (admin)
  // =====================================================================
  function renderTuition() {
    const q = ($("tuitionSearch").value || "").trim().toLowerCase();
    const list = students.filter((s) => !q || (s.full_name || "").toLowerCase().includes(q) || (s.subject || "").toLowerCase().includes(q));
    if (!list.length) { $("tuitionResult").innerHTML = '<div class="empty"><div class="big">🧮</div>Chưa có học sinh.</div>'; return; }
    let totalCollected = 0, totalCourse = 0;
    const body = list.map((s) => {
      const p = studentProgress(s);
      const collected = p.used * (s.tuition_per_session || 0);
      const courseFee = p.total * (s.tuition_per_session || 0);
      totalCollected += collected; totalCourse += courseFee;
      const tag = (p.remaining === 0 && p.total) || s.status === "completed" ? '<span class="tag-done">Đã KT</span>'
        : (p.remaining <= 2 && p.total ? '<span class="tag-near">Sắp KT</span>' : "");
      return `<tr><td>${esc(s.full_name)} ${tag}</td><td>${esc(s.subject || "—")}</td><td><span class="lt-badge">${lessonTypeLabel(s.lesson_type)}</span></td>` +
        `<td class="num">${p.used}/${p.total}</td><td class="num">${p.remaining}</td>` +
        `<td class="num">${money(s.tuition_per_session)}</td><td class="num money">${money(courseFee)}</td>` +
        `<td class="num money total">${money(collected)}</td></tr>`;
    }).join("");
    $("tuitionResult").innerHTML =
      `<div class="table-wrap"><table class="tbl"><thead><tr>` +
      `<th>Học sinh</th><th>Môn</th><th>Loại</th><th class="num">Đã học</th><th class="num">Còn lại</th><th class="num">HP/buổi</th><th class="num">HP cả khóa</th><th class="num">Thực thu</th>` +
      `</tr></thead><tbody>${body}</tbody>` +
      `<tfoot><tr><td colspan="6">TỔNG</td><td class="num money">${money(totalCourse)}</td><td class="num money total">${money(totalCollected)}</td></tr></tfoot></table></div>`;
  }
  function exportTuitionCSV() {
    const rows = [["Học sinh", "Môn", "Loại lớp", "Đã học", "Tổng buổi", "Còn lại", "HP mỗi buổi", "HP cả khóa", "Thực thu", "Trạng thái"]];
    students.forEach((s) => {
      const p = studentProgress(s);
      rows.push([s.full_name, s.subject || "", lessonTypeLabel(s.lesson_type), p.used, p.total, p.remaining, s.tuition_per_session || 0, p.total * (s.tuition_per_session || 0), p.used * (s.tuition_per_session || 0), statusLabel(s.status)]);
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
        `<div class="ic-title"><div class="nm">${esc(s.full_name)} ${done ? '<span class="tag-done">Đã kết thúc khóa</span>' : '<span class="tag-near">Còn ' + p.remaining + ' buổi</span>'}</div>` +
        `<div class="sb">${esc(s.subject || "")} · đã học ${p.used}/${p.total} buổi · ${esc((teachersById[s.teacher_id] && teachersById[s.teacher_id].full_name) || "")}</div></div></div></div>`;
    }).join("") : '<div class="empty">Chưa có khóa nào sắp kết thúc.</div>';

    updateNotifyBadge(scheds, now, alerts.length);
  }
  function fmtMins(m) { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h${mm ? mm + "p" : ""}` : `${mm} phút`; }

  function updateNotifyBadge(scheds, now, courseAlerts) {
    const upcoming = (scheds || []).filter((s) => new Date(`${s.schedule_date}T${s.start_time}`) > now).length;
    const n = upcoming + (courseAlerts || 0);
    const b = $("notifyBadge");
    if (n > 0) { b.hidden = false; b.textContent = n; } else b.hidden = true;
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
      bar.innerHTML = `🔔 Sắp tới: <b>${hhmm(next.s.start_time)} · ${esc(next.s.subject)}</b> (${esc(teacherDisplay(next.s))})${next.s.room ? " · 📍 " + esc(next.s.room) : ""} — còn ${fmtMins(next.mins)} <button class="rb-x" title="Ẩn">×</button>`;
    } else bar.classList.add("hidden");
  }
  function fireReminder(s, mins) {
    toast(`🔔 Sắp tới: ${hhmm(s.start_time)} ${s.subject} — còn ${fmtMins(mins)}`, "ok");
    if (window.Notification && Notification.permission === "granted") {
      try { new Notification("OPENMUSIC — Sắp đến giờ lớp", { body: `${hhmm(s.start_time)} · ${s.subject} (${teacherDisplay(s)})${s.room ? " · " + s.room : ""}\nCòn ${fmtMins(mins)} nữa.` }); } catch (e) {}
    }
  }

  // =====================================================================
  //  CÀI ĐẶT
  // =====================================================================
  function initSettingsUI() {
    $("leadMin").value = getLeadMin();
    if (window.Notification) $("notifPerm").checked = Notification.permission === "granted";
  }
  function renderPricing() {
    const dp = settings.default_pay || {}, dt = settings.default_tuition || {};
    $("pricingBody").innerHTML = LESSON_TYPES.map((t) =>
      `<div class="price-row"><div class="pr-type">${t.label}</div>` +
      `<label class="pr-field"><span>Lương GV/buổi</span><input type="number" min="0" step="1000" data-dp="${t.key}" value="${Number(dp[t.key]) || 0}" /></label>` +
      `<label class="pr-field"><span>Học phí HS/buổi</span><input type="number" min="0" step="1000" data-dt="${t.key}" value="${Number(dt[t.key]) || 0}" /></label>` +
      `</div>`
    ).join("");
  }
  function renderSettings() { initSettingsUI(); renderPricing(); }
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
  function openSidebar() { $("sidebar").classList.add("open"); $("scrim").hidden = false; }
  function closeSidebar() { $("sidebar").classList.remove("open"); $("scrim").hidden = true; }

  function closeAllModals() { ["modal", "studentModal", "teacherModal"].forEach((id) => $(id).classList.add("hidden")); }

  // =====================================================================
  //  GẮN SỰ KIỆN
  // =====================================================================
  function wireEvents() {
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
    $("logoutBtn").addEventListener("click", async () => { await B.signOut(); });

    // Menu tài khoản (admin xem lịch GV khác)
    $("accountBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleAccountMenu(); });
    $("accountMenu").addEventListener("click", (e) => {
      const it = e.target.closest("[data-amteacher]");
      if (it) viewTeacherSchedule(it.getAttribute("data-amteacher"));
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".account-wrap")) closeAccountMenu(); });

    // Menu / sidebar
    $("menu").addEventListener("click", (e) => { const b = e.target.closest(".menu-item"); if (b) switchView(b.getAttribute("data-view")); });
    $("menuBtn").addEventListener("click", openSidebar);
    $("scrim").addEventListener("click", closeSidebar);
    $("sidebarToggle").addEventListener("click", toggleSidebarCollapse);

    // Reminder bar đóng
    $("reminderBar").addEventListener("click", (e) => { if (e.target.classList.contains("rb-x")) $("reminderBar").classList.add("hidden"); });

    // Lịch tuần — điều hướng
    document.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => { const [k, d] = btn.getAttribute("data-nav").split(":"); navigate(k, parseInt(d, 10)); }));
    $("datePicker").addEventListener("change", () => { const y = dmyToYmd($("datePicker").value); if (y) setViewDate(parseYmd(y)); });
    $("todayBtn").addEventListener("click", () => setViewDate(startOfToday()));
    $("teacherFilter").addEventListener("change", () => { loadWeek(); });
    $("addBtn").addEventListener("click", () => openScheduleModal(null, ymd(viewDate), buoiOf(new Date().toTimeString())));

    // Lịch tuần — click vào ô (sửa/xóa/thêm)
    $("tkbWrap").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-edit]"), de = e.target.closest("[data-del]"), ad = e.target.closest("[data-add]");
      if (ed) { const s = allForWeek.find((x) => x.id === ed.getAttribute("data-edit")); if (s) openScheduleModal(s); }
      else if (de) deleteSchedule(de.getAttribute("data-del"));
      else if (ad) { const [d, b] = ad.getAttribute("data-add").split("|"); openScheduleModal(null, d, b); }
    });

    // Hôm nay — điểm danh
    $("todayList").addEventListener("click", (e) => {
      const att = e.target.closest("[data-att]"), tp = e.target.closest("[data-tpv]"), rm = e.target.closest("[data-attrm]");
      if (att) { const [sid, stid, v] = att.getAttribute("data-att").split("|"); markStudent(sid, stid, v === "1"); }
      else if (tp) { const wrap = tp.closest("[data-tp]"); markTeacher(wrap.getAttribute("data-tp"), tp.getAttribute("data-tpv") === "1"); }
      else if (rm) { const [sid, stid] = rm.getAttribute("data-attrm").split("|"); removeStudentFromClass(sid, stid); }
    });
    $("todayList").addEventListener("change", (e) => {
      const sel = e.target.closest("[data-addsel]");
      if (sel) { addStudentToClass(sel.getAttribute("data-addsel"), sel.value); }
    });
    // Hôm nay — điều hướng ngày điểm danh
    document.querySelectorAll("[data-attnav]").forEach((btn) =>
      btn.addEventListener("click", () => setAttDate(addDays(attDate, parseInt(btn.getAttribute("data-attnav"), 10)))));
    $("attTodayBtn").addEventListener("click", () => setAttDate(startOfToday()));
    $("attDatePicker").addEventListener("change", () => { const y = dmyToYmd($("attDatePicker").value); if (y) setAttDate(parseYmd(y)); });

    // Modal buổi học
    $("modalClose").addEventListener("click", closeScheduleModal);
    $("modalCancel").addEventListener("click", closeScheduleModal);
    $("modalSave").addEventListener("click", saveSchedule);
    $("scheduleForm").addEventListener("submit", (e) => { e.preventDefault(); saveSchedule(); });
    $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeScheduleModal(); });

    // Học sinh
    $("addStudentBtn").addEventListener("click", () => openStudentModal(null));
    $("studentSearch").addEventListener("input", renderStudents);
    $("studentList").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-stedit]"), de = e.target.closest("[data-stdel]");
      if (ed) openStudentModal(studentsById[ed.getAttribute("data-stedit")]);
      else if (de) deleteStudent(de.getAttribute("data-stdel"));
    });
    $("smClose").addEventListener("click", closeStudentModal);
    $("smCancel").addEventListener("click", closeStudentModal);
    $("smSave").addEventListener("click", saveStudent);
    $("studentForm").addEventListener("submit", (e) => { e.preventDefault(); saveStudent(); });
    $("studentModal").addEventListener("click", (e) => { if (e.target === $("studentModal")) closeStudentModal(); });

    // Giáo viên
    $("addTeacherBtn").addEventListener("click", () => openTeacherModal(null));
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
    $("salPdf").addEventListener("click", exportSalaryPDF);

    // Học phí
    $("tuitionSearch").addEventListener("input", renderTuition);
    $("tuitionExport").addEventListener("click", exportTuitionCSV);

    // Cài đặt
    $("leadMin").addEventListener("change", () => { let v = parseInt($("leadMin").value, 10); if (isNaN(v) || v < 0) v = 0; setLeadMin(v); remindedIds = new Set(); toast("Đã lưu: nhắc trước " + v + " phút.", "ok"); });
    $("notifPerm").addEventListener("change", async () => {
      if ($("notifPerm").checked && window.Notification) {
        const perm = await Notification.requestPermission();
        $("notifPerm").checked = perm === "granted";
        if (perm !== "granted") toast("Trình duyệt chưa cho phép thông báo.", "err");
      }
    });
    $("testNotify").addEventListener("click", () => { fireReminder({ start_time: "00:00", subject: "Thử thông báo", teacher_name: "OPENMUSIC", room: "" }, 0); });
    $("resetDemo").addEventListener("click", () => { if (confirm("Đặt lại toàn bộ dữ liệu DEMO về ban đầu?")) { if (B.resetDemo) B.resetDemo(); location.reload(); } });
    $("savePricing").addEventListener("click", savePricing);
    // Tự điền học phí theo bảng giá khi đổi loại lớp (chỉ khi đang THÊM mới)
    $("smLessonType").addEventListener("change", () => { if (!$("smId").value) { const d = defaultTuition($("smLessonType").value); if (d) $("smFee").value = d; } });

    // Mask ngày/giờ + nút lịch
    ["fDate", "datePicker", "smStart", "salFrom", "salTo", "attDatePicker", "tmDob", "tmHire"].forEach((id) => maskDate($(id)));
    ["fStart", "fEnd"].forEach((id) => maskTime($(id)));
    document.querySelectorAll(".cal-btn").forEach(wireCal);

    // ESC đóng modal/sidebar
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("accountMenu").classList.contains("hidden")) closeAccountMenu();
      else if (!$("modal").classList.contains("hidden")) closeScheduleModal();
      else if (!$("studentModal").classList.contains("hidden")) closeStudentModal();
      else if (!$("teacherModal").classList.contains("hidden")) closeTeacherModal();
      else if ($("sidebar").classList.contains("open")) closeSidebar();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
