import sys
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from extract import readFile, readMultipleFiles, viewFile, checkColumnType
from transform import joinTables, removeDuplicates, handleNull, replaceValue, normalizeDate, selectColumns
from load import exportFile, reviewFile, saveToCloud, getDownloadLink


print("=" * 60)
print("🚀 CHẠY THỬ NGHIỆM HỆ THỐNG ETL TOOL ĐƠN GIẢN")
print("=" * 60)

# -------------------------------------------------------------
# BƯỚC 1: EXTRACT (Đọc file, xem 10 dòng đầu, kiểm tra type cột)
# -------------------------------------------------------------
file_orders = "orders_sample.csv"
file_customers = "customers_sample.tsv"

# Đọc 2 file
df_orders = readFile(file_orders)
df_customers = readFile(file_customers)

if df_orders is None or df_customers is None:
    print("Lỗi đọc file!")
    exit()

print("\n1. EXTRACT:")
print("   - Type các cột:", checkColumnType(df_orders))
print("   - Xem trước 10 dòng đầu:")
for r in viewFile(df_orders, n_rows=10):
    print("     ", r)

# -------------------------------------------------------------
# BƯỚC 2: TRANSFORM (Ghép 2 file và làm sạch theo tùy chọn)
# -------------------------------------------------------------
print("\n2. TRANSFORM:")
# Ghép 2 file theo cột 'order_id'
df = joinTables(df_orders, df_customers, on_column="order_id", how="left")
initial_rows = len(df)

# Làm sạch dữ liệu theo các mục người dùng chọn:
df = removeDuplicates(df, columns=["order_id"])                  # Xóa trùng lặp
df = handleNull(df, method="mean", columns=["total_amount"])     # Điền Mean vào ô trống
df = replaceValue(df, column="city", old_val="Hồ Chí Minh", new_val="HCM") # Thay thế giá trị
df = normalizeDate(df, column="order_date", date_format="%Y-%m-%d")         # Chuẩn hóa ngày
df = selectColumns(df, keep_columns=["order_id", "city", "customer_tier", "total_amount", "customer_phone"]) # Chọn cột (Tick)

print(f"   - Đã xử lý xong {initial_rows} dòng -> Còn lại {len(df)} dòng sạch.")

# -------------------------------------------------------------
# BƯỚC 3: LOAD (Xuất file, review 10 dòng, lưu Cloud, lấy link tải)
# -------------------------------------------------------------
print("\n3. LOAD:")
output_file = "ket_qua_lam_sach.csv"
exportFile(df, output_file, file_type="csv")

# Review 10 dòng
review = reviewFile(df, initial_rows=initial_rows, n_rows=10)
print(f"   - Ban đầu: {review['initial_rows']} dòng | Kết quả: {review['final_rows']} dòng | Bỏ: {review['dropped_rows']} dòng")
print("   - Xem 10 dòng kết quả:")
for r in review["preview_10"]:
    print("     ", r)

# Lưu Cloud AWS S3 và lấy link tải
cloud_url = saveToCloud(output_file, tenant_id="user_demo_01", file_name="ket_qua_lam_sach.csv")
download_url = getDownloadLink(tenant_id="user_demo_01", file_name="ket_qua_lam_sach.csv")

print(f"   - Đã lưu Cloud: {cloud_url}")
print(f"   - Link tải file: {download_url}")
print("\n✅ HOÀN TẤT QUY TRÌNH ETL!")
