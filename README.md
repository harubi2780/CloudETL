# CloudETL

Backend ETL integration: [implementation handoff](backend/docs/ETL_IMPLEMENTATION_TEMP.md)
and [test report](backend/docs/ETL_TEST_REPORT_TEMP.md). The backend supports queued
CSV/TSV processing with Parquet results and five download formats. The frontend now
connects uploads, source previews, pipeline configuration, runs and paginated results.
The local Docker stack was activated and tested on 2026-11-15:
[live Docker verification](backend/docs/DOCKER_VERIFICATION_TEMP.md).

Account storage now has a 500 MiB Free default allowance across uploads and saved ETL
results. The Account page includes a local Premium demo: 2 GiB for a simulated
59,000 VND / 30 days, with no real payment or MoMo connection.
The billing demo was activated locally on 2026-11-19; see the
[billing handoff](backend/docs/BILLING_DEMO_IMPLEMENTATION_TEMP.md) and
[verification report](backend/docs/BILLING_DEMO_TEST_REPORT_TEMP.md).
See the [temporary account storage handoff](backend/docs/ACCOUNT_STORAGE_IMPLEMENTATION_TEMP.md)
and [test report](backend/docs/ACCOUNT_STORAGE_TEST_REPORT_TEMP.md) for activation status.

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

Tải nhiều tệp ở trang **Datasets**: thêm bằng nút chọn hoặc kéo thả, xóa tệp khỏi danh sách rồi bấm **Upload**. Tệp lưu riêng trong object storage; PostgreSQL lưu thông tin và chủ sở hữu.

Cấu hình lưu trữ cục bộ và AWS S3: [hướng dẫn](backend/OBJECT_STORAGE.md).
