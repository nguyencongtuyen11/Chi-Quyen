// =====================================================================
//  Build web cho MỘT trung tâm vào thư mục dist/ (Vercel: Build Command
//  "node scripts/build-center.cjs <id>", Output Directory "dist").
//  - Chỉ chép file web cần thiết (không lộ tests/, scripts/, supabase/, *.md…)
//  - Thay tên thương hiệu OPENMUSIC -> tên trung tâm, thay config.js (Supabase riêng)
//  - Logo/ảnh: file trong centers/<id>/assets/ đè lên logo mặc định
//  Trung tâm OPENMUSIC gốc KHÔNG dùng script này (Vercel phục vụ thẳng thư mục gốc).
// =====================================================================
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const id = process.argv[2] || process.env.CENTER;
if (!id) { console.error("Thiếu mã trung tâm: node scripts/build-center.cjs <id>"); process.exit(1); }
const centerDir = path.join(root, "centers", id);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const center = readJson(path.join(centerDir, "center.json"));
for (const k of ["supabaseUrl", "supabaseAnonKey", "shortName", "fullName"]) {
  if (!center[k]) { console.error(`centers/${id}/center.json thiếu "${k}"`); process.exit(1); }
}

const out = path.join(root, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// file web được phục vụ (giống danh sách SHELL của sw.js + ảnh)
const files = fs.readdirSync(root).filter((f) => /\.(html|css|js|png|svg|webmanifest|ico)$/i.test(f) && fs.statSync(path.join(root, f)).isFile());
const dirs = ["vendor"];
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const d of dirs) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });

// thay thương hiệu — thứ tự quan trọng: cụm dài trước, cụm ngắn sau
const upper = (s) => s.toLocaleUpperCase("vi-VN");
const brandHtml = center.brandHtml || center.shortName;
const swaps = [
  ["TRUNG TÂM NGHỆ THUẬT OPENMUSIC", upper(center.fullName)],
  ["Trung tâm Nghệ thuật OPENMUSIC", center.fullName],
  ["Quản lý Trung tâm OPENMUSIC", "Quản lý " + center.fullName],
  ["OPEN<span>MUSIC</span>", brandHtml],
  ["<p>Trung tâm Nghệ thuật</p>", `<p>${center.tagline || center.fullName}</p>`],
  ["OpenMusic", center.shortName],
  ["OPENMUSIC", center.shortName],
];
const brandFiles = ["index.html", "app.js", "sw.js", "manifest.webmanifest"];
for (const f of brandFiles) {
  const p = path.join(out, f);
  let s = fs.readFileSync(p, "utf8");
  for (const [a, b] of swaps) s = s.split(a).join(b);
  if (f === "sw.js") s = s.replace(/const VERSION = "([^"]+)"/, (_, v) => `const VERSION = "${id}-${v}"`);
  if (f === "manifest.webmanifest" && center.themeColor) s = s.replace(/"(background_color|theme_color)":\s*"#[0-9a-fA-F]{3,8}"/g, `"$1": "${center.themeColor}"`);
  fs.writeFileSync(p, s);
}

// Supabase riêng của trung tâm
fs.writeFileSync(path.join(out, "config.js"),
  `// Cấu hình trung tâm "${center.fullName}" — sinh tự động từ centers/${id}/center.json (đừng sửa tay)\n` +
  `window.APP_CONFIG = ${JSON.stringify({ SUPABASE_URL: center.supabaseUrl, SUPABASE_ANON_KEY: center.supabaseAnonKey }, null, 2)};\n`);

// logo/ảnh riêng đè lên ảnh mặc định
const assets = path.join(centerDir, "assets");
let nAssets = 0;
if (fs.existsSync(assets)) for (const f of fs.readdirSync(assets)) { fs.copyFileSync(path.join(assets, f), path.join(out, f)); nAssets++; }

// kiểm tra: không còn sót tên OPENMUSIC trong phần người dùng nhìn thấy
const left = brandFiles.filter((f) => /OPENMUSIC/.test(fs.readFileSync(path.join(out, f), "utf8").replace(/\[OPENMUSIC load\]/g, "")));
console.log(`Đã build "${center.fullName}" (${id}) -> dist/: ${files.length} file, ${nAssets} ảnh riêng${left.length ? " — CÒN SÓT OPENMUSIC: " + left.join(", ") : ""}`);
