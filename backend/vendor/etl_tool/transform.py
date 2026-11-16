import pandas as pd


# 1. Ghép nối 2 bảng (Join)
def joinTables(df1, df2, on_column, how="left"):
    return pd.merge(df1, df2, on=on_column, how=how)


# 2. Gộp nhiều file nối tiếp nhau (Concat)
def concatTables(df_list):
    return pd.concat(df_list, ignore_index=True)


# 3. Chọn cột (Tick) hoặc Xóa cột
def selectColumns(df, keep_columns=None, drop_columns=None):
    df = df.copy()
    if keep_columns:
        return df[[c for c in keep_columns if c in df.columns]]
    if drop_columns:
        return df.drop(columns=[c for c in drop_columns if c in df.columns])
    return df


# 4. Xóa trùng lặp theo cột chỉ định
def removeDuplicates(df, columns=None):
    df = df.copy()
    return df.drop_duplicates(subset=columns, keep="first")


# 5. Xử lý NULL (drop_rows, constant_value, mean)
def handleNull(df, method, columns=None, value=None):
    df = df.copy()
    cols = columns if columns else df.columns

    if method == "drop_rows":
        return df.dropna(subset=cols)

    elif method == "constant_value":
        for c in cols:
            df[c] = df[c].fillna(value if value is not None else "")
        return df

    elif method == "mean":
        for c in cols:
            if pd.api.types.is_numeric_dtype(df[c]):
                df[c] = df[c].fillna(round(df[c].mean(), 2))
        return df

    return df


# 6. Đổi kiểu dữ liệu (int, float, string)
def convertType(df, column, target_type):
    df = df.copy()
    if column not in df.columns:
        return df

    if target_type == "int":
        df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0).astype(int)
    elif target_type == "float":
        df[column] = pd.to_numeric(df[column], errors="coerce").astype(float)
    elif target_type == "string":
        df[column] = df[column].astype(str)

    return df


# 7. Chuẩn hóa chuỗi (strip, uppercase, lowercase)
def cleanString(df, column, action):
    df = df.copy()
    if column not in df.columns:
        return df

    if action == "strip":
        df[column] = df[column].astype(str).str.strip()
    elif action == "uppercase":
        df[column] = df[column].astype(str).str.upper()
    elif action == "lowercase":
        df[column] = df[column].astype(str).str.lower()

    return df


# 8. Thay thế giá trị cũ -> mới
def replaceValue(df, column, old_val, new_val):
    df = df.copy()
    if column in df.columns:
        df[column] = df[column].replace(old_val, new_val)
    return df


# 9. Chuẩn hóa ngày tháng về format chuẩn (mặc định YYYY-MM-DD)
def normalizeDate(df, column, date_format="%Y-%m-%d"):
    df = df.copy()
    if column in df.columns:
        df[column] = pd.to_datetime(df[column], errors="coerce").dt.strftime(date_format)
    return df


# 10. Lọc dữ liệu theo điều kiện
def filterData(df, column, operator, value):
    df = df.copy()
    if column not in df.columns:
        return df

    if operator == ">": return df[df[column] > float(value)]
    elif operator == "<": return df[df[column] < float(value)]
    elif operator == ">=": return df[df[column] >= float(value)]
    elif operator == "<=": return df[df[column] <= float(value)]
    elif operator == "==": return df[df[column] == float(value)]
    elif operator == "!=": return df[df[column] != float(value)]
    elif operator == "contains": return df[df[column].astype(str).str.contains(str(value), na=False)]

    return df
