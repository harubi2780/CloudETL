"""Dependency-free JSON serializers; no DRF dependency is needed by this project."""
import math
import uuid

from .errors import ETLError

MAX_STEPS = 50
MAX_RULES = 50
MAX_SOURCES = 6
MAX_ROWS = 500_000
MAX_COLUMNS = 2048
MAX_CELLS = 1_000_000
MAX_MEMORY_BYTES = 128 * 1024 * 1024
MAX_RESULT_BYTES = 25 * 1024 * 1024
FORMATS = ("parquet", "csv", "tsv", "json", "xlsx")
OPERATIONS = {
    "select_columns": {"selectedColumns": "non-empty column list"},
    "drop_duplicates": {"rules": [{"allColumns": "boolean", "columns": "column list", "keep": ["first"]}]},
    "handle_null": {"rules": [{"column": "column", "strategy": ["drop", "mean", "custom"], "customValue": "scalar"}]},
    "cast_type": {"conversions": [{"column": "column", "toType": ["integer", "float", "string"]}]},
    "string_transform": {"rules": [{"column": "column", "trim": "boolean", "caseMode": ["none", "upper", "lower"]}]},
    "replace_value": {"column": "column", "oldValue": "scalar", "newValue": "scalar"},
    "format_datetime": {"column": "column", "inputFormat": ["auto"], "outputFormat": ["YYYY-MM-DD", "YYYY-MM-DD HH:mm:ss", "ISO_8601"]},
    "filter_rows": {"conditions": [{"column": "column", "operator": ["greater_than", "less_than", "greater_or_equal", "less_or_equal", "equals", "not_equals", "contains"], "value": "scalar (numeric for comparisons)"}]},
    "join": {"datasetId": "dataset UUID", "on": "column", "how": ["left", "right", "inner", "outer"]},
    "concat": {"datasetIds": "dataset UUID list"},
}


def invalid(path, message):
    raise ETLError(message, fields={path: [message]})


def object_fields(value, allowed, path, required=()):
    if not isinstance(value, dict):
        invalid(path, "Send an object.")
    if value.keys() - set(allowed):
        invalid(path, "Unknown fields are not allowed.")
    if set(required) - value.keys():
        invalid(path, "Required fields are missing.")
    return value


def text(value, path, max_length=255):
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        invalid(path, f"Enter a non-empty string up to {max_length} characters.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        invalid(path, "Enter valid Unicode text.")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        invalid(path, "Control characters are not allowed.")
    return value


def identifier(value, path):
    try:
        return str(uuid.UUID(text(value, path, 36)))
    except ValueError:
        invalid(path, "Enter a dataset UUID.")


def array(value, path, maximum=MAX_RULES, nonempty=True):
    if not isinstance(value, list) or len(value) > maximum or (nonempty and not value):
        invalid(path, f"Send {'1' if nonempty else '0'} to {maximum} items.")
    return value


def columns(value, path):
    result = [text(column, path) for column in array(value, path, MAX_COLUMNS)]
    if len(set(result)) != len(result):
        invalid(path, "Duplicate columns are not allowed.")
    return result


def choice(value, options, path):
    if not isinstance(value, str) or value not in options:
        invalid(path, "Unsupported option. Choose: " + ", ".join(options) + ".")
    return value


def boolean(value, path):
    if type(value) is not bool:
        invalid(path, "Enter true or false.")
    return value


def scalar(value, path):
    if value is not None and type(value) not in (str, int, float, bool):
        invalid(path, "Enter a scalar JSON value.")
    if isinstance(value, str) and len(value) > 4096:
        invalid(path, "The value exceeds 4096 characters.")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            finite = math.isfinite(value)
        except OverflowError:
            finite = False
        if not finite:
            invalid(path, "Enter a finite number.")
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            invalid(path, "Enter valid Unicode text.")
    return value


def validate_config(kind, raw, path):
    allowed = set(OPERATIONS[kind])
    # The current frontend also sends these two legacy configuration shapes.
    if kind == "string_transform":
        allowed |= {"columns", "trim", "caseMode"}
    config = object_fields(raw, allowed, path)
    if kind == "select_columns":
        return {"selectedColumns": columns(config.get("selectedColumns"), path)}
    if kind == "join":
        return {"datasetId": identifier(config.get("datasetId"), path), "on": text(config.get("on"), path),
                "how": choice(config.get("how", "left"), ("left", "right", "inner", "outer"), path)}
    if kind == "concat":
        ids = [identifier(value, path) for value in array(config.get("datasetIds"), path, MAX_SOURCES - 1)]
        if len(ids) != len(set(ids)):
            invalid(path, "Duplicate dataset IDs are not allowed.")
        return {"datasetIds": ids}
    if kind == "replace_value":
        object_fields(config, allowed, path, ("column", "oldValue", "newValue"))
        return {"column": text(config["column"], path), "oldValue": scalar(config["oldValue"], path), "newValue": scalar(config["newValue"], path)}
    if kind == "format_datetime":
        return {"column": text(config.get("column"), path),
                "inputFormat": choice(config.get("inputFormat", "auto"), ("auto",), path),
                "outputFormat": choice(config.get("outputFormat", "YYYY-MM-DD"), ("YYYY-MM-DD", "YYYY-MM-DD HH:mm:ss", "ISO_8601"), path)}
    if kind == "string_transform" and "rules" not in config:
        config = {"rules": [{"column": col, "trim": config.get("trim", False), "caseMode": config.get("caseMode", "none")}
                            for col in columns(config.get("columns"), path)]}
    elif kind == "string_transform" and len(config) != 1:
        invalid(path, "Use rules or the columns form, not both.")
    key = "conversions" if kind == "cast_type" else "conditions" if kind == "filter_rows" else "rules"
    rules = []
    for index, item in enumerate(array(config.get(key), path)):
        location = f"{path}.{key}.{index}"
        if kind == "drop_duplicates":
            rule = object_fields(item, ("allColumns", "columns", "keep", "orderBy"), location)
            all_columns = boolean(rule.get("allColumns", False), location)
            selected = [] if all_columns else columns(rule.get("columns"), location)
            if all_columns and rule.get("columns") not in (None, []):
                invalid(location, "All-columns rules must have an empty columns list.")
            choice(rule.get("keep", "first"), ("first",), location)
            if rule.get("orderBy", "") != "":
                invalid(location, "Ordering duplicates is not supported by the tool.")
            rules.append({"allColumns": all_columns, "columns": selected, "keep": "first"})
            continue
        allowed_rule = {"column", "strategy", "customValue"} if kind == "handle_null" else {"column", "toType"} if kind == "cast_type" else {"column", "trim", "caseMode"} if kind == "string_transform" else {"column", "operator", "value"}
        rule = object_fields(item, allowed_rule, location)
        result = {"column": text(rule.get("column"), location)}
        if kind == "handle_null":
            aliases = {"drop_row": "drop", "fill_mean": "mean", "fill_custom": "custom"}
            strategy = rule.get("strategy")
            if isinstance(strategy, str):
                strategy = aliases.get(strategy, strategy)
            result["strategy"] = choice(strategy, ("drop", "mean", "custom"), location)
            if strategy == "custom" and ("customValue" not in rule or rule["customValue"] is None):
                invalid(location, "Custom fill requires a non-null value.")
            result["customValue"] = scalar(rule.get("customValue"), location)
        elif kind == "cast_type":
            result["toType"] = choice(rule.get("toType"), ("integer", "float", "string"), location)
        elif kind == "string_transform":
            result["trim"] = boolean(rule.get("trim", False), location)
            result["caseMode"] = choice(rule.get("caseMode", "none"), ("none", "upper", "lower"), location)
        else:
            result["operator"] = choice(rule.get("operator"), ("greater_than", "less_than", "greater_or_equal", "less_or_equal", "equals", "not_equals", "contains"), location)
            object_fields(rule, allowed_rule, location, ("value",))
            result["value"] = scalar(rule["value"], location)
            if result["operator"] == "contains":
                if not isinstance(result["value"], str) or not result["value"]:
                    invalid(location, "Contains requires a non-empty literal string.")
            else:
                try:
                    if isinstance(result["value"], bool) or not math.isfinite(float(result["value"])):
                        raise ValueError
                except (ValueError, TypeError, OverflowError):
                    invalid(location, "This comparison requires a finite numeric value.")
        rules.append(result)
    return {key: rules}


class PipelineSerializer:
    """Validate into a canonical configuration suitable for JSONField persistence."""

    def __init__(self, data):
        self.initial_data = data
        self.validated_data = None

    def is_valid(self, *, raise_exception=False):
        try:
            payload = object_fields(self.initial_data, ("name", "datasetId", "steps", "updatedAt", "schemaVersion"), "pipeline")
            if type(payload.get("schemaVersion", 1)) is not int or payload.get("schemaVersion", 1) != 1:
                invalid("schemaVersion", "Only schema version 1 is supported.")
            if "updatedAt" in payload:
                text(payload["updatedAt"], "updatedAt", 64)
            steps = []
            for index, raw in enumerate(array(payload.get("steps"), "steps", MAX_STEPS, nonempty=False)):
                path = f"steps.{index}"
                step = object_fields(raw, ("id", "name", "type", "config", "enabled"), path, ("type", "config"))
                for metadata in ("id", "name"):
                    if metadata in step:
                        text(step[metadata], f"{path}.{metadata}", 120)
                kind = choice(step["type"], tuple(OPERATIONS), f"{path}.type")
                steps.append({"type": kind, "enabled": boolean(step.get("enabled", True), f"{path}.enabled"),
                              "config": validate_config(kind, step["config"], f"{path}.config")})
            self.validated_data = {"schemaVersion": 1, "name": text(payload.get("name"), "name", 120),
                                   "datasetId": identifier(payload.get("datasetId"), "datasetId"), "steps": steps}
            if len(source_ids(self.validated_data)) > MAX_SOURCES:
                invalid("steps", f"A run may use at most {MAX_SOURCES} datasets.")
            return True
        except ETLError:
            if raise_exception:
                raise
            return False


def source_ids(config):
    ids = [config["datasetId"]]
    for step in config["steps"]:
        if step["enabled"] and step["type"] == "join":
            ids.append(step["config"]["datasetId"])
        if step["enabled"] and step["type"] == "concat":
            ids.extend(step["config"]["datasetIds"])
    return list(dict.fromkeys(ids))
