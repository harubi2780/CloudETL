import React, { useState } from 'react';

export default function DataPreviewTable({
  dataset,
  beforeData,
  afterData,
  activeStep,
  stepIndex,
}) {
  const [activeTab, setActiveTab] = useState('after'); // 'before' or 'after'

  const currentData = activeTab === 'before' ? beforeData : afterData;
  const currentRows = currentData.rows || [];
  const currentColumns = currentData.columns || [];

  return (
    <div className="preview-table-container">
      <div className="preview-toolbar">
        <div className="preview-toolbar-left">
          <div className="preview-title-block">
            <span className="preview-heading-title">Sample preview (~10 rows)</span>
            <span className="preview-dataset-badge">{dataset.name}</span>
          </div>

          <div className="preview-tabs">
            <button
              type="button"
              className={`preview-tab-btn ${activeTab === 'before' ? 'active' : ''}`}
              onClick={() => setActiveTab('before')}
            >
              Before
            </button>
            <button
              type="button"
              className={`preview-tab-btn ${activeTab === 'after' ? 'active' : ''}`}
              onClick={() => setActiveTab('after')}
            >
              After
              {activeStep && (
                <span className="tab-step-tag">
                  (Step {stepIndex + 1})
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="preview-toolbar-right">
          <span className="preview-meta-pill">
            <strong>{currentColumns.length}</strong> column{currentColumns.length !== 1 ? 's' : ''}
          </span>
          <span className="preview-hint">Showing {currentRows.length} sample rows</span>
        </div>
      </div>

      <div className="preview-notice-banner">
        Preview uses sample rows only; actual results are available after a run.
      </div>

      <div className="table-responsive-wrapper">
        {currentColumns.length === 0 ? (
          <div className="table-empty-notice">No columns available to display.</div>
        ) : (
          <table className="preview-table">
            <thead>
              <tr>
                <th className="row-num-col">#</th>
                {currentColumns.map((col) => (
                  <th key={col.name}>
                    <div className="th-content">
                      <span className="th-name">{col.name}</span>
                      <span className="th-type">{col.type}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentRows.length === 0 ? (
                <tr>
                  <td colSpan={currentColumns.length + 1} className="empty-table-row">
                    No rows match the specified conditions.
                  </td>
                </tr>
              ) : (
                currentRows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    <td className="row-num-col">{rIdx + 1}</td>
                    {currentColumns.map((col) => {
                      const val = row[col.name];
                      const isNull = val === null || val === undefined || val === '';
                      return (
                        <td key={col.name} className={isNull ? 'null-cell' : ''}>
                          {isNull ? (
                            <span className="null-text">NULL</span>
                          ) : typeof val === 'boolean' ? (
                            <span className={`bool-badge ${val ? 'true' : 'false'}`}>
                              {val ? 'TRUE' : 'FALSE'}
                            </span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
