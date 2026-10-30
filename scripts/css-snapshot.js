// TẠM — đo style tính toán để so trước/sau khi dọn CSS (không commit; nằm trong .git/info/exclude)
const PROPS = ["display","position","visibility","opacity","color","background-color","background-image","border-top-color","border-top-width","border-left-color","border-left-width","border-radius",
  "padding-top","padding-right","padding-bottom","padding-left","margin-top","margin-bottom","margin-left","font-size","font-weight","line-height","letter-spacing","text-transform",
  "width","height","box-shadow","backdrop-filter","-webkit-backdrop-filter","filter","gap","grid-template-columns","flex-direction","flex-wrap","justify-content","align-items",
  "z-index","text-align","overflow","transform","white-space","cursor"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pathOf = (el) => { const p = []; while (el && el !== document.documentElement) { const i = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0; p.unshift(el.tagName + (el.id ? "#" + el.id : "") + ":" + i); el = el.parentElement; } return p.join(">"); };
const snap = (out, key, root) => {
  root.querySelectorAll("*").forEach((el) => {
    if (el.closest("script,style,head,#splash")) return;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
    const cs = getComputedStyle(el);
    // thanh tab: transform do JS/hoạt ảnh (viên nền trượt, icon nảy) quyết định -> không phải CSS, bỏ khỏi phép so
    const inTab = !!el.closest("#tabbar");
    out[key + "|" + pathOf(el)] = PROPS.map((k) => (inTab && k === "transform") ? "-" : cs.getPropertyValue(k)).join("¦");
  });
};
const view = async (v) => { const b = document.querySelector(`.menu-item[data-view="${v}"]`); if (b) b.click(); await wait(800); };
const click = async (sel) => { const el = document.querySelector(sel); if (el) el.click(); await wait(600); return !!el; };
const closeAll = async () => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden")); document.getElementById("sidebar").classList.remove("open"); const s = document.getElementById("scrim"); if (s) s.hidden = true; await wait(300); };

export async function capture(label) {
  const out = {}, missed = [];
  for (const theme of ["light", "dark"]) {
    document.documentElement.setAttribute("data-theme", theme);
    for (const v of ["today", "schedule", "students", "trials", "teachers", "tuition", "settings"]) { await view(v); snap(out, theme + "|" + v, document.body); }
    // popup / menu / dialog
    const popups = [
      ["notify", async () => { await view("today"); return click("#notificationsBtn"); }, "#notificationsDialog"],
      ["sidebar", async () => { await view("today"); return click("#tabMore"); }, "#sidebar"],
      ["trial", async () => { await view("trials"); return click("#addTrialBtn"); }, "#trialModal"],
      ["course", async () => { await view("students"); return click("[data-stcourse]"); }, "#courseModal"],
      ["student", async () => { await view("students"); return click("#addStudentBtn"); }, "#studentModal"],
      ["payment", async () => { await view("students"); return click("[data-stpay]"); }, "#paymentModal"],
      ["schedule", async () => { await view("schedule"); return click("#addBtn"); }, "#modal"],
      ["teacher", async () => { await view("teachers"); return click("#addTeacherBtn"); }, "#teacherModal"],
      ["search", async () => { await view("students"); return click("#pageSearchBtn"); }, "#pageSearchDialog"],
    ];
    for (const [name, open, sel] of popups) {
      const ok = await open(); await wait(400);
      const root = document.querySelector(sel);
      if (!ok || !root) { missed.push(theme + ":" + name); await closeAll(); continue; }
      out[theme + "|pop-" + name + "|ROOT"] = PROPS.map((k) => getComputedStyle(root).getPropertyValue(k)).join("¦");
      snap(out, theme + "|pop-" + name, root);
      await closeAll();
    }
  }
  document.documentElement.setAttribute("data-theme", "light");
  await view("today");
  localStorage.setItem("__css_" + label, JSON.stringify(out));
  return { label, elements: Object.keys(out).length, missed };
}
export function compare() {
  const a = JSON.parse(localStorage.getItem("__css_before") || "{}"), b = JSON.parse(localStorage.getItem("__css_after") || "{}");
  const diffs = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    if (!a[k] || !b[k]) { diffs.push({ k: k.slice(0, 160), change: a[k] ? "mất" : "thêm" }); continue; }
    const x = a[k].split("¦"), y = b[k].split("¦");
    diffs.push({ k: k.slice(0, 160), props: PROPS.map((p, i) => x[i] !== y[i] ? p + ": " + x[i] + " → " + y[i] : null).filter(Boolean) });
  }
  return { before: Object.keys(a).length, after: Object.keys(b).length, diffCount: diffs.length, sample: diffs.slice(0, 20) };
}
