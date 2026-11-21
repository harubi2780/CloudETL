import os
import io
import pandas as pd
from typing import Union, List, Dict, Any, Optional

# Giới hạn kích thước file (30MB) và loại file cho phép
MAX_FILE_SIZE = 30 * 1024 * 1024  # 30MB
ALLOWED_EXTENSIONS = [".csv", ".tsv"]


# 1. KIỂM TRA FILE
def checkFile(source: Union[str, bytes], file_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Kiểm tra ràng buộc file tải lên:
    - Kích thước <= 30 MB
    - Chỉ cho phép đuôi .csv hoặc .tsv
    """
    if isinstance(source, bytes):
        if not file_name:
            file_name = "uploaded_file.csv"
        file_size = len(source)
    else:
        if not os.path.exists(source):
            return {"valid": False, "error": f"Không tìm thấy file: {source}"}
        file_name = os.path.basename(source)
        file_size = os.path.getsize(source)

    ext = os.path.splitext(file_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return {"valid": False, "error": f"Chỉ chấp nhận file .csv hoặc .tsv, không nhận định dạng '{ext}'"}

    if file_size == 0:
        return {"valid": False, "error": "File rỗng (0 bytes)"}
    elif file_size > MAX_FILE_SIZE:
        size_mb = round(file_size / (1024 * 1024), 2)
        return {"valid": False, "error": f"File vượt quá giới hạn 30MB ({size_mb} MB > 30 MB)"}

    return {
        "valid": True,
        "file_name": file_name,
        "file_size": file_size,
        "extension": ext
    }


# 2. ĐỌC FILE
def readFile(
    source: Union[str, bytes],
    file_name: Optional[str] = None,
    delimiter: Optional[str] = None
) -> Optional[pd.DataFrame]:
    """
    Đọc file CSV hoặc TSV vào pandas DataFrame, hỗ trợ tiếng Việt có dấu.
    """
    check_info = checkFile(source, file_name=file_name)
    if not check_info["valid"]:
        print(f"Lỗi: {check_info.get('error')}")
        return None

    ext = check_info["extension"]
    sep = delimiter if delimiter else ("\t" if ext == ".tsv" else ",")

    if isinstance(source, bytes):
        buffer = io.BytesIO(source)
    else:
        buffer = open(source, "rb")

    encodings = ["utf-8", "utf-8-sig", "latin1", "cp1252"]
    df = None

    for enc in encodings:
        try:
            buffer.seek(0)
            df = pd.read_csv(
                buffer,
                sep=sep,
                encoding=enc,
                low_memory=False,
                on_bad_lines="skip"
            )
            break
        except Exception:
            continue

    if not isinstance(source, bytes):
        buffer.close()

    return df


# 3. ĐỌC NHIỀU FILE CÙNG LÚC
def readMultipleFiles(file_list: List[str]) -> Dict[str, pd.DataFrame]:
    """
    Đọc đồng thời 2, 3, 4 hoặc nhiều file CSV/TSV vào Dictionary { 'ten_file': DataFrame }
    """
    dfs = {}
    for fpath in file_list:
        df = readFile(fpath)
        if df is not None:
            name = os.path.basename(fpath)
            dfs[name] = df
    return dfs


# 4. XEM TRƯỚC 10 DÒNG ĐẦU
def viewFile(df: Optional[pd.DataFrame], n_rows: int = 10) -> List[Dict[str, Any]]:
    """
    Lấy 10 dòng đầu tiên của dữ liệu để chiếu cho khách hàng xem trước.
    Tự động chuyển NaN -> None để tương thích chuẩn JSON API của Web.
    """
    if df is None or df.empty:
        return []
    sample_df = df.head(n_rows).copy()
    cleaned_df = sample_df.where(pd.notnull(sample_df), None)
    return cleaned_df.to_dict(orient="records")


# 5. KIỂM TRA TYPE CÁC CỘT (Chuẩn hóa 4 kiểu dữ liệu: str, int, float, dtt)
# Sơ đồ: check có type -> Có: show / Không có: hide
def checkColumnType(df: Optional[pd.DataFrame]) -> Dict[str, Any]:
    """
    Kiểm tra kiểu dữ liệu các cột và chuẩn hóa về 4 nhóm kiểu cốt lõi:
    - 'str': String (chuỗi ký tự)
    - 'int': Integer (số nguyên)
    - 'float': Float (số thập phân)
    - 'dtt': Datetime (ngày tháng năm / thời gian)
    
    Quy tắc: Cột có type hợp lệ -> show=True / Cột rỗng hoàn toàn -> show=False
    """
    if df is None:
        return {}

    columns_info = {}
    for col in df.columns:
        series = df[col]
        raw_dtype = str(series.dtype).lower()
        null_count = int(series.isnull().sum())
        non_null_count = int(series.notnull().sum())

        # Nếu cột hoàn toàn rỗng hoặc không có dữ liệu -> hide
        if non_null_count == 0:
            columns_info[col] = {
                "type": "str",
                "raw_dtype": raw_dtype,
                "null_count": null_count,
                "show": False,
                "note": "Cột không có dữ liệu (rỗng 100%)"
            }
            continue

        # Phân loại 4 kiểu dữ liệu chính: str, int, float, dtt
        if "int" in raw_dtype:
            normalized_type = "int"
        elif "float" in raw_dtype:
            normalized_type = "float"
        elif "datetime" in raw_dtype:
            normalized_type = "dtt"
        else:
            # Kiểm tra xem cột chuỗi này có phải là cột ngày tháng (dtt) không
            sample_values = series.dropna().astype(str).str.strip().head(20)
            is_date = False
            if len(sample_values) > 0 and any(kw in col.lower() for kw in ["date", "time", "ngay", "gio", "created", "updated"]):
                try:
                    pd.to_datetime(sample_values, errors="raise")
                    is_date = True
                except Exception:
                    pass

            normalized_type = "dtt" if is_date else "str"

        columns_info[col] = {
            "type": normalized_type,     # 'str' | 'int' | 'float' | 'dtt'
            "raw_dtype": raw_dtype,
            "null_count": null_count,
            "show": True,
            "sample_value": str(series.dropna().iloc[0]) if non_null_count > 0 else None
        }

    return {
        "total_rows": len(df),
        "total_columns": len(df.columns),
        "columns": columns_info
    }
