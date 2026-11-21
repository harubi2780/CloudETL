import {
  CAST_TYPES,
  computeColumnDiff,
  dataType,
  defaultOperatorForType,
  describeStep,
  FILTER_OPERATORS_BY_TYPE,
  filterOperatorsForType,
  newStep,
  nextSchema,
  normalizeCastType,
  operations,
  schemasFor,
  sourceIds,
  validateWorkflow,
} from './workflow';

const primary = {
  id: 'orders', filename: 'orders.csv', size_bytes: 100, status: 'ready',
  columns: [{ name: 'id', type: 'string' }, { name: 'amount', type: 'string' }, { name: 'city', type: 'string' }],
};
const customers = {
  id: 'customers', filename: 'customers.csv', size_bytes: 80, status: 'ready',
  columns: [{ name: 'id', type: 'string' }, { name: 'city', type: 'string' }, { name: 'phone', type: 'string' }],
};
const caps = {
  operations: Object.fromEntries(operations.map(({ type }) => [type, {}])),
  limits: { maxSources: 6, maxSteps: 50, maxCombinedInputBytes: 26214400 },
};
const step = (type, config, enabled = true) => ({ type, config, enabled });
const payload = (steps = [], overrides = {}) => ({ name: 'Clean orders', datasetId: primary.id, steps, ...overrides });
const errors = (steps = [], sources = [primary], overrides = {}, capabilities = caps) => validateWorkflow(payload(steps, overrides), sources, capabilities);

describe('workflow schema projection', () => {
  test('normalizes pandas and tool dtype names for controls', () => {
    expect(['bool', 'boolean', 'int64', 'UInt32', 'float64', 'decimal128', 'datetime64[ns]', 'dtt', 'str', 'object'].map(dataType))
      .toEqual(['boolean', 'boolean', 'integer', 'integer', 'float', 'float', 'datetime', 'datetime', 'string', 'string']);
  });

  test('select and cast schema changes follow the requested order without changing source metadata', () => {
    const steps = [step('select_columns', { selectedColumns: ['amount', 'id'] }),
      step('cast_type', { conversions: [{ column: 'amount', toType: 'float' }] }),
      step('select_columns', { selectedColumns: ['id', 'amount'] })];
    const result = schemasFor(primary.id, steps, [primary]);
    expect(result.before[0]).toEqual(primary.columns);
    expect(result.before[1].map((column) => column.name)).toEqual(['amount', 'id']);
    expect(result.before[2]).toEqual([{ name: 'amount', type: 'float' }, { name: 'id', type: 'string' }]);
    expect(result.final).toEqual([{ name: 'id', type: 'string' }, { name: 'amount', type: 'float' }]);
    expect(primary.columns[1]).toEqual({ name: 'amount', type: 'string' });
  });

  test('join projects pandas suffixes while keeping a single shared key', () => {
    const result = nextSchema(primary.columns, step('join', { datasetId: customers.id, on: 'id', how: 'left' }), [primary, customers]);
    expect(result.map((column) => column.name)).toEqual(['id', 'amount', 'city_x', 'city_y', 'phone']);
    expect(customers.columns.map((column) => column.name)).toEqual(['id', 'city', 'phone']);
  });

  test('append unions columns in order and treats numeric/text conflicts as text', () => {
    const source = { ...customers, columns: [{ name: 'id', type: 'integer' }, { name: 'phone', type: 'string' }] };
    expect(nextSchema(primary.columns, step('concat', { datasetIds: [source.id] }), [primary, source]))
      .toEqual([...primary.columns, { name: 'phone', type: 'string' }]);
  });

  test('append promotes mixed integer/float columns to float and permits subsequent numeric operations', () => {
    const left = { ...primary, columns: [{ name: 'amount', type: 'integer' }] };
    const right = { ...customers, columns: [{ name: 'amount', type: 'float' }] };
    const steps = [step('concat', { datasetIds: [right.id] }), step('handle_null', { rules: [{ column: 'amount', strategy: 'mean' }] })];
    expect(schemasFor(left.id, steps, [left, right]).before[1]).toEqual([{ name: 'amount', type: 'float' }]);
    expect(errors(steps, [left, right])).toEqual([]);
    expect(nextSchema(right.columns, step('concat', { datasetIds: [left.id] }), [left]))
      .toEqual([{ name: 'amount', type: 'float' }]);
  });

  test('string cleanup converts affected numeric columns to text while a no-op preserves the type', () => {
    const source = [{ name: 'amount', type: 'integer' }, { name: 'quantity', type: 'float' }];
    expect(nextSchema(source, step('string_transform', { rules: [{ column: 'amount', trim: true, caseMode: 'none' }] }), []))
      .toEqual([{ name: 'amount', type: 'string' }, { name: 'quantity', type: 'float' }]);
    expect(nextSchema(source, step('string_transform', { rules: [{ column: 'quantity', trim: false, caseMode: 'upper' }] }), []))
      .toEqual([{ name: 'amount', type: 'integer' }, { name: 'quantity', type: 'string' }]);
    expect(nextSchema(source, step('string_transform', { rules: [{ column: 'amount', trim: false, caseMode: 'none' }] }), []))
      .toEqual(source);
    const numeric = { ...primary, columns: source };
    const clean = step('string_transform', { rules: [{ column: 'amount', trim: true, caseMode: 'none' }] });
    const mean = step('handle_null', { rules: [{ column: 'amount', strategy: 'mean' }] });
    expect(errors([clean, mean], [numeric])).toContain('Step 2: this operation needs a numeric column; convert it first.');
  });

  test('date formatting produces text and disabled steps do not affect schemas', () => {
    const source = [{ name: 'when', type: 'datetime' }];
    expect(nextSchema(source, step('format_datetime', { column: 'when' }), [])).toEqual([{ name: 'when', type: 'string' }]);
    expect(nextSchema(source, step('select_columns', { selectedColumns: [] }, false), [])).toBe(source);
  });

  test('schema-less sources and no steps are handled without fake columns', () => {
    expect(schemasFor('missing', [], [])).toEqual({ before: [], final: [], bySource: {}, sourcesBefore: [] });
  });
});

describe('source IDs and operation defaults', () => {
  test('source IDs deduplicate enabled joins and appends and can include disabled references', () => {
    const config = payload([
      step('join', { datasetId: customers.id }),
      step('concat', { datasetIds: [customers.id, 'third', ''] }),
      step('join', { datasetId: 'disabled' }, false),
    ]);
    expect(sourceIds(config)).toEqual([primary.id, customers.id, 'third']);
    expect(sourceIds(config, true)).toEqual([primary.id, customers.id, 'third', 'disabled']);
  });

  test('omitted enabled defaults to active for source collection and schema changes', () => {
    const config = payload([{ type: 'join', config: { datasetId: customers.id, on: 'id', how: 'left' } },
      { type: 'concat', config: { datasetIds: ['third'] } }]);
    expect(sourceIds(config)).toEqual([primary.id, customers.id, 'third']);
    expect(nextSchema(primary.columns, { type: 'select_columns', config: { selectedColumns: ['amount'] } }, []))
      .toEqual([{ name: 'amount', type: 'string' }]);
  });

  test('all eleven defaults use supported backend enums and choose real columns/sources', () => {
    const defaults = Object.fromEntries(operations.map(({ type }) => [type, newStep(type, primary.columns, [primary, customers], primary.id)]));
    expect(Object.keys(defaults)).toHaveLength(11);
    expect(Object.values(defaults).every((item) => item.enabled && item.name && item.config)).toBe(true);
    expect(defaults.merge_columns.config).toEqual({ columns: ['id', 'amount'], newColumnName: 'merged_column', separator: ' ' });
    expect(defaults.drop_duplicates.config.rules[0]).toEqual({ allColumns: true, columns: [], keep: 'first' });
    expect(defaults.cast_type.config.conversions[0]).toEqual({ column: 'id', toType: 'str' });
    expect(defaults.string_transform.config.rules[0].caseMode).toBe('none');
    expect(defaults.handle_null.config.rules[0].strategy).toBe('drop');
    expect(defaults.join.config).toEqual({ datasetId: customers.id, on: 'id', how: 'left' });
    expect(defaults.concat.config.datasetIds).toEqual([customers.id]);
    expect(defaults.format_datetime.config).toMatchObject({ inputFormat: 'auto', outputFormat: 'YYYY-MM-DD' });
  });

  test('defaults without source columns are incomplete rather than inventing data', () => {
    expect(newStep('join', [], [], '').config).toEqual({ datasetId: '', on: '', how: 'left' });
    expect(newStep('select_columns', [], [], '').config).toEqual({ selectedColumns: [] });
  });
});

describe('workflow validation', () => {
  test('empty-step and all-disabled-step pipelines are blocked from running', () => {
    expect(errors()).toEqual(['Add at least one enabled transformation step before running the pipeline.']);
    expect(errors([step('select_columns', { selectedColumns: ['id'] }, false)]))
      .toContain('Add at least one enabled transformation step before running the pipeline.');
  });

  test('unused selected sources must be combined or removed', () => {
    expect(errors([], [primary, customers])).toContain('Some selected sources are unused. Add a Join or Append step, or remove them.');
    expect(errors([step('concat', { datasetIds: [customers.id] })], [primary, customers])).toEqual([]);
  });

  test('disabled combination does not count as using an extra source', () => {
    expect(errors([step('join', { datasetId: customers.id, on: 'id', how: 'left' }, false)], [primary, customers]))
      .toContain('Some selected sources are unused. Add a Join or Append step, or remove them.');
  });

  test('source preview failure and missing starting source block submission', () => {
    expect(errors([], [{ ...primary, status: 'error' }])).toContain('Every selected source must have a successful preview before running.');
    expect(errors([], [], { datasetId: '' })).toContain('Choose a starting dataset.');
  });

  test('numeric operations require conversion first and see the schema after conversion', () => {
    const mean = step('handle_null', { rules: [{ column: 'amount', strategy: 'mean' }] });
    expect(errors([mean])).toContain('Step 1: this operation needs a numeric column; convert it first.');
    const conversion = step('cast_type', { conversions: [{ column: 'amount', toType: 'float' }] });
    expect(errors([conversion, mean])).toEqual([]);
    const formatted = step('format_datetime', { column: 'amount', outputFormat: 'YYYY-MM-DD' });
    expect(errors([conversion, formatted, mean])).toContain('Step 3: this operation needs a numeric column; convert it first.');
  });

  test('references to dropped columns and joins without a shared key are rejected', () => {
    expect(errors([step('select_columns', { selectedColumns: ['id'] }), step('replace_value', { column: 'city', oldValue: 'A', newValue: 'B' })]))
      .toContain('Step 2: a referenced column is missing or was removed earlier.');
    expect(errors([step('join', { datasetId: customers.id, on: 'amount', how: 'left' })], [primary, customers]))
      .toContain('Step 1: choose a source and a shared join column.');
  });

  test('join suffix collisions are caught before execution', () => {
    const collision = { ...primary, columns: [...primary.columns, { name: 'city_x', type: 'string' }] };
    expect(errors([step('join', { datasetId: customers.id, on: 'id', how: 'left' })], [collision, customers]))
      .toContain('Step 1: the result would contain duplicate column names.');
  });

  test('zero numeric filter value and an empty replacement remain valid', () => {
    const numeric = { ...primary, columns: [{ name: 'amount', type: 'float' }] };
    expect(errors([step('filter_rows', { conditions: [{ column: 'amount', operator: 'greater_than', value: 0 }] }),
      step('replace_value', { column: 'amount', oldValue: 0, newValue: '' })], [numeric])).toEqual([]);
    expect(errors([step('filter_rows', { conditions: [{ column: 'amount', operator: 'contains', value: '' }] })]))
      .toContain('Step 1: enter a valid filter value.');
  });

  test('empty rules, empty column selections, and unknown operations are rejected', () => {
    expect(errors([step('handle_null', { rules: [] })])).toContain('Step 1: configure between 1 and 50 rules.');
    expect(errors([step('select_columns', { selectedColumns: [] })])).toContain('Step 1: select at least one column.');
    expect(errors([step('arbitrary_operation', {})])).toContain('Step 1: this operation is unavailable.');
  });

  test('empty and overly long names are rejected', () => {
    expect(errors([], [primary], { name: '   ' })).toContain('Enter a pipeline name up to 120 characters.');
    expect(errors([], [primary], { name: 'x'.repeat(121) })).toContain('Enter a pipeline name up to 120 characters.');
  });

  test('source count, combined byte, and step limits come from capabilities', () => {
    const low = { ...caps, limits: { maxSources: 1, maxCombinedInputBytes: 1, maxSteps: 1 } };
    const actual = errors([step('join', { datasetId: customers.id, on: 'id' }), step('select_columns', { selectedColumns: ['id'] })], [primary, customers], {}, low);
    expect(actual).toEqual(expect.arrayContaining(['Select at most 1 sources.', 'The combined source size exceeds the processing limit.', 'The pipeline has too many steps.']));
  });

  test('request size uses UTF-8 bytes and rejects JSON over 16 KiB', () => {
    const actual = errors([step('replace_value', { column: 'city', oldValue: 'A', newValue: '漢'.repeat(6000) })]);
    expect(actual).toContain('The pipeline configuration exceeds the 16 KiB request limit.');
  });

  test('merge_columns, median, and new filter operators validate schemas and values', () => {
    expect(nextSchema(primary.columns, step('merge_columns', { columns: ['id', 'city'], newColumnName: 'id_city', separator: '-' }), []))
      .toEqual([...primary.columns, { name: 'id_city', type: 'string' }]);
    expect(errors([step('merge_columns', { columns: ['id'], newColumnName: 'x', separator: ' ' })]))
      .toContain('Step 1: select at least two columns to merge.');
    expect(errors([step('merge_columns', { columns: ['id', 'city'], newColumnName: 'city', separator: ' ' })]))
      .toContain('Step 1: the result would contain duplicate column names.');
    expect(errors([step('handle_null', { rules: [{ column: 'city', strategy: 'median' }] })]))
      .toContain('Step 1: this operation needs a numeric column; convert it first.');
    expect(errors([step('filter_rows', { conditions: [
      { column: 'city', operator: 'equals', value: 'HCM' },
      { column: 'city', operator: 'starts_with', value: 'H' },
    ] })])).toEqual([]);
    const typedSource = {
      ...primary,
      columns: [
        { name: 'city', type: 'str' },
        { name: 'qty', type: 'int64' },
        { name: 'paid', type: 'boolean' },
        { name: 'order_date', type: 'datetime' },
      ],
    };
    expect(errors([step('filter_rows', { conditions: [
      { column: 'city', operator: 'equals', value: 'HCM' },
      { column: 'qty', operator: 'greater_than', value: 1 },
      { column: 'paid', operator: 'is_true', value: null },
      { column: 'order_date', operator: 'after', value: '2026-01-01' },
    ] })], [typedSource])).toEqual([]);
    expect(errors([step('filter_rows', { conditions: [
      { column: 'city', operator: 'is_true', value: null },
      { column: 'city', operator: 'after', value: '2026-01-01' },
      { column: 'qty', operator: 'contains', value: '5' },
      { column: 'paid', operator: 'equals', value: 'true' },
      { column: 'order_date', operator: 'starts_with', value: '2026' },
    ] })], [typedSource])).toEqual([
      'Step 1: filter operator "is_true" is not supported for string columns.',
      'Step 1: filter operator "after" is not supported for string columns.',
      'Step 1: filter operator "contains" is not supported for integer columns.',
      'Step 1: filter operator "equals" is not supported for boolean columns.',
      'Step 1: filter operator "starts_with" is not supported for datetime columns.',
    ]);
  });

  test('R2–R4 helpers: format_datetime default, cast_type restrictions, and per-type filter operators', () => {
    const mixedCols = [{ name: 'id', type: 'str' }, { name: 'order_date', type: 'datetime' }, { name: 'paid', type: 'bool' }];
    expect(newStep('format_datetime', mixedCols, [primary], primary.id).config.column).toBe('order_date');
    expect(newStep('format_datetime', primary.columns, [primary], primary.id).config.column).toBe('');

    expect(CAST_TYPES).toEqual(['str', 'int', 'float', 'date']);
    expect(normalizeCastType('string')).toBe('str');
    expect(normalizeCastType('integer')).toBe('int');
    expect(normalizeCastType('datetime')).toBe('date');
    expect(normalizeCastType('boolean')).toBe('boolean');

    expect(errors([step('cast_type', { conversions: [{ column: 'amount', toType: 'boolean' }] })]))
      .toContain('Step 1: choose a supported target type (str, int, float, or date).');
    expect(errors([step('cast_type', { conversions: [{ column: 'amount', toType: 'bool' }] })]))
      .toContain('Step 1: choose a supported target type (str, int, float, or date).');
    expect(errors([step('cast_type', { conversions: [{ column: 'amount', toType: 'date' }] })])).toEqual([]);
    expect(nextSchema(primary.columns, step('cast_type', { conversions: [{ column: 'amount', toType: 'date' }] }), [])[1])
      .toEqual({ name: 'amount', type: 'datetime' });

    expect(filterOperatorsForType('int64')).toEqual(FILTER_OPERATORS_BY_TYPE.integer);
    expect(filterOperatorsForType('float64')).toEqual(FILTER_OPERATORS_BY_TYPE.float);
    expect(filterOperatorsForType('str')).toEqual(FILTER_OPERATORS_BY_TYPE.string);
    expect(filterOperatorsForType('date')).toEqual(FILTER_OPERATORS_BY_TYPE.datetime);
    expect(filterOperatorsForType('bool')).toEqual(FILTER_OPERATORS_BY_TYPE.boolean);
    expect(filterOperatorsForType('')).toEqual([]);
    expect(defaultOperatorForType('datetime')).toBe('after');
    expect(defaultOperatorForType('bool')).toBe('is_true');
  });

  test('R6 helpers: describeStep formats all 11 operations and computeColumnDiff normalizes types', () => {
    const meta = { orders: { filename: 'orders.csv' }, customers: { filename: 'customers.tsv' } };
    expect(describeStep({ type: 'select_columns', config: { selectedColumns: ['id', 'amount'] } })).toBe('Keep 2 columns: id, amount');
    expect(describeStep({ type: 'merge_columns', config: { columns: ['id', 'city'], newColumnName: 'id_city', separator: '-' } }))
      .toBe('Merge id, city into "id_city" (separator: "-")');
    expect(describeStep({ type: 'drop_duplicates', config: { rules: [{ allColumns: false, columns: ['id'], keep: 'last' }] } }))
      .toBe('Remove duplicates on id (keep last)');
    expect(describeStep({ type: 'handle_null', config: { rules: [{ column: 'amount', strategy: 'fill_mean' }, { column: 'city', strategy: 'custom', customValue: 'N/A' }] } }))
      .toBe('Missing values: fill amount with mean; fill city with "N/A"');
    expect(describeStep({ type: 'cast_type', config: { conversions: [{ column: 'amount', toType: 'float' }] } }))
      .toBe('Convert amount → float');
    expect(describeStep({ type: 'string_transform', config: { columns: ['city'], trim: true, caseMode: 'upper' } }))
      .toBe('city (trim whitespace, case: upper)');
    expect(describeStep({ type: 'filter_rows', config: { conditions: [{ column: 'paid', operator: 'is_true', value: null }, { column: 'amount', operator: 'greater_than', value: 5 }] } }))
      .toBe('Keep rows where paid is true AND amount > 5');
    expect(describeStep({ type: 'replace_value', config: { column: 'city', oldValue: 'A', newValue: 'B' } }))
      .toBe('In city, replace "A" with "B"');
    expect(describeStep({ type: 'format_datetime', config: { column: 'order_date', inputFormat: 'auto', outputFormat: 'YYYY-MM-DD' } }))
      .toBe('Format order_date (auto → YYYY-MM-DD)');
    expect(describeStep({ type: 'join', config: { datasetId: 'customers', on: 'id', how: 'inner' } }, meta))
      .toBe('Inner join with customers.tsv on "id"');
    expect(describeStep({ type: 'concat', config: { datasetIds: ['customers'] } }, meta))
      .toBe('Append rows from customers.tsv');
    expect(describeStep({ type: 'unknown_op', name: 'Fallback op' })).toBe('Fallback op');

    expect(computeColumnDiff(
      [{ name: 'id', type: 'str' }, { name: 'amount', type: 'str' }, { name: 'drop_me', type: 'int' }],
      [{ name: 'id', type: 'string' }, { name: 'amount', type: 'float' }, { name: 'new_col', type: 'datetime' }]
    )).toEqual({
      added: ['new_col'],
      removed: ['drop_me'],
      typeChanges: [{ name: 'amount', from: 'string', to: 'float' }],
    });
  });

  test('per-source steps update secondary schemas before join and still flag uncombined sources', () => {
    const cleanCustomer = { ...step('select_columns', { selectedColumns: ['id', 'phone'] }), sourceId: customers.id };
    const cleanCast = { ...step('cast_type', { conversions: [{ column: 'phone', toType: 'integer' }] }), sourceId: customers.id };
    expect(errors([cleanCustomer], [primary, customers]))
      .toContain('Some selected sources are unused. Add a Join or Append step, or remove them.');
    const join = step('join', { datasetId: customers.id, on: 'id', how: 'left' });
    const projected = schemasFor(primary.id, [cleanCustomer, cleanCast, join], [primary, customers]);
    expect(projected.final).toEqual([
      { name: 'id', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'city', type: 'string' },
      { name: 'phone', type: 'integer' },
    ]);
    expect(errors([cleanCustomer, cleanCast, join], [primary, customers])).toEqual([]);
    expect(sourceIds(payload([cleanCustomer]))).toEqual([primary.id, customers.id]);
    expect(errors([{ ...join, sourceId: customers.id }], [primary, customers]))
      .toContain('Step 1: combine steps always run on the starting dataset.');
  });
});
