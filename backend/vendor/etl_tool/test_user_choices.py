"""
=============================================================================
RUNNER ĐỘNG: CHO PHÉP NGƯỜI DÙNG TỰ DO CHỌN CÁC TÙY CHỌN TRANSFORM
Mô phỏng chính xác những gì người dùng tick chọn trên giao diện Web!
=============================================================================
"""

import sys
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from extract import readFile, viewFile, checkColumnType
from transform import (
    joinTables,
    concatTables,
    selectColumns,
    removeDuplicates,
    handleNull,
    convertType,
    cleanString,
    replaceValue,
    normalizeDate,
    filterData
)
from load import exportFile, reviewFile, saveToCloud, getDownloadLink


def execute_user_choices(df, user_choices):
    """
    Hàm này nhận DataFrame và đọc bảng lựa chọn (user_choices) của người dùng
    để chạy các phép biến đổi tương ứng.
    """
    df_result = df.copy()

    # 1. Người dùng chọn Xóa trùng lặp
    if user_choices.get("remove_duplicates"):
        cols = user_choices.get("duplicate_columns")
        df_result = removeDuplicates(df_result, columns=cols)
        print(f"[*] Đã xóa trùng lặp theo cột: {cols}")

    # 2. Người dùng chọn Xử lý NULL
    # (Có thể chọn nhiều cột, mỗi cột 1 cách xử lý khác nhau!)
    if "null_rules" in user_choices:
        for rule in user_choices["null_rules"]:
            col = rule["column"]
            method = rule["method"]  # "drop_rows", "constant_value", "mean"
            val = rule.get("fill_value")

            df_result = handleNull(df_result, method=method, columns=[col], value=val)
            print(f"[*] Xử lý NULL cột '{col}': Cách làm = '{method}' (Giá trị điền = {val})")

    # 3. Người dùng chọn Chuẩn hóa chuỗi (Text)
    if "string_rules" in user_choices:
        for rule in user_choices["string_rules"]:
            col = rule["column"]
            action = rule["action"]  # "strip", "uppercase", "lowercase"
            df_result = cleanString(df_result, column=col, action=action)
            print(f"[*] Chuẩn hóa chữ cột '{col}': {action}")

    # 4. Người dùng chọn Thay thế giá trị cũ -> mới
    if "replace_rules" in user_choices:
        for rule in user_choices["replace_rules"]:
            col = rule["column"]
            old_v = rule["old_value"]
            new_v = rule["new_value"]
            df_result = replaceValue(df_result, column=col, old_val=old_v, new_val=new_v)
            print(f"[*] Thay thế cột '{col}': '{old_v}' -> '{new_v}'")

    # 5. Người dùng chọn Chuẩn hóa thời gian (Date)
    if "date_rules" in user_choices:
        for rule in user_choices["date_rules"]:
            col = rule["column"]
            fmt = rule.get("format", "%Y-%m-%d")
            df_result = normalizeDate(df_result, column=col, date_format=fmt)
            print(f"[*] Chuẩn hóa ngày cột '{col}' sang định dạng: {fmt}")

    # 6. Người dùng chọn Đổi kiểu dữ liệu
    if "type_rules" in user_choices:
        for rule in user_choices["type_rules"]:
            col = rule["column"]
            target = rule["target_type"]  # "int", "float", "string"
            df_result = convertType(df_result, column=col, target_type=target)
            print(f"[*] Đổi kiểu cột '{col}' -> {target}")

    # 7. Người dùng chọn Lọc dữ liệu
    if "filter_rules" in user_choices:
        for rule in user_choices["filter_rules"]:
            col = rule["column"]
            op = rule["operator"]  # ">", "<", ">=", "<=", "==", "!=", "contains"
            val = rule["value"]
            df_result = filterData(df_result, column=col, operator=op, value=val)
            print(f"[*] Lọc dữ liệu: Cột '{col}' {op} {val}")

    # 8. Người dùng chọn Giữ lại các cột được TICK chọn (hoặc xóa cột)
    if user_choices.get("selected_columns"):
        keep_cols = user_choices["selected_columns"]
        df_result = selectColumns(df_result, keep_columns=keep_cols)
        print(f"[*] Chỉ giữ lại các cột được tick chọn: {keep_cols}")

    return df_result


# =============================================================================
# CHẠY THỬ VỚI BẢNG LỰA CHỌN MẪU TỪ NGƯỜI DÙNG
# =============================================================================
if __name__ == "__main__":
    print("=" * 65)
    print("🧪 TEST THỬ: CHẠY DỮ LIỆU THEO ĐÚNG CÁC MỤC NGƯỜI DÙNG CHỌN TRÊN WEB")
    print("=" * 65)

    # 1. Đọc file
    df_raw = readFile("orders_sample.csv")
    initial_rows = len(df_raw)
    print(f"\n[1. EXTRACT] Đọc thành công {initial_rows} dòng.")
    print("Các cột và kiểu dữ liệu hiện tại:", checkColumnType(df_raw))

    # 2. GIẢ LẬP: Người dùng bấm chọn các mục trên giao diện Web:
    # - Cột customer_name: nếu rỗng thì điền "Khách vãng lai"
    # - Cột total_amount: nếu rỗng thì tính giá trị trung bình (mean) điền vào
    # - Cột city: thay thế "Hồ Chí Minh" thành "HCM"
    # - Cột order_date: chuẩn hóa ngày về dạng YYYY-MM-DD
    # - Lọc: chỉ lấy đơn hàng có total_amount >= 500000
    # - Cột giữ lại: chỉ tick chọn 4 cột [order_id, customer_name, city, total_amount]
    user_choices = {
        "remove_duplicates": True,
        "duplicate_columns": ["order_id"],
        "null_rules": [
            {"column": "customer_name", "method": "constant_value", "fill_value": "Khách vãng lai"},
            {"column": "total_amount", "method": "mean"}
        ],
        "string_rules": [
            {"column": "customer_name", "action": "strip"}
        ],
        "replace_rules": [
            {"column": "city", "old_value": "Hồ Chí Minh", "new_value": "HCM"}
        ],
        "date_rules": [
            {"column": "order_date", "format": "%Y-%m-%d"}
        ],
        "filter_rules": [
            {"column": "total_amount", "operator": ">=", "value": 500000}
        ],
        "selected_columns": ["order_id", "customer_name", "city", "total_amount"]
    }

    print("\n[2. TRANSFORM] Bắt đầu chạy theo các lựa chọn của người dùng:")
    df_clean = execute_user_choices(df_raw, user_choices)

    # 3. Xuất file kết quả
    print("\n[3. LOAD] Kết quả cuối cùng:")
    review = reviewFile(df_clean, initial_rows=initial_rows, n_rows=10)
    print(f"   - Số dòng ban đầu: {review['initial_rows']} -> Sau xử lý còn: {review['final_rows']} dòng")
    print("   - Xem các dòng kết quả sạch:")
    for row in review["preview_10"]:
        print("     ", row)
