# CloudETL

CloudETL là đồ án môn Điện toán đám mây tại trường đại học. Mục tiêu dự kiến là xây dựng dịch vụ ETL theo mô hình SaaS; các tính năng ETL vẫn đang được phát triển.

## Công nghệ và mã nguồn

- Backend: Django (`backend/config/`, `backend/views.py`, `backend/forms.py`, `backend/services/`, `backend/dao/`, `backend/tests/`)
- Frontend: React (`frontend/`)
- Cơ sở dữ liệu: PostgreSQL
- Chạy dịch vụ: Docker Compose

## Chạy trên máy cá nhân

Cài Docker Desktop và bật Linux containers. Chuẩn bị `.env` ở thư mục gốc; nếu chưa có, sao chép `.env.example` thành `.env` rồi thay các giá trị bí mật mẫu.

```sh
docker compose up -d --build
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py createsuperuser
```


Giao diện: <http://localhost:8080/>. Trang quản trị: <http://localhost:8080/admin/>.

Chọn **Create account** để đăng ký, **Sign in** để đăng nhập và **Sign out** để đăng xuất. Phiên đăng nhập được giữ khi tải lại trang; tài khoản đăng ký là người dùng thông thường.

Xem nhật ký hoặc dừng dịch vụ:

```sh
docker compose logs -f
docker compose down
```

`docker compose down` giữ lại dữ liệu PostgreSQL.
