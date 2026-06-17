// =====================================================================
//  CẤU HÌNH SUPABASE — OPENMUSIC
//  Điền 2 giá trị bên dưới khi đã có Supabase (lấy ở:
//    Supabase Dashboard -> Project Settings -> Data API / API Keys)
//    - SUPABASE_URL      : "Project URL"        (vd: https://abcxyz.supabase.co)
//    - SUPABASE_ANON_KEY : "anon / public key"  (chuỗi rất dài, bắt đầu bằng eyJ...)
//
//  Lưu ý: anon key được phép công khai trên trình duyệt — bảo mật thật sự
//  nằm ở Row Level Security (RLS) trong file supabase-setup.sql.
//
//  >>> CHƯA ĐIỀN? App tự chạy CHẾ ĐỘ DEMO (dữ liệu lưu trên trình duyệt)
//      để bạn dùng thử ngay. Khi điền đúng URL + KEY, app tự chuyển sang Supabase.
// =====================================================================

window.APP_CONFIG = {
  SUPABASE_URL: "https://ivilqvnljoucbsxzdvwf.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aWxxdm5sam91Y2JzeHpkdndmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MDMxOTAsImV4cCI6MjA5NzI3OTE5MH0.J9t-Up3Ws7EVfmTxNDdBUvKMWeCQkwdJXxPfHzLa4-U",
};
