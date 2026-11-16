import os
import pandas as pd

# Giới hạn kích thước file (30MB) và loại file cho phép
MAX_FILE_SIZE = 30 * 1024 * 1024  # 30MB
ALLOWED_EXTENSIONS = [".csv", ".tsv"]


# 1. Kiểm tra file (Upload)
def checkFile(file_path):
# check có file chưa    
    if not os.path.exists(file_path):
        print(f"Lỗi: Không tìm thấy file {file_path}")
        return False

# check đuôi file
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        print(f"Lỗi: Chỉ chấp nhận file .csv hoặc .tsv, không nhận {ext}")
        return False
    
# check size file
    size = os.path.getsize(file_path)
    if size > MAX_FILE_SIZE:
        print(f"Lỗi: File vượt quá 30MB ({round(size / (1024*1024), 2)}MB)")
        return False
    return True


# 2. Read file in DataFrame
def readFile(file_path):
    if not checkFile(file_path):
        return None

    ext = os.path.splitext(file_path)[1].lower()
    sep = "\t" if ext == ".tsv" else ","

    try:
        return pd.read_csv(file_path, sep=sep, encoding="utf-8")
    except Exception:
        return pd.read_csv(file_path, sep=sep, encoding="utf-8-sig")


# 3. Đọc nhiều file cùng lúc
def readMultipleFiles(file_list):
    dfs = {}
    for f in file_list:
        df = readFile(f)
        if df is not None:
            name = os.path.basename(f)
            dfs[name] = df
    return dfs


# 4. Mở xem trước 10 dòng đầu cho người dùng
def viewFile(df, n_rows=10):
    if df is None:
        return []
    return df.head(n_rows).to_dict(orient="records")


# 5. Kiểm tra type các cột (không giới hạn dòng hay cột)
def checkColumnType(df):
    if df is None:
        return {}
    
    types = {}
    for col in df.columns:
        types[col] = str(df[col].dtype)
    return types
