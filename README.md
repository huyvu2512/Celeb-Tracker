<div align="center">

# 🚀 Celeb Tracker

**Hệ thống thông báo slot Celeb Tracker và auto add theo thời gian thực.**

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer-Browser_Automation-00D8A2?logo=puppeteer&logoColor=black)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-Automated-2088FF?logo=github-actions&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-Bot_Alerts-2CA5E0?logo=telegram&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-Webhook_Alerts-5865F2?logo=discord&logoColor=white)

📦 **[GitHub](https://github.com/huyvu2512/Celeb-Tracker)** · 👤 **[Liên hệ](https://beacons.ai/huyvu2512)**

---

### 📊 Thống Kê Dự Án

[![Stars](https://img.shields.io/github/stars/huyvu2512/Celeb-Tracker?style=flat-square&label=⭐%20Stars&color=FFCC00)](https://github.com/huyvu2512/Celeb-Tracker/stargazers)
[![Forks](https://img.shields.io/github/forks/huyvu2512/Celeb-Tracker?style=flat-square&label=🍴%20Forks&color=6e7681)](https://github.com/huyvu2512/Celeb-Tracker/forks)
[![Issues](https://img.shields.io/github/issues/huyvu2512/Celeb-Tracker?style=flat-square&label=🐛%20Issues&color=f85149)](https://github.com/huyvu2512/Celeb-Tracker/issues)
[![Last Commit](https://img.shields.io/github/last-commit/huyvu2512/Celeb-Tracker?style=flat-square&label=🕐%20Cập%20nhật&color=3fb950)](https://github.com/huyvu2512/Celeb-Tracker/commits/main)
![Visitors](https://visitor-badge.laobi.icu/badge?page_id=huyvu2512.Celeb-Tracker&left_text=👁%20Lượt%20xem&left_color=6e7681&right_color=FF0000)

</div>

---

## ⚠️ Tuyên bố miễn trách nhiệm

> **Dự án này được xây dựng hoàn toàn vì mục đích học tập, khám phá kỹ thuật tự động hóa và phi lợi nhuận.**
>
> - Toàn bộ dữ liệu (tên người dùng, đường link chia sẻ, số lượng slot) được trích xuất hoàn toàn tự động từ các nguồn công khai do chính chủ đăng tải trên mạng xã hội (Threads, Instagram).
> - Dự án **không** lưu trữ, phân phối lại, sửa đổi hay khai thác trái phép quyền riêng tư của bất kỳ cá nhân nào.
> - Dự án **không** có mục đích thương mại, không kinh doanh, không thu phí dưới bất kỳ hình thức nào.
> - Mọi nhãn hiệu, thương hiệu liên quan đến Celeb Tracker, Instagram, Threads đều thuộc quyền sở hữu của các công ty chủ quản.
> - Nếu có bất kỳ lo ngại nào về quyền riêng tư, vui lòng liên hệ tác giả để xử lý ngay lập tức.

---

## ✨ Tính Năng Nổi Bật

- **🕵️‍♂️ Quét tự động đa nền tảng:** Lắng nghe và trích xuất dữ liệu bài đăng mới nhất từ Threads, Facebook Pages và Instagram Stories hoàn toàn tự động. Đồng thời theo dõi song song **nhiều trang mục tiêu cùng lúc** (Trang chính, Trang dự phòng Threads & Trang Facebook).
- **🎯 Sniper Mode (Chế độ Bắn Tỉa):** AI tự động phân tích ngôn ngữ tự nhiên (NLP) từ caption để phát hiện "Giờ Vàng". Khi đến giờ G (nhận diện trước 30 phút), hệ thống tự động khóa mục tiêu và chuyển sang trạng thái "Cuồng nộ": **Spam quét liên tục không độ trễ (0s)** để hớt tay trên mọi slot giới hạn! Bổ sung vòng lặp thần tốc 5 phút quét liên tục cho mọi chu kỳ hoạt động thông thường. Tích hợp **Early Exit** tự ngắt lập tức khi cắn link và khả năng **tự phục hồi** (Auto-Retry) dẻo dai lấy lại link khi gặp lỗi 404.
- **⚡ Phân tích link siêu tốc:** Phân giải (resolve) trực tiếp link `App.cam` để lấy thông tin chi tiết (avatar, tên, giới hạn slot) theo thời gian thực mà không cần tải ứng dụng.
- **🤖 Auto-Add Thần Tốc:** Tích hợp trình duyệt ảo tự động đăng nhập Web Dio, nhận diện giao diện và **click kết bạn bằng tọa độ** ngay giây đầu tiên phát hiện Celeb mới. Tự động nhận diện và bỏ qua các trạng thái "Full slot", "Đang xếp hàng", hoặc "Đã là bạn bè".
- **📱 Hệ thống Cảnh báo Kép (Telegram + Discord):** Gửi tin nhắn thông báo cực xịn về điện thoại qua Telegram và đẩy Embed message tuyệt đẹp (mạ vàng, chia cột thông tin) lên server Discord. Tự động bóc tách 3 luồng báo cáo: Phát hiện Celeb mới, Cảnh báo chuẩn bị mở Slot, và Báo cáo chiến tích **Auto-Add** thành công/thất bại!
- **🕒 Vận hành Serverless 24/7:** Chạy hoàn toàn miễn phí và tự động thông qua GitHub Actions và bộ hẹn giờ cron-job.

---

## 🛠 Cấu trúc dự án

```text
📦 Celeb Tracker
 ┣ 📂 data                  # Thư mục lưu trữ database JSON (được cập nhật tự động bởi Github Action)
 ┃ ┣ 📜 celebs.json         # Danh sách link Celeb Tracker của các Celeb đã săn được
 ┃ ┗ 📜 scan_state.json     # Lưu trạng thái, lịch sử bài viết đã quét và thời gian kích hoạt Sniper Mode
 ┣ 📂 src
 ┃ ┣ 📜 tracker.js          # File thực thi chính - Trái tim của toàn bộ hệ thống
 ┃ ┣ 📜 threads-scraper.js  # Tool cạo dữ liệu ẩn danh từ mạng xã hội Threads 
 ┃ ┣ 📜 fb-scraper.js       # Tool thu thập dữ liệu ẩn danh từ Facebook Pages
 ┃ ┣ 📜 insta-scraper.js    # Tương tác với Instagram API thông qua RapidAPI
 ┃ ┣ 📜 link-resolver.js    # Trích xuất dữ liệu từ deep-link của Celeb Tracker
 ┃ ┣ 📜 auto-adder.js       # Module tự động đăng nhập Web Dio và kết bạn
 ┃ ┗ 📜 utils.js            # Các hàm hỗ trợ dùng chung (I/O, bóc tách thời gian, gửi Telegram, Discord...)
 ┣ 📂 .github/workflows
 ┃ ┗ 📜 tracker.yml         # File cấu hình tự động hoá của Github Actions (CI/CD)
 ┣ 📜 package.json
 ┣ 📜 README.md
 ┣ 📜 CONTRIBUTING.md
 ┣ 📜 SECURITY.md
 ┗ 🖼️ logo.png             # Logo dự án (hiển thị trên Embed Discord)
```

---

## ⚙️ Cài đặt Môi trường (GitHub Secrets)

Để hệ thống hoạt động đầy đủ trên GitHub Actions, bạn cần cấu hình các biến môi trường sau trong mục **Settings > Secrets and variables > Actions**:

| Biến | Ý nghĩa |
|------|---------|
| `RAPIDAPI_KEY` | Key API dùng để quét Instagram Stories |
| `TELEGRAM_BOT_TOKEN` | Token của con bot Telegram do BotFather cung cấp |
| `TELEGRAM_CHAT_ID` | ID của bạn (hoặc group/channel) để nhận thông báo |
| `DISCORD_WEBHOOK_URL`| Link Webhook kênh Discord để nhận thông báo (Bắt buộc nếu muốn dùng Discord) |
| `L_DIO_EMAIL` | Email đăng nhập vào Web Dio (dành cho tính năng Auto-Add) |
| `L_DIO_PASSWORD` | Mật khẩu đăng nhập vào Web Dio (dành cho tính năng Auto-Add) |

---

## 💻 Hướng dẫn chạy thử nội bộ (Local)

1. Tải dự án về máy:
```bash
git clone https://github.com/huyvu2512/Celeb-Tracker.git
cd Celeb-Tracker
```

2. Cài đặt các thư viện cần thiết:
```bash
npm install
```

3. Chạy hệ thống giả lập (không ghi đè file lưu trữ):
```bash
node src/tracker.js --dry-run
```

---

## 🤝 Đóng góp (Contributing)

Mọi đóng góp nhằm tối ưu hóa bộ code, bóc tách API sâu hơn hoặc phát triển thêm các nền tảng quét mới đều được hoan nghênh. 

Hãy thoải mái tạo Pull Request hoặc mở một Issue mới nếu bạn phát hiện lỗi hoặc có tính năng hay muốn thêm vào. Vui lòng tham khảo file `CONTRIBUTING.md` để biết thêm chi tiết.

---

## 📄 Giấy phép (License)

Dự án này được phân phối dưới giấy phép **MIT**. Xem file `LICENSE` để biết thêm thông tin.
