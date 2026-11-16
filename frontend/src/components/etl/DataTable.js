function CellValue({ value }) {
  if (value === null) return <span className="etl-null" aria-label="Null value">NULL</span>;
  if (value === undefined) return <span className="etl-null" aria-label="Missing value">Missing</span>;
  if (value === '') return <span className="etl-null" aria-label="Empty string">Empty string</span>;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DataTable({ columns = [], rows = [], caption = 'Result rows' }) {
  if (columns.length === 0) return <p className="etl-empty">This result has no columns.</p>;
  return (
    <div className="etl-table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="etl-table etl-data-table">
        <caption>{caption}</caption>
        <thead><tr>{columns.map((column) => (
          <th key={column.name} scope="col">{column.name}<span className="etl-column-type">{column.type}</span></th>
        ))}</tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={index}>{columns.map((column) => <td key={column.name}><CellValue value={row[column.name]} /></td>)}</tr>
        ))}</tbody>
      </table>
      {rows.length === 0 && <p className="etl-empty">No rows in this result.</p>}
    </div>
  );
}
