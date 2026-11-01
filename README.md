# Counterpoint POS

Ứng dụng quản lý nhà hàng chạy tại chỗ (on-premises), gồm trang quản lý nhà hàng, POS bán hàng tại quầy và trang đặt bàn công khai. Không có luồng đặt món trực tuyến.

## Yêu cầu

- Docker Desktop hoặc Docker Engine có Docker Compose v2 (`docker compose`).
- Cổng `8080` trên máy chưa bị ứng dụng khác sử dụng (hoặc đổi `PORT` trong `.env`).

## Chạy lần đầu

Mở Terminal tại thư mục gốc của dự án, nơi có file `docker-compose.yml`, rồi làm theo các bước:

1. Tạo file cấu hình local từ mẫu:

   ```bash
   cp .env.example .env
   ```

2. Mở `.env` bằng trình soạn thảo và thay ít nhất hai giá trị sau:

   ```dotenv
   POSTGRES_PASSWORD=mat_khau_postgres_rieng
   JWT_SECRET=chuoi_bi_mat_ngau_nhien_dai_it_nhat_32_byte
   ```

   Không dùng các giá trị mẫu khi triển khai thật và không đưa `.env` lên Git. Các cấu hình khác có thể giữ nguyên cho lần chạy local:

   - `PORT=8080`: cổng truy cập ứng dụng trên máy.
   - `APP_TIMEZONE=Asia/Ho_Chi_Minh`: múi giờ dùng cho ngày giờ và báo cáo.
   - `CURRENCY=VND`: đơn vị tiền hiển thị.
   - SMTP/Twilio: để trống nếu chưa cấu hình gửi khuyến mãi qua email/SMS.

3. Tạo và chạy các container:

   ```bash
   docker compose up -d --build
   ```

   Lần đầu Docker sẽ tải image cần thiết, build web/API và khởi tạo PostgreSQL; có thể mất vài phút. Những lần sau có thể dùng `docker compose up -d` nếu không đổi mã nguồn hay cấu hình build.

4. Kiểm tra các dịch vụ và xem log nếu cần:

   ```bash
   docker compose ps
   docker compose logs -f
   ```

   Nhấn `Ctrl+C` để thoát chế độ theo dõi log; các container vẫn chạy nền.

5. Mở trang quản lý và tạo tài khoản nhà hàng:

   - Dashboard: <http://localhost:8080/dashboard>
   - POS: <http://localhost:8080/pos>

   Đăng ký tại dashboard sẽ tạo nhà hàng, tài khoản chủ nhà hàng và đường dẫn đặt bàn riêng. Đường dẫn `/reserve/{slug}` hiển thị trong dashboard; đặt bàn trực tuyến mặc định đang tắt và chủ nhà hàng có thể bật trong phần cài đặt đặt bàn.

## Chạy lại, cập nhật và dừng

- Khởi động lại sau khi máy đã tắt:

  ```bash
  docker compose up -d
  ```

- Build lại sau khi cập nhật mã nguồn hoặc thay đổi cấu hình được nhúng vào web:

  ```bash
  docker compose up -d --build
  ```

- Dừng các container nhưng giữ dữ liệu PostgreSQL:

  ```bash
  docker compose down
  ```

- **Xóa toàn bộ dữ liệu database** (nhà hàng, tài khoản, menu, đơn hàng và đặt bàn):

  ```bash
  docker compose down -v
  ```

  Lệnh này xóa volume `postgres_data`; chỉ chạy nếu chủ ý khởi tạo lại database từ đầu.

## Cấu hình và dữ liệu

Các biến môi trường nằm trong `.env` ở thư mục gốc. `POSTGRES_PASSWORD` và `JWT_SECRET` là bắt buộc. Đổi `PORT` nếu cổng 8080 đang được sử dụng, ví dụ `PORT=8090`; sau đó truy cập `http://localhost:8090`.

PostgreSQL lưu dữ liệu trong Docker volume có tên `postgres_data`, nên dữ liệu vẫn còn sau `docker compose down` hoặc khi rebuild container. Hai API Catalog và Orders cùng dùng PostgreSQL nhưng có database riêng. Chỉ web được mở cổng ra máy host; API và database ở trong mạng Docker nội bộ.

## Khắc phục sự cố thường gặp

- **Docker chưa chạy:** mở Docker Desktop (hoặc khởi động Docker Engine), rồi thử lại lệnh `docker compose`.
- **Cổng đã được sử dụng:** đổi `PORT` trong `.env`, ví dụ `PORT=8090`, rồi chạy lại `docker compose up -d`.
- **Container chưa healthy hoặc trang chưa mở được:** xem `docker compose ps` và `docker compose logs -f`; đợi PostgreSQL và API khởi động xong rồi tải lại trang.
- **Lỗi thiếu cấu hình:** kiểm tra `.env` đã tồn tại và có `POSTGRES_PASSWORD`, `JWT_SECRET` chưa.
- **Muốn kiểm tra log của một dịch vụ:** dùng `docker compose logs -f web`, `docker compose logs -f catalog`, `docker compose logs -f orders` hoặc `docker compose logs -f postgres`.

Nếu đổi mật khẩu PostgreSQL sau khi database đã được khởi tạo trong volume, chỉ sửa `.env` có thể không đổi mật khẩu bên trong database. Cần cập nhật database tương ứng hoặc chủ động xóa volume bằng `docker compose down -v` (việc này xóa dữ liệu).

## Ghi chú tính năng

- Dashboard và POS là hai giao diện riêng, cùng dùng dữ liệu có phân quyền theo nhà hàng.
- POS lưu các món đang gọi trong bộ nhớ trình duyệt cho đến khi thanh toán; tải lại trang hoặc chuyển thiết bị trước checkout có thể làm mất các món đó.
- Thanh toán tiền mặt ghi nhận doanh thu sau khi chủ nhà hàng xác nhận đã nhận tiền. Card, QR và Gift chưa dùng được nếu chưa cấu hình nhà cung cấp tương ứng.
- Báo cáo doanh thu chỉ tính giao dịch đã thanh toán theo múi giờ `APP_TIMEZONE`.
- “Storage” hiện quản lý trạng thái món còn/hết; chưa theo dõi tồn kho nguyên liệu.
- Gửi khuyến mãi qua email/SMS cần cấu hình thông tin SMTP hoặc Twilio trong `.env`.

## Chạy chế độ phát triển (không dùng Docker)

Repo có script `pnpm dev`, nhưng cần tự chuẩn bị các PostgreSQL database và biến môi trường cho Catalog/Orders. Docker Compose là cách chạy đầy đủ được hỗ trợ cho local/on-prem; xem `docker-compose.yml` để biết cấu hình dịch vụ.
