# Giao diện Liquid Glass — hướng dẫn dùng lại & giữ nhẹ

Giao diện OPENMUSIC / Si Music là HTML + CSS + JS thuần, không framework.
Tải về (nén): CSS ≈ 20 KB, JS ≈ 57 KB, HTML ≈ 9 KB.

## Cấu trúc file

| File | Vai trò |
|---|---|
| `tokens.css` | **Bảng màu & kích thước** (biến CSS) cho giao diện sáng và tối. Đổi màu cả app = sửa file này. |
| `styles.css` | Thành phần & trang. **Chỉ dùng biến** từ `tokens.css`, không tự đặt màu chủ đạo. |
| `centers/<id>/center.json` | Thương hiệu từng trung tâm: tên, Supabase, mục `theme` (màu ghi đè), ảnh trong `assets/`. |
| `scripts/build-center.cjs` | Build web cho 1 trung tâm vào `dist/` (thay tên, logo, màu, cấu hình). |

## Các biến chính (tokens.css)

| Nhóm | Biến |
|---|---|
| Nền | `--bg`, `--bg-soft`, `--amb-1..3` (nền chuyển màu), `--orb-a..c` (quầng màu mờ) |
| Bề mặt | `--card` (thẻ, hơi trong), `--card-2`, `--card-solid` (popup, menu — đặc), `--glass`, `--glass-border` |
| Chữ | `--text`, `--muted`, `--muted-2` |
| Màu chủ đạo | `--primary`, `--primary-d`, `--primary-press`, `--primary-grad` (nút chính, ngày đang chọn) |
| Ý nghĩa | `--good` (có mặt), `--warn` (sắp hết / muộn), `--bad` (vắng / nợ); `--sang-*`, `--chieu-*`, `--toi-*` (buổi sáng/chiều/tối) |
| Khác | `--border`, `--shadow`, `--shadow-sm`, `--blur`, `--info-bg` |

Giữ nguyên màu **ý nghĩa** (xanh lá = có mặt, đỏ = vắng…) khi đổi thương hiệu — người dùng quen đọc theo màu.

## 3 quy tắc để giao diện luôn nhẹ (đặc biệt trên iPhone)

1. **Kính mờ (`backdrop-filter`) chỉ cho vài mảng CỐ ĐỊNH**: thanh tab, thanh trên cùng, dải chọn ngày, popup/menu.
   Không bao giờ cho thẻ, nút, ô nhập **lặp lại** trong danh sách (đo thực tế: 762 lớp kính trên trang Học sinh làm iPhone giật, đổi trang 2,4 s).
   Thẻ/nút dùng nền `--card` / `--card-solid` hơi trong thay vì làm mờ nền phía sau. Khuyến nghị chung: ≤ 3–5 vùng kính cùng lúc trên điện thoại.
2. **Chuyển động chỉ dùng `transform` và `opacity`** (viên nền thanh tab, trang trượt lên, màn chờ nốt nhạc).
   Không dùng View Transitions để đổi trang (chụp cả trang — rất nặng với danh sách dài), không animate `width/height/top/left` trên danh sách.
3. **Luôn có đường lui**: `@media (prefers-reduced-transparency: reduce)` → nền đặc; `@media (prefers-reduced-motion: reduce)` → tắt hiệu ứng;
   `@supports not (backdrop-filter…)` → nền đặc.

## Đổi màu cho một trung tâm mới

Không sửa `tokens.css`. Trong `centers/<id>/center.json` thêm mục `theme`:

```json
"theme": {
  "chrome": { "light": "#f4eee1", "dark": "#16120a" },
  "light": { "--primary": "#9a7420", "--primary-grad": "linear-gradient(145deg, #c9a54d, #a5802a 62%, #82621a)", "--bg": "#f4eee1" },
  "dark":  { "--primary": "#b08a36", "--bg": "#16120a" },
  "cssSwaps": [["rgba(43,104,91", "rgba(120,90,30"]]
}
```

- `chrome`: màu thanh trạng thái iPhone & nền lúc mở app.
- `light` / `dark`: chỉ cần ghi biến muốn đổi; biến không ghi giữ nguyên.
- `cssSwaps`: thay vài màu còn ghi cứng trong `styles.css` (bóng thanh tab, nền mờ popup, hình khóa sol).
- Màu nút chính phải đủ sẫm để **chữ trắng** trên nút dễ đọc (tương phản ≥ 3:1).

Ví dụ đầy đủ: `centers/chi-luyen/center.json` (Si Music — vàng gold).

## Mang sang nền tảng khác

- **Web khác**: chép `tokens.css` + các phần cần của `styles.css` (thẻ `.info-card`, nút `.btn`, thanh tab `.tabbar/.tab/.tab-pill`, popup `.modal`…), giữ 3 quy tắc trên.
- **App native (iOS/Android/Flutter)**: dùng lại **tokens** (màu, bo góc, khoảng cách), còn kính mờ thì dùng vật liệu có sẵn của hệ điều hành
  (ví dụ iOS `.ultraThinMaterial`) — đã được tối ưu, nhẹ hơn tự làm mờ.

## Kiểm tra khi sửa CSS lớn

Script: `scripts/css-snapshot.js` (mở app ở chế độ demo `?demo=1` rồi `const m = await import('/scripts/css-snapshot.js'); await m.capture('before')` … sửa / thay file CSS … `await m.capture('after'); m.compare()`).

Đã dùng phép so "style tính toán" (4.128 phần tử: 7 trang + 9 popup × sáng/tối) **trong cùng một lần mở trang**
(chỉ thay file CSS) — so khác lần mở/khung xem khác sẽ ra sai lệch dưới 1 px do độ phóng màn hình, không phải do CSS.
