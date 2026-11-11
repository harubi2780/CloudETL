// src/lib/pipeline/schema.js
// Pure functions that compute the column schema for a pipeline at a given step.
// The schema is an array of objects:
//   { name: string, type: string, status: "active" | "dropped" | "changed", droppedInStep?: number, changedInStep?: number }
//   status defaults to "active".
// The functions do not depend on any React state and are safe to import from any component.

import { applyToSchema } from '../mock/pipelineDefaults';

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

  const pipelineSteps = Array.isArray(steps) ? steps : [];
  const limit = Math.min(stepIndex, pipelineSteps.length - 1);
  for (let i = 0; i <= limit; i++) {
    schema = applyToSchema(schema, pipelineSteps[i], i);
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
 * Report references to columns that were dropped or changed by earlier steps.
 */
export function getWarningsForStep(schemaBeforeStep, step, stepIndex = 0) {
  if (!step.enabled) return [];

  const config = step.config || {};
  const columnNames = (columns) => (Array.isArray(columns) ? columns : []).filter(Boolean);
  const references = {
    select_columns: columnNames(config.selectedColumns),
    drop_duplicates: columnNames(config.subset),
    handle_null: Array.isArray(config.rules)
      ? config.rules.map((rule) => rule.column)
      : columnNames(config.columns || (config.column ? [config.column] : [])),
    cast_type: Array.isArray(config.conversions)
      ? config.conversions.map((conversion) => conversion.column)
      : [config.column],
    string_transform: Array.isArray(config.rules)
      ? config.rules.map((rule) => rule.column)
      : columnNames(config.columns || (config.column ? [config.column] : [])),
    filter_rows: Array.isArray(config.conditions)
      ? config.conditions.map((condition) => condition.column)
      : [config.column],
    replace_value: [config.column],
    format_datetime: [config.column],
  }[step.type] || [];

  const warnings = new Map();
  columnNames(references).forEach((columnName) => {
    const column = schemaBeforeStep.find((item) => item.name === columnName);
    if (!column) return;

    if (column.status === 'dropped') {
      warnings.set(columnName, {
        type: 'dropped',
        column: columnName,
        previousStep: column.droppedInStep,
        step: stepIndex + 1,
      });
    } else if (column.status === 'changed' && column.changedInStep < stepIndex + 1) {
      warnings.set(columnName, {
        type: 'changed',
        column: columnName,
        previousStep: column.changedInStep,
        step: stepIndex + 1,
      });
    }
  });

  return Array.from(warnings.values());
}

const schemaHelpers = {
  computeSchemaAtStep,
  getActiveColumns,
  getWarningsForStep,
};

export default schemaHelpers;
