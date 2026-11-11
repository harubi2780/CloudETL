import React from 'react';
import ColumnPicker from '../ColumnPicker';

export default function SelectColumnsConfig({ config, onChange, columns }) {
  const selectedColumns = config.selectedColumns || [];

  const handleColumnsChange = (nextCols) => {
    onChange({
      ...config,
      selectedColumns: nextCols,
    });
  };

  return (
    <div className="config-form-section">
      <ColumnPicker
        columns={columns}
        selectedColumns={selectedColumns}
        onChange={handleColumnsChange}
        label="Select Columns to Retain"
        helperText="Unchecked columns will be excluded from the resulting dataset."
      />
    </div>
  );
}
