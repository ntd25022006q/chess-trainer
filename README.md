# ♟️ Chess.com 1:1 Game Review Engine & Chess Trainer (DeepChess Pro Max)

Ứng dụng phân tích ván đấu cờ vua chuẩn **1:1 Chess.com** độc lập, tích hợp engine **Stockfish 16 (NNUE)**, thuật toán **CAPS2 WinDrop**, bộ đánh giá thế trận **PeSTO Quiescence** và hỗ trợ nạp trực tiếp link ván đấu từ **Chess.com** hoặc **Lichess**.

---

## 🌟 Tính Năng Nổi Bật (Chuẩn 1:1 Chess.com)

### 1. 🎯 Phân Loại Nước Đi 10 Hạng Mục Chính Thức (10-Tier Parity)
1. **Thiên tài (`!!`, `#06b6d4`)**: Đòn thí quân thực thụ (kể cả thí đổi chất Xe lấy Mã/Tượng) giữ vững thế trận thắng hoặc áp đảo.
2. **Tuyệt (`!`, `#38bdf8`)**: Nước cờ sắc sảo củng cố ưu thế vượt trội.
3. **Chủ đề sách (`📖`, `#c29b68`)**: Nước đi theo lý thuyết khai cuộc sách giáo khoa.
4. **Tốt nhất (`★`, `#81b64c`)**: Nước đi tối ưu nhất theo engine Stockfish.
5. **Tuyệt vời (`👍`, `#81b64c`)**: Nước đi rất tốt với mức sụt giảm winDrop cực nhỏ.
6. **Tốt (`✓`, `#81b64c`)**: Nước đi hợp lý và an toàn.
7. **Không chính xác (`?!`, `#eab308`)**: Làm giảm nhẹ ưu thế ($4.5\% \le \Delta < 9.5\%$).
8. **Sai lầm (`?`, `#f97316`)**: Mất mát thế trận đáng kể ($9.5\% \le \Delta < 16.0\%$).
9. **Bỏ lỡ (`✕`, `#ef4444`)**: Bỏ qua cơ hội chiến thuật hoặc đòn kết liễu ($16.0\% \le \Delta < 22.0\%$).
10. **Nước sai lầm ngớ ngẩn (`??`, `#dc2626`)**: Treo quân, mất quân nặng hoặc đảo chiều thế trận ($\Delta \ge 22.0\%$).

### 2. 🏹 Hệ Thống Mũi Tên Trực Quan Chuẩn Chess.com
- **Nước sai lầm / Bỏ lỡ / Kém chính xác**: Hiển thị **1 mũi tên xanh lá cây (`#81b64c`)** chỉ rõ nước đi tốt nhất bị bỏ lỡ.
- **Nước Thiên tài (`!!`)**: Hiển thị **1 mũi tên màu cam (`#f59e0b`)** chỉ rõ phản đòn hoặc mối đe dọa ăn lại của đối thủ vào ô thí quân (ví dụ: `20... Rxd5!!` hiển thị `Bf3 -> d5`).
- Tuyệt đối không vẽ mũi tên kép hay phương án phụ gây rối mắt trên bàn cờ.

### 3. 📊 Bảng Thống Kê Tổng Quan 4 Cột Đối Xứng
- Bố cục 4 cột chuẩn Chess.com:
  `[Tên phân loại] [Số lượng Trắng] [Biểu tượng tròn ở giữa] [Số lượng Đen]`
- Màu chữ số lượng tương ứng với từng loại huy hiệu.
- Bảng độ chính xác (Accuracy), xếp hạng ván cờ (Performance Rating) và 4 giai đoạn trận đấu (Khai cuộc, Chiến lược, Chiến thuật, Tàn cuộc).

### 4. ⚡ Động Cơ Tính Toán & Đánh Giá
- **Stockfish 16**: Chạy trên Web Worker đa luồng, hỗ trợ đánh giá độ sâu cao.
- **PeSTO Evaluation + Alpha-Beta Quiescence**: Phân tích toàn bộ 60-80 nước đi của ván cờ trong vòng < 1 giây.
- **CAPS2 WinDrop**: Công thức tính toán $WinChance(cp) = 50 + 50 \times (2 / (1 + e^{-0.003682 \times cp}) - 1)$ so với $WinChance(bestEval)$ của từng nước.

### 5. 🌐 Nhập Link Trực Tiếp (Chess.com & Lichess)
- Nhập bất kỳ URL ván cờ nào:
  - `https://www.chess.com/game/live/173033536202`
  - `https://www.chess.com/analysis/game/live/184609437048`
  - `https://lichess.org/...`
- Tự động lấy PGN, Avatar, Elo, Quốc kỳ (SVG chuẩn), Đồng hồ (TimeControl) và phân tích ngay tức thì.

---

## 🚀 Hướng Dẫn Khởi Chạy

```powershell
# Di chuyển vào thư mục dự án
cd chess-trainer

# Cài đặt thư viện phụ thuộc
npm install

# Chạy server
npm start
```

Mở trình duyệt truy cập:
```
http://localhost:7777
```

---

## 🧪 Kiểm Thử Tự Động (19 Test Suites)

Chạy kiểm thử toàn diện 19 phần:
```powershell
node test-suite.js
```
Tất cả 19 phần kiểm thử đều đạt 100% thành công:
- Section 1-13: Cấu trúc DOM, SPA routing, cờ quốc gia SVG, âm thanh, icon tiêu đề.
- Section 14: Thí quân Mã Damiano `3. Nxe5!!` đạt Thiên tài.
- Section 17: Treo quân `5... Ne7??` bị đánh giá Blunder, không bao giờ là Brilliant.
- Section 18: Thí đổi chất Xe lấy Mã `20... Rxd5!!` và bảng phân loại 10 tầng.
- Section 19: Mũi tên cam phản đòn `f3 -> d5` và layout 4 cột chuẩn Image 4.
