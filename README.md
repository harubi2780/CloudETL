# CloudETL

CloudETL là đồ án môn Điện toán đám mây tại trường đại học. Mục tiêu dự kiến là xây dựng một dịch vụ ETL theo mô hình SaaS, giúp người dùng kết nối, chuyển đổi và tải dữ liệu. Các tính năng ETL vẫn đang trong quá trình phát triển.

## Công nghệ

- Backend: Django
- Frontend: React
- Cơ sở dữ liệu: PostgreSQL
- Đóng gói và chạy dịch vụ: Docker Compose

## Chạy trên máy cá nhân

Cài Docker Desktop và bật chế độ chạy Linux containers. Tại thư mục dự án, chuẩn bị tệp cấu hình gốc `.env`. Nếu chưa có, sao chép `.env.example` thành `.env` rồi thay các giá trị bí mật mẫu bằng giá trị riêng.

Khởi động các dịch vụ:

```sh
docker compose up -d --build
```

Tạo bảng cơ sở dữ liệu và tài khoản quản trị Django:

```sh
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```

Mở giao diện tại <http://localhost:8080/> hoặc trang quản trị tại <http://localhost:8080/admin/>.

Xem nhật ký hoặc dừng dịch vụ:

```sh
docker compose logs -f
docker compose down
```

Lệnh `docker compose down` giữ lại dữ liệu PostgreSQL.
