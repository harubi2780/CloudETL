import { useCallback, useEffect, useRef, useState } from 'react';
import datasetsApi from '../api/datasets';
import './DatasetsPage.css';

const defaultLimits = {
  max_file_size_bytes: 25 * 1024 * 1024,
  extensions: ['csv', 'tsv', 'json', 'xlsx', 'parquet'],
};
const maxSelection = 10;
const maxResultHistory = 20;

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file, limits) {
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  if (!limits.extensions.includes(extension)) return 'File type not supported';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > limits.max_file_size_bytes) return `File exceeds the ${fileSize(limits.max_file_size_bytes)} limit.`;
  return '';
}

function fileKey(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function compactQueue(items) {
  const completedIds = new Set(
    items.filter((item) => item.status === 'uploaded' || item.status === 'failed')
      .slice(-maxResultHistory)
      .map((item) => item.id)
  );
  return items.filter((item) => item.status === 'queued' || item.status === 'uploading' || completedIds.has(item.id));
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
  const [selectionNotices, setSelectionNotices] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [management, setManagement] = useState(null);
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementResult, setManagementResult] = useState('');
  const managementTrigger = useRef(null);
  const queueRef = useRef(queue);
  const active = useRef(true);
  const controller = useRef(null);
  const requestedPage = useRef(1);
  const queueId = useRef(0);
  const uploadLock = useRef(false);

  function commitQueue(updater) {
    const next = compactQueue(typeof updater === 'function' ? updater(queueRef.current) : updater);
    queueRef.current = next;
    setQueue(next);
  }

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

  useEffect(() => {
    if (!management && !managementBusy) managementTrigger.current?.focus();
  }, [management, managementBusy]);

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (uploadLock.current || files.length === 0) return;
    const currentQueue = queueRef.current;
    const pending = currentQueue.filter((item) => item.status === 'queued');
    const seen = new Set(pending.map((item) => item.fileKey));
    let slots = Math.max(0, maxSelection - pending.length);
    const added = [];
    const notices = [];
    let capacityCount = 0;
    files.forEach((file) => {
      const message = validateFile(file, limits);
      if (message) {
        notices.push({ id: ++queueId.current, filename: file.name, message });
        return;
      }
      const key = fileKey(file);
      if (seen.has(key)) {
        notices.push({ id: ++queueId.current, filename: file.name, message: 'This file is already in the queue.' });
        return;
      }
      if (slots === 0) {
        capacityCount += 1;
        return;
      }
      seen.add(key);
      slots -= 1;
      added.push({
        id: ++queueId.current,
        file,
        fileName: file.name,
        fileSize: file.size,
        fileKey: key,
        status: 'queued',
        message: '',
      });
    });
    setSelectionNotices(notices);
    setSelectionError(capacityCount
      ? `${capacityCount} ${capacityCount === 1 ? 'file was' : 'files were'} not added. The queue can hold up to ${maxSelection} pending files.`
      : '');
    if (added.length) commitQueue((previous) => [...previous, ...added]);
  }

  function selectFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    addFiles(files);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    if (uploadLock.current) return;
    addFiles(event.dataTransfer.files);
  }

  function removeFile(id) {
    if (uploadLock.current) return;
    commitQueue((previous) => previous.filter((item) => item.id !== id));
  }

  function updateItem(id, changes) {
    if (!active.current) return;
    commitQueue((previous) => previous.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async function handleUpload(event) {
    event.preventDefault();
    const batch = queueRef.current.filter((item) => item.status === 'queued').map((item) => item.id);
    if (uploadLock.current || management || batch.length === 0) return;
    uploadLock.current = true;
    setUploading(true);
    let succeeded = false;
    let expired = false;
    try {
      for (const itemId of batch) {
        if (!active.current) break;
        const item = queueRef.current.find((queuedItem) => queuedItem.id === itemId);
        if (!item || item.status !== 'queued' || !item.file) continue;
        if (expired) {
          updateItem(item.id, { status: 'failed', message: 'Not uploaded. Sign in again to continue.', file: null });
          continue;
        }
        const file = item.file;
        // Recheck against the latest server-advertised limits before sending.
        const validation = validateFile(file, limits);
        if (validation) {
          updateItem(item.id, { status: 'failed', message: validation, file: null });
          continue;
        }
        updateItem(item.id, { status: 'uploading', message: '' });
        try {
          await datasetsApi.upload(file);
          succeeded = true;
          updateItem(item.id, { status: 'uploaded', message: '', file: null });
        } catch (error) {
          updateItem(item.id, { status: 'failed', message: uploadError(error), file: null });
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

  function beginManagement(type, dataset, trigger) {
    if (uploadLock.current || management || listing.status !== 'ready') return;
    managementTrigger.current = trigger;
    setManagementResult('');
    setManagement({ type, dataset, file: null, error: '' });
  }

  function cancelManagement() {
    if (uploadLock.current) return;
    setManagement(null);
  }

  function selectReplacement(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    const error = file ? validateFile(file, limits) : '';
    setManagement((previous) => ({ ...previous, file: error ? null : file, error }));
  }

  async function confirmManagement(event) {
    event.preventDefault();
    if (uploadLock.current || !management) return;
    const { type, dataset, file } = management;
    if (type === 'replace') {
      const error = file ? validateFile(file, limits) : 'Choose a replacement file.';
      if (error) {
        setManagement((previous) => ({ ...previous, error }));
        return;
      }
    }
    uploadLock.current = true;
    setManagementBusy(true);
    setManagement((previous) => ({ ...previous, error: '' }));
    try {
      const result = type === 'replace'
        ? await datasetsApi.replace(dataset.id, file)
        : await datasetsApi.remove(dataset.id);
      if (!active.current) return;
      setManagementResult(`${dataset.filename} ${type === 'replace' ? 'replaced' : 'deleted'}.${result.warning ? ` ${result.warning}` : ''}`);
      setManagement(null);
      // Reflect the completed operation even if refreshing the list fails.
      setListing((previous) => ({ ...previous, data: { ...previous.data,
        datasets: type === 'replace'
          ? previous.data.datasets.map((item) => item.id === dataset.id ? result.dataset : item)
          : previous.data.datasets.filter((item) => item.id !== dataset.id),
        total_count: previous.data.total_count - (type === 'delete' ? 1 : 0),
      } }));
      const page = type === 'delete' && listing.data.datasets.length === 1
        ? Math.max(1, listing.data.page - 1) : listing.data.page;
      await loadPage(page);
    } catch (error) {
      if (!active.current) return;
      if (error.status === 401) onSessionExpired?.();
      setManagement((previous) => ({ ...previous,
        error: error.fields?.file ? uploadError(error) : error.message || 'The dataset could not be updated. Please try again.',
      }));
    } finally {
      uploadLock.current = false;
      if (active.current) setManagementBusy(false);
    }
  }

  const queuedCount = queue.filter((item) => item.status === 'queued').length;
  const data = listing.data;

  return (
    <>
      <div className="page-heading">
        <h1>Datasets</h1>
        <p>Upload and manage source files for your workflows.</p>
      </div>

      <section className="datasets-upload" aria-labelledby="dataset-upload-title">
        <h2 id="dataset-upload-title">Upload datasets</h2>
        <form onSubmit={handleUpload} aria-busy={uploading}>
          <div className={`datasets-drop-area${dragging ? ' datasets-drop-area-active' : ''}`}
            role="region" aria-label="File drop area" data-uploading={uploading}
            onDragEnter={(event) => { event.preventDefault(); if (!uploadLock.current) setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={handleDrop}>
            <span className="datasets-drop-icon" aria-hidden="true">↥</span>
            <span className="datasets-drop-title">Drop files here or choose from your device</span>
            <label className="datasets-file-label" htmlFor="dataset-files">Choose files</label>
            <input id="dataset-files" className="datasets-file-input" type="file" multiple
              accept={limits.extensions.map((extension) => `.${extension}`).join(',')}
              aria-describedby="dataset-file-help" disabled={uploading || managementBusy} onChange={selectFiles} />
          </div>
          <p className="datasets-helper" id="dataset-file-help">
            {limits.extensions.map((extension) => extension.toUpperCase()).join(', ')}.
            {' '}Up to {fileSize(limits.max_file_size_bytes)} per file, {maxSelection} pending files.
          </p>
          {selectionError && <p className="form-alert" role="alert">{selectionError}</p>}
          {selectionNotices.length > 0 && (
            <ul className="datasets-selection-notices" aria-label="Files not added" aria-live="polite">
              {selectionNotices.map((notice) => <li key={notice.id}><strong>{notice.filename}</strong> — {notice.message}</li>)}
            </ul>
          )}
          {queue.length > 0 && (
            <ul className="datasets-queue" aria-label="Upload results" aria-live="polite">
              {queue.map((item) => (
                <li key={item.id}>
                  <span className="datasets-file-details">
                    <span className="datasets-file-name">{item.fileName}</span>
                    <span className="datasets-file-size">{fileSize(item.fileSize)}</span>
                  </span>
                  <span className="datasets-queue-actions">
                    <span className={item.status === 'failed' ? 'datasets-result datasets-result-error' : 'datasets-result'}>
                      {{ queued: 'Ready to upload', uploading: 'Uploading…', uploaded: 'Uploaded', failed: 'Failed' }[item.status]}
                      {item.message && ` — ${item.message}`}
                    </span>
                    {item.status === 'queued' && <button className="datasets-remove-button" type="button" onClick={() => removeFile(item.id)} disabled={uploading || managementBusy} aria-label={`Remove ${item.fileName}`}>Remove</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button className="button button-primary" type="submit" disabled={uploading || managementBusy || Boolean(management) || queuedCount === 0}>
            {uploading ? 'Uploading files…' : queuedCount ? `Upload ${queuedCount} ${queuedCount === 1 ? 'file' : 'files'}` : 'Upload files'}
          </button>
        </form>
      </section>

      <section className="datasets-list" aria-labelledby="datasets-list-title">
        <div className="datasets-list-heading">
          <h2 id="datasets-list-title">Uploaded datasets</h2>
          {data && <span className="muted-copy">{data.total_count} {data.total_count === 1 ? 'dataset' : 'datasets'}</span>}
        </div>
        {managementResult && <p role="status">{managementResult}</p>}
        {management && (
          <form className="datasets-management" onSubmit={confirmManagement} aria-labelledby="dataset-management-title" aria-busy={managementBusy}>
            <h3 id="dataset-management-title">{management.type === 'replace' ? 'Replace' : 'Delete'} {management.dataset.filename}?</h3>
            <p>{management.type === 'replace'
              ? 'The new file will replace the current contents and update the filename, format, and size. The dataset ID stays the same.'
              : 'This removes the dataset and its stored file. This action cannot be undone.'}</p>
            {management.type === 'replace' && (
              <>
                <label htmlFor="dataset-replacement">Replacement file</label>
                <input autoFocus id="dataset-replacement" type="file" onChange={selectReplacement} disabled={managementBusy}
                  accept={limits.extensions.map((extension) => `.${extension}`).join(',')} />
                {management.file && <p>Selected: {management.file.name} ({fileSize(management.file.size)})</p>}
              </>
            )}
            {management.error && <p className="form-alert" role="alert">{management.error}</p>}
            <div className="datasets-management-actions">
              <button autoFocus={management.type === 'delete'} className="button button-secondary" type="button" onClick={cancelManagement} disabled={managementBusy}>Cancel</button>
              <button className={`button ${management.type === 'delete' ? 'datasets-delete-button' : 'button-primary'}`} type="submit"
                disabled={managementBusy || (management.type === 'replace' && !management.file)}>
                {managementBusy ? 'Saving changes…' : management.type === 'replace' ? 'Confirm replacement' : 'Confirm deletion'}
              </button>
            </div>
          </form>
        )}
        {listing.status === 'loading' && <p role="status">{data ? 'Refreshing datasets…' : 'Loading datasets…'}</p>}
        {listing.status === 'error' && (
          <div className="datasets-list-error">
            <p className="form-alert" role="alert">{data ? 'Could not refresh datasets.' : 'Could not load datasets.'} {listing.error}</p>
            <button className="button button-secondary" type="button" disabled={managementBusy} onClick={() => loadPage(requestedPage.current)}>Retry list</button>
          </div>
        )}
        {data && data.datasets.length > 0 && (
          <>
            {listing.status === 'error' && <p className="datasets-helper">Showing the last loaded list.</p>}
            <div className="datasets-table-scroll">
              <table className="datasets-table">
                <caption className="datasets-table-caption">Your uploaded source files</caption>
                <thead><tr><th scope="col">Filename</th><th scope="col">Format</th><th scope="col">Size</th><th scope="col">Uploaded</th><th scope="col">Actions</th></tr></thead>
                <tbody>{data.datasets.map((dataset) => (
                  <tr key={dataset.id}>
                    <th scope="row">{dataset.filename}</th>
                    <td>{dataset.format.toUpperCase()}</td>
                    <td>{fileSize(dataset.size_bytes)}</td>
                    <td><time dateTime={dataset.uploaded_at}>{new Date(dataset.uploaded_at).toLocaleString()}</time></td>
                    <td><div className="datasets-management-actions">
                      <button className="button button-secondary" type="button" disabled={uploading || managementBusy || Boolean(management) || listing.status !== 'ready'}
                        aria-label={`Replace ${dataset.filename}`} onClick={(event) => beginManagement('replace', dataset, event.currentTarget)}>Replace</button>
                      <button className="button datasets-delete-button" type="button" disabled={uploading || managementBusy || Boolean(management) || listing.status !== 'ready'}
                        aria-label={`Delete ${dataset.filename}`} onClick={(event) => beginManagement('delete', dataset, event.currentTarget)}>Delete</button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <nav className="datasets-pagination" aria-label="Dataset pages">
              <button className="button button-secondary" type="button" disabled={data.page <= 1 || listing.status === 'loading' || uploading || managementBusy || Boolean(management)}
                onClick={() => loadPage(data.page - 1)}>Previous</button>
              <span>Page {data.page} of {data.total_pages}</span>
              <button className="button button-secondary" type="button" disabled={data.page >= data.total_pages || listing.status === 'loading' || uploading || managementBusy || Boolean(management)}
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
