// =====================================================================
//  sw.js — Service Worker cho PWA OPENMUSIC
//  - Code app (HTML/JS/CSS): NETWORK-FIRST → luôn lấy bản mới nhất sau mỗi
//    lần deploy Vercel; chỉ dùng bản cache khi mất mạng.
//  - Ảnh/icon/font: CACHE-FIRST (ít thay đổi, tải nhanh).
//  - Request tới Supabase (khác domain, dữ liệu thật) KHÔNG bao giờ cache.
//  Đổi số VERSION khi muốn xoá sạch cache cũ trên máy người dùng.
// =====================================================================
const VERSION = "om-v4-startup";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "treble-clef.svg",
  "app.js",
  "backend.js",
  "vendor/supabase-2.118.0.js",
  "config.js",
  "manifest.webmanifest",
  "favicon.png",
  "apple-touch-icon.png",
  "logo-192.png",
  "logo-512.png",
  "logo-icon.png",
  "logo-wordmark.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStatic(url) {
  return /\.(png|jpe?g|svg|webp|ico|woff2?)$/i.test(url.pathname) || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return; // Supabase, CDN thư viện... -> để trình duyệt tự xử lý

  if (isStatic(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Network-first cho trang + code
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: req.mode === "navigate" })
        .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
        .then((hit) => hit || Response.error())
    )
  );
});
