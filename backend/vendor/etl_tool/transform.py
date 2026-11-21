import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional, Union


# =============================================================================
# A. PHỐI HỢP NHIỀU FILE (JOIN / CONCAT)
# =============================================================================
def joinTables(
    df1: pd.DataFrame,
    df2: pd.DataFrame,
    on_column: str,
    how: str = "left"
) -> pd.DataFrame:
    """Kết nối 2 bảng dữ liệu theo cột liên kết chung (inner, left, right, outer)."""
    if on_column not in df1.columns or on_column not in df2.columns:
        raise ValueError(f"Cột liên kết '{on_column}' không tồn tại trong cả 2 bảng!")
    return pd.merge(df1, df2, on=on_column, how=how.lower())


def concatTables(df_list: List[pd.DataFrame]) -> pd.DataFrame:
    """Nối tiếp nhiều bảng có chung cấu trúc thành một bảng duy nhất (Union/Concat)."""
    if not df_list:
        raise ValueError("Danh sách bảng dữ liệu rỗng!")
    return pd.concat(df_list, ignore_index=True)


# =============================================================================
# B. CHUẨN HÓA & BIẾN ĐỔI CHI TIẾT THEO YÊU CẦU
# =============================================================================

# 1. Chọn cột (Tick) hoặc Xóa cột
def selectColumns(
    df: pd.DataFrame,
    keep_columns: Optional[List[str]] = None,
    drop_columns: Optional[List[str]] = None
) -> pd.DataFrame:
    df = df.copy()
    if keep_columns:
        valid_cols = [c for c in keep_columns if c in df.columns]
        if valid_cols:
            return df[valid_cols]
    elif drop_columns:
        valid_drops = [c for c in drop_columns if c in df.columns]
        if valid_drops:
            return df.drop(columns=valid_drops)
    return df


# 2. Xóa trùng lặp
def removeDuplicates(
    df: pd.DataFrame,
    columns: Optional[List[str]] = None,
    keep: str = "first"
) -> pd.DataFrame:
    df = df.copy()
    if columns:
        valid_cols = [c for c in columns if c in df.columns]
        if valid_cols:
            return df.drop_duplicates(subset=valid_cols, keep=keep)
    return df.drop_duplicates(keep=keep)


# 3. Xử lý NULL (drop_rows, constant_value, mean, median)
def handleNull(
    df: pd.DataFrame,
    method: str,
    columns: Optional[List[str]] = None,
    value: Any = None
) -> pd.DataFrame:
    df = df.copy()
    cols = columns if columns else list(df.columns)
    valid_cols = [c for c in cols if c in df.columns]

    if method in ["drop", "drop_rows", "drop_row"]:
        return df.dropna(subset=valid_cols)

    elif method in ["constant_value", "custom", "fill_custom"]:
        fill_val = value if value is not None else ""
        for c in valid_cols:
            df[c] = df[c].fillna(fill_val)
        return df

    elif method in ["mean", "fill_mean"]:
        for c in valid_cols:
            if pd.api.types.is_numeric_dtype(df[c]):
                mean_val = round(df[c].mean(), 2)
                df[c] = df[c].fillna(mean_val)
        return df

    elif method in ["median", "fill_median"]:
        for c in valid_cols:
            if pd.api.types.is_numeric_dtype(df[c]):
                med_val = round(df[c].median(), 2)
                df[c] = df[c].fillna(med_val)
        return df

    return df


# 4. Đổi kiểu dữ liệu chuẩn (str, int, float, dtt, bool)
def convertType(df: pd.DataFrame, column: str, target_type: str) -> pd.DataFrame:
    df = df.copy()
    if column not in df.columns:
        return df

    target = target_type.lower().strip()
    try:
        if target in ["int", "integer"]:
            df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0).astype(int)
        elif target in ["float", "decimal"]:
            df[column] = pd.to_numeric(df[column], errors="coerce").astype(float)
        elif target in ["str", "string", "text"]:
            df[column] = df[column].astype(str).replace("nan", "")
        elif target in ["bool", "boolean"]:
            df[column] = df[column].astype(str).str.lower().isin(["true", "1", "yes", "t"])
        elif target in ["dtt", "datetime", "date"]:
            df[column] = pd.to_datetime(df[column], errors="coerce").dt.strftime("%Y-%m-%d")
    except Exception as e:
        print(f"Lỗi chuyển kiểu cột {column}: {e}")

    return df


# 5. Chuẩn hóa chuỗi (strip khoảng trắng thừa, uppercase, lowercase, titlecase)
def cleanString(df: pd.DataFrame, column: str, action: str = "strip") -> pd.DataFrame:
    df = df.copy()
    if column not in df.columns:
        return df

    s = df[column].astype(str)
    act = action.lower().strip()

    if act == "strip":
        df[column] = s.str.strip()
    elif act == "uppercase":
        df[column] = s.str.strip().str.upper()
    elif act == "lowercase":
        df[column] = s.str.strip().str.lower()
    elif act == "title":
        df[column] = s.str.strip().str.title()

    return df


# 6. Thay thế giá trị cũ -> mới
def replaceValue(df: pd.DataFrame, column: str, old_val: Any, new_val: Any) -> pd.DataFrame:
    df = df.copy()
    if column in df.columns:
        df[column] = df[column].replace(old_val, new_val)
    return df


# 7. Chuẩn hóa ngày tháng năm (Date Normalization)
# Giải quyết khoảng trắng thừa, xử lý lỗi format ngày hỗn hợp
def normalizeDate(
    df: pd.DataFrame,
    column: str,
    date_format: str = "%Y-%m-%d",
    input_format: Optional[str] = None
) -> pd.DataFrame:
    df = df.copy()
    if column not in df.columns:
        return df

    # Bước 1: Strip sạch khoảng trắng thừa trước khi phân tích ngày
    cleaned_date_str = df[column].astype(str).str.strip().replace("nan", "")

    # Bước 2: Parse ngày an toàn (hỗ trợ cả input_format nếu người dùng chỉ định)
    if input_format and input_format != "auto":
        # Ánh xạ định dạng giao diện sang định dạng strptime
        py_in_fmt = input_format.replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d")
        parsed_dt = pd.to_datetime(cleaned_date_str, format=py_in_fmt, errors="coerce")
    else:
        # Tự động parse định dạng ngày linh hoạt (hỗ trợ định dạng hỗn hợp)
        parsed_dt = pd.to_datetime(cleaned_date_str, format="mixed", errors="coerce")

    # Bước 3: Format ra chuẩn đầu ra
    py_out_fmt = date_format.replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d")
    df[column] = parsed_dt.dt.strftime(py_out_fmt)
    return df


# 8. Lọc dữ liệu thông minh (Hỗ trợ đầy đủ: Số, Chữ string, Ngày dtt, Cờ flag)
def filterData(
    df: pd.DataFrame,
    column: str,
    operator: str,
    value: Any = None
) -> pd.DataFrame:
    """
    Bộ lọc dữ liệu toàn diện:
    - Số: >, <, >=, <=, ==, !=
    - Chữ (String): 'equals' (bằng), 'contains' (chứa), 'startswith' (bắt đầu bằng), 'endswith' (kết thúc bằng)
    - Cờ trạng thái: 'is_true', 'is_false'
    - Ngày tháng (dtt): 'after' (sau ngày), 'before' (trước ngày), 'between'
    """
    df = df.copy()
    if column not in df.columns:
        return df

    op = str(operator).lower().strip()

    # --- Lọc cờ trạng thái Boolean ---
    if op in ["is_true", "true"]:
        return df[df[column].astype(str).str.lower().isin(["true", "1", "yes"])]
    elif op in ["is_false", "false"]:
        return df[~df[column].astype(str).str.lower().isin(["true", "1", "yes"])]

    # --- Lọc chuỗi ký tự (Data chữ) ---
    val_str = str(value) if value is not None else ""
    if op in ["equals", "==", "eq"]:
        return df[df[column].astype(str).str.strip() == val_str.strip()]
    elif op in ["contains", "contain"]:
        return df[df[column].astype(str).str.contains(val_str, case=False, na=False)]
    elif op in ["startswith", "starts_with"]:
        return df[df[column].astype(str).str.startswith(val_str, na=False)]
    elif op in ["endswith", "ends_with"]:
        return df[df[column].astype(str).str.endswith(val_str, na=False)]

    # --- Lọc ngày tháng (dtt) ---
    if op in ["after", "greater_than_date"]:
        dt_val = pd.to_datetime(value, errors="coerce")
        col_dt = pd.to_datetime(df[column], errors="coerce")
        return df[col_dt > dt_val]
    elif op in ["before", "less_than_date"]:
        dt_val = pd.to_datetime(value, errors="coerce")
        col_dt = pd.to_datetime(df[column], errors="coerce")
        return df[col_dt < dt_val]

    # --- Lọc số học ---
    try:
        num_val = float(value)
        num_col = pd.to_numeric(df[column], errors="coerce")
        if op in [">", "greater_than"]: return df[num_col > num_val]
        elif op in ["<", "less_than"]: return df[num_col < num_val]
        elif op in [">=", "greater_or_equal"]: return df[num_col >= num_val]
        elif op in ["<=", "less_or_equal"]: return df[num_col <= num_val]
        elif op in ["!=", "not_equal"]: return df[num_col != num_val]
    except Exception:
        pass

    return df


# 9. Hợp chữ / Ghép cột (Merge text columns)
def mergeTextColumns(
    df: pd.DataFrame,
    columns_to_merge: List[str],
    new_column_name: str,
    separator: str = " "
) -> pd.DataFrame:
    """Hợp nhất các cột chữ lại thành 1 cột mới (ví dụ: 'Họ' + 'Tên' -> 'Họ và Tên')"""
    df = df.copy()
    valid_cols = [c for c in columns_to_merge if c in df.columns]
    if len(valid_cols) < 2:
        return df

    merged_series = df[valid_cols[0]].astype(str).str.strip()
    for col in valid_cols[1:]:
        merged_series = merged_series + separator + df[col].astype(str).str.strip()

    df[new_column_name] = merged_series
    return df


# =============================================================================
# C. BỘ THÔNG DỊCH ĐỌC TRỰC TIẾP JSON CỦA FRONTEND REACT
# =============================================================================
def applyFrontendPipeline(df: pd.DataFrame, steps: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Nhận mảng các steps từ Frontend React (PipelinesPage.js) và thực thi tuần tự.
    Tương thích 100% với schema JSON của frontend!
    """
    res = df.copy()

    for step in steps:
        if not step.get("enabled", True):
            continue

        step_type = step.get("type")
        config = step.get("config", {})

        # 1. Select Columns
        if step_type == "select_columns":
            selected = config.get("selectedColumns")
            if selected:
                res = selectColumns(res, keep_columns=selected)

        # 2. Drop Duplicates
        elif step_type == "drop_duplicates":
            rules = config.get("rules", [])
            if rules:
                for r in rules:
                    cols = None if r.get("allColumns") else r.get("columns")
                    res = removeDuplicates(res, columns=cols, keep=r.get("keep", "first"))
            else:
                subset = config.get("subset")
                res = removeDuplicates(res, columns=subset, keep=config.get("keep", "first"))

        # 3. Handle NULL
        elif step_type == "handle_null":
            rules = config.get("rules", [])
            for r in rules:
                col = r.get("column")
                strat = r.get("strategy", "drop")
                val = r.get("customValue")
                res = handleNull(res, method=strat, columns=[col] if col else None, value=val)

        # 4. Cast Type
        elif step_type == "cast_type":
            conversions = config.get("conversions", [])
            for c in conversions:
                col = c.get("column")
                to_type = c.get("toType", "string")
                res = convertType(res, column=col, target_type=to_type)

        # 5. String Transform
        elif step_type == "string_transform":
            rules = config.get("rules", [])
            if rules:
                for r in rules:
                    col = r.get("column")
                    if r.get("trim"):
                        res = cleanString(res, column=col, action="strip")
                    case_mode = r.get("caseMode", "none")
                    if case_mode in ["upper", "lower", "title"]:
                        res = cleanString(res, column=col, action=case_mode)
            else:
                cols = config.get("columns", [])
                for col in cols:
                    if config.get("trim"):
                        res = cleanString(res, column=col, action="strip")
                    case_mode = config.get("caseMode", "none")
                    if case_mode in ["upper", "lower", "title"]:
                        res = cleanString(res, column=col, action=case_mode)

        # 6. Replace Value
        elif step_type == "replace_value":
            col = config.get("column")
            old_v = config.get("oldValue")
            new_v = config.get("newValue")
            res = replaceValue(res, column=col, old_val=old_v, new_val=new_v)

        # 7. Format DateTime
        elif step_type == "format_datetime":
            col = config.get("column")
            in_fmt = config.get("inputFormat", "auto")
            out_fmt = config.get("outputFormat", "YYYY-MM-DD")
            res = normalizeDate(res, column=col, date_format=out_fmt, input_format=in_fmt)

        # 8. Filter Rows
        elif step_type == "filter_rows":
            conditions = config.get("conditions", [])
            for cond in conditions:
                col = cond.get("column")
                op = cond.get("operator")
                val = cond.get("value")
                res = filterData(res, column=col, operator=op, value=val)

    return res
