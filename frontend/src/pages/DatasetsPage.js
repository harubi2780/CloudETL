import { useCallback, useEffect, useRef, useState } from 'react';
import datasetsApi from '../api/datasets';
import './DatasetsPage.css';

const defaultLimits = {
  max_file_size_bytes: 25 * 1024 * 1024,
  extensions: ['csv', 'tsv', 'json', 'xlsx', 'parquet'],
};
const maxSelection = 10;

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file, limits) {
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!limits.extensions.includes(extension)) return 'Unsupported file format.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > limits.max_file_size_bytes) return `File exceeds the ${fileSize(limits.max_file_size_bytes)} limit.`;
  return '';
}

function uploadError(error) {
  const fields = error.fields?.file;
  return (Array.isArray(fields) ? fields.join(' ') : fields) || error.message || 'Upload failed. Please try again.';
}

export default function DatasetsPage({ onSessionExpired }) {
  const [listing, setListing] = useState({ status: 'loading', data: null, error: '' });
  const [limits, setLimits] = useState(defaultLimits);
  const [queue, setQueue] = useState([]);
  const [selectionError, setSelectionError] = useState('');
  const [uploading, setUploading] = useState(false);
  const active = useRef(true);
  const controller = useRef(null);
  const requestedPage = useRef(1);
  const queueId = useRef(0);
  const uploadLock = useRef(false);

  const loadPage = useCallback(async (page) => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    requestedPage.current = page;
    setListing((previous) => ({ ...previous, status: 'loading', error: '' }));
    try {
      const data = await datasetsApi.list(page, { signal: requestController.signal });
      if (!active.current || requestController.signal.aborted) return;
      setListing({ status: 'ready', data, error: '' });
      setLimits(data.limits);
    } catch (error) {
      if (!active.current || requestController.signal.aborted) return;
      if (error.status === 401) onSessionExpired?.();
      setListing((previous) => ({ ...previous, status: 'error', error: error.message || 'Please try again.' }));
    }
  }, [onSessionExpired]);

  useEffect(() => {
    active.current = true;
    loadPage(1);
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, [loadPage]);

  function selectFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (uploadLock.current || files.length === 0) return;
    if (files.length > maxSelection) {
      setSelectionError(`Choose up to ${maxSelection} files at a time.`);
      return;
    }
    setSelectionError('');
    const selected = files.map((file) => {
      const message = validateFile(file, limits);
      return { id: ++queueId.current, file, status: message ? 'failed' : 'queued', message };
    });
    // Keep completed results visible while choosing the next batch.
    setQueue((previous) => [...previous.filter((item) => item.status === 'uploaded' || item.status === 'failed'), ...selected]);
  }

  function updateItem(id, changes) {
    if (!active.current) return;
    setQueue((previous) => previous.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async function handleUpload(event) {
    event.preventDefault();
    const batch = queue.filter((item) => item.status === 'queued');
    if (uploadLock.current || batch.length === 0) return;
    uploadLock.current = true;
    setUploading(true);
    let succeeded = false;
    let expired = false;
    try {
      for (const item of batch) {
        if (!active.current) break;
        if (expired) {
          updateItem(item.id, { status: 'failed', message: 'Not uploaded. Sign in again to continue.' });
          continue;
        }
        // Recheck against the latest server-advertised limits before sending.
        const validation = validateFile(item.file, limits);
        if (validation) {
          updateItem(item.id, { status: 'failed', message: validation });
          continue;
        }
        updateItem(item.id, { status: 'uploading', message: '' });
        try {
          await datasetsApi.upload(item.file);
          succeeded = true;
          updateItem(item.id, { status: 'uploaded', message: '' });
        } catch (error) {
          updateItem(item.id, { status: 'failed', message: uploadError(error) });
          if (error.status === 401) {
            expired = true;
            if (active.current) onSessionExpired?.();
          }
        }
      }
      if (succeeded && !expired && active.current) await loadPage(1);
    } finally {
      uploadLock.current = false;
      if (active.current) setUploading(false);
    }
  }

  const queuedCount = queue.filter((item) => item.status === 'queued').length;
  const data = listing.data;

  return (
    <>
      <div className="page-heading">
        <h1>Datasets</h1>
        <p>Upload source files for your workflows.</p>
      </div>

      <section className="datasets-upload" aria-labelledby="dataset-upload-title">
        <h2 id="dataset-upload-title">Upload datasets</h2>
        <form onSubmit={handleUpload} aria-busy={uploading}>
          <label className="datasets-file-label" htmlFor="dataset-files">Choose files</label>
          <p className="datasets-helper" id="dataset-file-help">
            {limits.extensions.map((extension) => extension.toUpperCase()).join(', ')}.
            {' '}Up to {fileSize(limits.max_file_size_bytes)} per file, {maxSelection} files at a time.
          </p>
          <input id="dataset-files" className="datasets-file-input" type="file" multiple
            accept={limits.extensions.map((extension) => `.${extension}`).join(',')}
            aria-describedby="dataset-file-help" disabled={uploading} onChange={selectFiles} />
          {selectionError && <p className="form-alert" role="alert">{selectionError}</p>}
          {queue.length > 0 && (
            <ul className="datasets-queue" aria-label="Upload results" aria-live="polite">
              {queue.map((item) => (
                <li key={item.id}>
                  <span className="datasets-file-name">{item.file.name}</span>
                  <span className={item.status === 'failed' ? 'datasets-result datasets-result-error' : 'datasets-result'}>
                    {{ queued: 'Ready to upload', uploading: 'Uploading…', uploaded: 'Uploaded', failed: 'Failed' }[item.status]}
                    {item.message && ` — ${item.message}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button className="button button-primary" type="submit" disabled={uploading || queuedCount === 0}>
            {uploading ? 'Uploading files…' : queuedCount ? `Upload ${queuedCount} ${queuedCount === 1 ? 'file' : 'files'}` : 'Upload files'}
          </button>
        </form>
      </section>

      <section className="datasets-list" aria-labelledby="datasets-list-title">
        <div className="datasets-list-heading">
          <h2 id="datasets-list-title">Uploaded datasets</h2>
          {data && <span className="muted-copy">{data.total_count} {data.total_count === 1 ? 'dataset' : 'datasets'}</span>}
        </div>
        {listing.status === 'loading' && <p role="status">{data ? 'Refreshing datasets…' : 'Loading datasets…'}</p>}
        {listing.status === 'error' && (
          <div className="datasets-list-error">
            <p className="form-alert" role="alert">{data ? 'Could not refresh datasets.' : 'Could not load datasets.'} {listing.error}</p>
            <button className="button button-secondary" type="button" onClick={() => loadPage(requestedPage.current)}>Retry list</button>
          </div>
        )}
        {data && data.datasets.length > 0 && (
          <>
            {listing.status === 'error' && <p className="datasets-helper">Showing the last loaded list.</p>}
            <div className="datasets-table-scroll">
              <table className="datasets-table">
                <caption className="datasets-table-caption">Your uploaded source files</caption>
                <thead><tr><th scope="col">Filename</th><th scope="col">Format</th><th scope="col">Size</th><th scope="col">Uploaded</th></tr></thead>
                <tbody>{data.datasets.map((dataset) => (
                  <tr key={dataset.id}>
                    <th scope="row">{dataset.filename}</th>
                    <td>{dataset.format.toUpperCase()}</td>
                    <td>{fileSize(dataset.size_bytes)}</td>
                    <td><time dateTime={dataset.uploaded_at}>{new Date(dataset.uploaded_at).toLocaleString()}</time></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <nav className="datasets-pagination" aria-label="Dataset pages">
              <button className="button button-secondary" type="button" disabled={data.page <= 1 || listing.status === 'loading' || uploading}
                onClick={() => loadPage(data.page - 1)}>Previous</button>
              <span>Page {data.page} of {data.total_pages}</span>
              <button className="button button-secondary" type="button" disabled={data.page >= data.total_pages || listing.status === 'loading' || uploading}
                onClick={() => loadPage(data.page + 1)}>Next</button>
            </nav>
          </>
        )}
        {listing.status === 'ready' && data.datasets.length === 0 && (
          <div className="datasets-empty"><h3>No datasets yet</h3><p>Choose files above to upload your first dataset.</p></div>
        )}
      </section>
    </>
  );
}
