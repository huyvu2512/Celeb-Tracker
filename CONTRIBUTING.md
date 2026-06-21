# 🤝 Hướng Dẫn Đóng Góp (Contributing)

Cảm ơn bạn đã quan tâm đến việc đóng góp cho dự án Celeb Locket Tracker! Sự hỗ trợ của cộng đồng giúp dự án phát triển mạnh mẽ và tối ưu hơn.

Dưới đây là một số hướng dẫn để quá trình đóng góp diễn ra thuận lợi:

## 🐛 Báo cáo Lỗi (Issues)

Nếu bạn gặp phải bất kỳ lỗi nào trong quá trình cài đặt hoặc chạy ứng dụng, vui lòng mở một [Issue](https://github.com/huyvu2512/Celeb-Locket-Tracker/issues) mới.

Hãy chắc chắn bạn đã cung cấp:
- Mô tả chi tiết về lỗi bạn gặp phải.
- Cách để tái hiện lại lỗi đó (các bước bạn đã làm).
- Ảnh chụp màn hình hoặc log console (nếu có).
- Môi trường bạn đang sử dụng (phiên bản Node.js, OS).

## ✨ Yêu cầu Tính Năng Mới (Feature Requests)

Nếu bạn có ý tưởng tuyệt vời để cải thiện dự án, hãy tạo một Issue với label `enhancement` hoặc `feature`. Trình bày rõ ràng về ý tưởng và lý do tại sao nó lại hữu ích.

## 🛠 Đóng Góp Code (Pull Requests)

1. **Fork** repository này về tài khoản GitHub của bạn.
2. Tạo một branch mới cho tính năng hoặc bản sửa lỗi của bạn:
   ```bash
   git checkout -b feature/ten-tinh-nang-moi
   # hoặc
   git checkout -b fix/ten-loi-can-sua
   ```
3. Chỉnh sửa code theo ý muốn của bạn. Vui lòng giữ style code gọn gàng, thêm comment (chú thích) ở những đoạn logic phức tạp.
4. Chạy test thử bằng lệnh:
   ```bash
   node src/tracker.js --dry-run
   ```
5. Commit thay đổi với thông điệp (commit message) rõ ràng:
   ```bash
   git commit -m "Thêm tính năng quét Locket qua bình luận X"
   ```
6. Push branch lên fork của bạn:
   ```bash
   git push origin feature/ten-tinh-nang-moi
   ```
7. Cuối cùng, mở một **Pull Request (PR)** trên repository gốc. Giải thích rõ ràng về những gì bạn đã làm trong PR đó.

## ⚖️ Quy Tắc Chung
- Tôn trọng mọi người và giữ thái độ tích cực trong phần bình luận và thảo luận.
- Không gửi PR chứa các API Key, Bot Token hay thông tin nhạy cảm của bạn lên public repository.
- Tuân thủ tuyên bố miễn trách nhiệm của dự án. Không đóng góp những đoạn code nhằm phá hoại, spam hoặc vi phạm chính sách của bất kỳ nền tảng nào.

Cảm ơn bạn đã dành thời gian và tâm huyết để giúp cho Celeb Locket Tracker ngày càng tuyệt vời hơn! ❤️
