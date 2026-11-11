// src/lib/pipeline/schema.js
// Pure functions that compute the column schema for a pipeline at a given step.
// The schema is an array of objects:
//   { name: string, type: string, status: "active" | "dropped" | "changed", droppedInStep?: number, changedInStep?: number }
//   status defaults to "active".
// The functions do not depend on any React state and are safe to import from any component.

/**
 * Apply a single step that mutates the schema.
 * Only steps that affect column presence or type are handled here.
 * Other steps are ignored (they do not modify the schema).
 */
function applyStepToSchema(schema, step, stepIdx) {
  // Work on a shallow copy of each column object to keep immutability.
  const newSchema = schema.map(col => ({ ...col }));

  if (!step.enabled) return newSchema;

  const { type, config } = step;

  switch (type) {
    case 'select_columns': {
      // config.selectedColumns is an array of column names to keep.
      const keepSet = new Set(config.selectedColumns || []);
      return newSchema.map(col => {
        if (!keepSet.has(col.name) && col.status !== 'dropped') {
          // Mark as dropped.
          return {
            ...col,
            status: 'dropped',
            droppedInStep: stepIdx + 1, // human‑friendly step number (1‑based)
          };
        }
        return col;
      });
    }
    case 'cast_type': {
      // config.conversions is [{ column, toType }]
      const convMap = new Map();
      (config.conversions || []).forEach(c => {
        if (c.column && c.toType) convMap.set(c.column, c.toType);
      });
      return newSchema.map(col => {
        if (convMap.has(col.name) && col.status !== 'dropped') {
          return {
            ...col,
            type: convMap.get(col.name),
            status: 'changed',
            changedInStep: stepIdx + 1,
          };
        }
        return col;
      });
    }
    case 'format_datetime': {
      // config.column is the target column name (or inferred by default).
      const target = config.column;
      if (!target) return newSchema;
      return newSchema.map(col => {
        if (col.name === target && col.status !== 'dropped') {
          return {
            ...col,
            type: 'datetime',
            status: 'changed',
            changedInStep: stepIdx + 1,
          };
        }
        return col;
      });
    }
    // Other step types (e.g., handle_null, drop_duplicates, filter_rows, replace_value, string_transform) do not affect the column list.
    default:
      return newSchema;
  }
}

/**
 * Compute the column schema after applying steps up to and including `stepIndex`.
 *
 * @param {Array} baseSchema - initial schema from the selected dataset, e.g. [{name, type}]
 * @param {Array} steps - pipeline steps array (ordered)
 * @param {number} stepIndex - zero‑based index of the step to compute the schema for.
 * @returns {Array} schema for that point in the pipeline.
 */
export function computeSchemaAtStep(baseSchema, steps, stepIndex) {
  if (!Array.isArray(baseSchema)) return [];
  // Initialise each column with default status.
  let schema = baseSchema.map(col => ({
    name: col.name,
    type: col.type,
    status: 'active',
  }));

  const limit = Math.min(stepIndex, steps.length - 1);
  for (let i = 0; i <= limit; i++) {
    schema = applyStepToSchema(schema, steps[i], i);
  }
  return schema;
}

/**
 * Return only the active columns (those not dropped).
 */
export function getActiveColumns(schema) {
  return schema.filter(col => col.status !== 'dropped');
}

/**
 * Generate warnings for a step based on the schema that will be presented to the user.
 * For now we only warn when a step references a column that has been dropped or changed
 * in a previous step. The UI can decide how to render the warning.
 */
export function getWarningsForStep(schemaBeforeStep, step) {
  const warnings = [];
  if (!step.enabled) return warnings;
  const { type, config } = step;
  // Helper to test a column name against the schema.
  const findCol = name => schemaBeforeStep.find(c => c.name === name);

  switch (type) {
    case 'cast_type': {
      (config.conversions || []).forEach(c => {
        const col = findCol(c.column);
        if (!col) return; // column does not exist – UI already handles.
        if (col.status === 'dropped') {
          warnings.push(`${c.column} was dropped earlier`);
        } else if (col.status === 'changed' && col.changedInStep < (step.changedInStep || 0)) {
          warnings.push(`${c.column} was already changed in step ${col.changedInStep}`);
        }
      });
      break;
    }
    case 'format_datetime': {
      const target = config.column;
      const col = findCol(target);
      if (col) {
        if (col.status === 'dropped') warnings.push(`${target} was dropped earlier`);
        else if (col.status === 'changed' && col.changedInStep < (step.changedInStep || 0)) {
          warnings.push(`${target} was already changed in step ${col.changedInStep}`);
        }
      }
      break;
    }
    // Add other step types as needed.
    default:
      break;
  }
  return warnings;
}

export default {
  computeSchemaAtStep,
  getActiveColumns,
  getWarningsForStep,
};
