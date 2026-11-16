export default function Pagination({ page, totalPages, totalCount, onPageChange, disabled = false, label = 'Pages' }) {
  const last = Math.max(1, totalPages || 1);
  return (
    <nav className="etl-pagination" aria-label={label}>
      <p>Page {page} of {last}{typeof totalCount === 'number' ? ` · ${totalCount.toLocaleString()} total` : ''}</p>
      <div className="etl-actions">
        <button className="button button-secondary" type="button" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <button className="button button-secondary" type="button" disabled={disabled || page >= last} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </nav>
  );
}
