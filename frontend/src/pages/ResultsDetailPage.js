import { useEffect, useRef, useState } from 'react';
import etlApi from '../api/etl';
import DataTable from '../components/etl/DataTable';
import Pagination from '../components/etl/Pagination';
import Spinner from '../components/etl/Spinner';
import useRun from '../hooks/useRun';
import { runDate, RunStatus } from './RunsPage';
import { Link } from '../navigation';
import './EtlWorkflow.css';
import './ResultFileActions.css';

export default function ResultsDetailPage({ runId, onSessionExpired }) {
  const { run, loading, error, retry } = useRun(runId, onSessionExpired);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [attempt, setAttempt] = useState(0);
  const [rowState, setRowState] = useState({ loading: true, data: null, error: '' });
  const [formats, setFormats] = useState([]);
  const [formatError, setFormatError] = useState('');
  const [formatAttempt, setFormatAttempt] = useState(0);
  const [formatsLoading, setFormatsLoading] = useState(true);
  const [format, setFormat] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [removedRunId, setRemovedRunId] = useState(null);
  const [deletion, setDeletion] = useState({ confirming: false, busy: false, error: '', warning: '' });
  const active = useRef(true);
  const downloadLock = useRef(false);
  const deleteLock = useRef(false);
  const deleteTrigger = useRef(null);
  const cancelDeletion = useRef(null);
  const removedHeading = useRef(null);
  const confirmationWasOpen = useRef(false);
  const currentRunId = useRef(runId);
  currentRunId.current = runId;
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;
  const resultAvailable = run?.status === 'succeeded' && run.result_available !== false && removedRunId !== run.id;

  useEffect(() => {
    active.current = true;
    setPage(1);
    setDownloadMessage('');
    setDownloadError('');
    setDownloading(false);
    setRowState({ loading: true, data: null, error: '' });
    downloadLock.current = false;
    setRemovedRunId(null);
    setDeletion({ confirming: false, busy: false, error: '', warning: '' });
    deleteLock.current = false;
    return () => { active.current = false; };
  }, [runId]);

  useEffect(() => {
    if (deletion.confirming) cancelDeletion.current?.focus();
    else if (confirmationWasOpen.current) {
      if (removedRunId === runId) removedHeading.current?.focus();
      else deleteTrigger.current?.focus();
    }
    confirmationWasOpen.current = deletion.confirming;
  }, [deletion.confirming, removedRunId, runId]);

  useEffect(() => {
    if (!resultAvailable) return undefined;
    const controller = new AbortController();
    setRowState({ loading: true, data: null, error: '' });
    etlApi.rows(runId, { page, pageSize, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setRowState({ loading: false, data, error: '' });
    }).catch((failure) => {
      if (controller.signal.aborted || failure.name === 'AbortError') return;
      if (failure.status === 401) expired.current?.();
      setRowState({ loading: false, data: null, error: failure.message || 'We could not load the result rows.' });
    });
    return () => controller.abort();
  }, [runId, resultAvailable, page, pageSize, attempt]);

  useEffect(() => {
    if (!resultAvailable) return undefined;
    const controller = new AbortController();
    setFormatsLoading(true);
    setFormatError('');
    setFormats([]);
    etlApi.capabilities({ signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      const available = data.outputFormats || [];
      setFormats(available);
      setFormat((previous) => available.includes(previous) ? previous : available.includes('parquet') ? 'parquet' : available[0] || '');
      setFormatsLoading(false);
    }).catch((failure) => {
      if (controller.signal.aborted || failure.name === 'AbortError') return;
      if (failure.status === 401) expired.current?.();
      setFormatsLoading(false);
      setFormatError(failure.message || 'Download formats are unavailable.');
    });
    return () => controller.abort();
  }, [runId, resultAvailable, formatAttempt]);

  async function download() {
    if (!resultAvailable || deleteLock.current || deletion.confirming || downloadLock.current || !formats.includes(format)) return;
    const downloadAttempt = { runId };
    downloadLock.current = downloadAttempt;
    setDownloading(true);
    setDownloadMessage('');
    setDownloadError('');
    try {
      await etlApi.download(runId, format);
      if (active.current && currentRunId.current === runId && downloadLock.current === downloadAttempt) setDownloadMessage('The full-file download was handed to your browser.');
    } catch (failure) {
      if (!active.current || currentRunId.current !== runId || downloadLock.current !== downloadAttempt) return;
      if (failure.status === 401) expired.current?.();
      setDownloadError(failure.message || 'We could not download this result. Please try again.');
    } finally {
      if (downloadLock.current === downloadAttempt) {
        downloadLock.current = false;
        if (active.current && currentRunId.current === runId) setDownloading(false);
      }
    }
  }

  async function deleteResult() {
    if (!resultAvailable || !deletion.confirming || deleteLock.current || downloadLock.current) return;
    const deletionAttempt = { runId };
    deleteLock.current = deletionAttempt;
    setDeletion((previous) => ({ ...previous, busy: true, error: '' }));
    try {
      const result = await etlApi.deleteResult(runId);
      if (!active.current || currentRunId.current !== runId || deleteLock.current !== deletionAttempt) return;
      if (result?.deleted !== true) throw new Error('The service did not confirm deletion. Refresh this result before trying again.');
      setRemovedRunId(runId);
      setDeletion({ confirming: false, busy: false, error: '', warning: result.warning || '' });
    } catch (failure) {
      if (!active.current || currentRunId.current !== runId || deleteLock.current !== deletionAttempt) return;
      if (failure.status === 401) expired.current?.();
      setDeletion((previous) => ({ ...previous, busy: false, error: failure.message || 'We could not delete this result file. Please try again.' }));
    } finally {
      if (deleteLock.current === deletionAttempt) deleteLock.current = false;
    }
  }

  return <div className="etl-page">
    <Link to="/dashboard/results">← All results</Link>
    <header className="page-heading etl-result-heading" aria-label="Result heading">
      <div className="etl-result-heading-copy"><h1>{run ? `${run.name} — result` : 'Result'}</h1>
        {run && <div className="etl-actions etl-detail-links"><Link to={`/dashboard/runs/${run.id}`}>Run details</Link><Link to={`/dashboard/pipelines?run=${run.id}`}>Edit and resubmit</Link></div>}
      </div>
      {resultAvailable && <div className="etl-download-controls" role="group" aria-label="Download full result">
        <label>File format <select value={format} onChange={(event) => setFormat(event.target.value)} disabled={formatsLoading || downloading || deletion.confirming || formats.length === 0}>{formats.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
        <button className="button button-primary" type="button" onClick={download} disabled={downloading || deletion.confirming || formatsLoading || !formats.includes(format)} aria-describedby="etl-download-description" aria-busy={downloading}>{downloading && <Spinner />}{downloading ? 'Preparing download…' : 'Download full result'}</button>
        <span className="etl-note etl-download-description" id="etl-download-description">All rows, all pages.</span>
      </div>}
    </header>
    {loading && <p className="etl-loading" role="status"><Spinner />Loading result…</p>}
    {error && <div className="etl-error" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={retry}>Retry result</button></div>}
    {run && run.status !== 'succeeded' && <section className="etl-section"><div className="etl-toolbar"><h2>Result not ready</h2><RunStatus status={run.status} /></div><p>{run.status === 'failed' ? run.error?.message || 'This run failed without producing a result.' : 'This run is still waiting or processing. Its status updates automatically.'}</p></section>}
    {run?.status === 'succeeded' && <>
      <dl className="etl-facts etl-result-facts"><div><dt>Completed</dt><dd>{runDate(run.finished_at)}</dd></div><div><dt>Output rows</dt><dd>{run.summary?.final_rows?.toLocaleString() ?? 'Unavailable'}</dd></div><div><dt>Columns</dt><dd>{run.summary?.columns?.length ?? rowState.data?.columns?.length ?? 'Unavailable'}</dd></div></dl>
      {!resultAvailable && <section className="etl-section" aria-labelledby="etl-result-removed-title">
        <h2 id="etl-result-removed-title" ref={removedHeading} tabIndex={-1}>Result file removed</h2>
        <p>{removedRunId === runId ? 'The processed file was removed.' : 'This processed file is no longer available.'} Run history, submitted configuration, and summary remain available.</p>
        {removedRunId === runId && <p role="status">Result file deleted.</p>}
        {deletion.warning && <p className="etl-note" role="status">{deletion.warning}</p>}
        <p className="etl-note">Edit and resubmit the pipeline to create a new result.</p>
      </section>}
    </>}
    {resultAvailable && <>
      {(formatsLoading || formatError || (!formatsLoading && formats.length === 0) || downloadError || downloadMessage) && <div className="etl-download-feedback">
        {formatsLoading && <p className="etl-loading" role="status"><Spinner />Loading download formats…</p>}
        {formatError && <div className="etl-error" role="alert"><p>{formatError}</p><button className="button button-secondary" type="button" onClick={() => setFormatAttempt((value) => value + 1)}>Retry formats</button></div>}
        {!formatsLoading && !formatError && formats.length === 0 && <p>No download formats are available.</p>}
        {downloadError && <p className="etl-error" role="alert">{downloadError}</p>}{downloadMessage && <p role="status">{downloadMessage}</p>}
      </div>}
      <section className="etl-section" aria-labelledby="etl-rows-title"><div className="etl-toolbar"><h2 id="etl-rows-title">Result rows</h2><label>Rows per page <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div>
        {rowState.loading && <p className="etl-loading" role="status"><Spinner />Loading rows…</p>}
        {rowState.error && <div className="etl-error" role="alert"><p>{rowState.error}</p><button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry rows</button></div>}
        {rowState.data && <><p className="etl-note" aria-live="polite">Rows {rowState.data.total_count ? (rowState.data.page - 1) * rowState.data.page_size + 1 : 0}–{Math.min(rowState.data.page * rowState.data.page_size, rowState.data.total_count)} of {rowState.data.total_count}. {rowState.data.columns.length} columns.</p><DataTable columns={rowState.data.columns} rows={rowState.data.rows} caption={`Result rows · page ${rowState.data.page}`} rowOffset={(rowState.data.page - 1) * rowState.data.page_size} selectionKey={`${runId}:${rowState.data.page}:${rowState.data.page_size}`} /><Pagination page={rowState.data.page} totalPages={rowState.data.total_pages} totalCount={rowState.data.total_count} onPageChange={setPage} label="Result row pages" /></>}
      </section>
      <section className="etl-section etl-result-file-actions" aria-labelledby="etl-result-file-title">
        <div className="etl-toolbar"><h2 id="etl-result-file-title">Stored result file</h2>
          <button ref={deleteTrigger} className="button button-secondary etl-result-delete-button" type="button"
            disabled={downloading || deletion.confirming} aria-expanded={deletion.confirming} aria-controls="etl-delete-result-confirmation"
            onClick={() => setDeletion({ confirming: true, busy: false, error: '', warning: '' })}>Delete result file</button>
        </div>
        <p className="etl-note">Removing the processed file keeps this run's history, configuration, and summary.</p>
        {deletion.confirming && <div id="etl-delete-result-confirmation" className="etl-result-delete-confirmation" role="region"
          aria-labelledby="etl-delete-result-title" aria-describedby="etl-delete-result-description" aria-busy={deletion.busy}>
          <h3 id="etl-delete-result-title">Delete result file?</h3>
          <p id="etl-delete-result-description">This permanently removes the processed file. Row browsing and downloads will stop. The run history, configuration, summary, and original source files remain saved.</p>
          {deletion.error && <p role="alert" className="etl-result-delete-error">{deletion.error}</p>}
          <div className="etl-actions">
            <button ref={cancelDeletion} className="button button-secondary" type="button" disabled={deletion.busy}
              onClick={() => setDeletion({ confirming: false, busy: false, error: '', warning: '' })}>Cancel deletion</button>
            <button className="button etl-result-delete-button" type="button" disabled={deletion.busy} onClick={deleteResult}>
              {deletion.busy && <Spinner />}{deletion.busy ? 'Deleting result file…' : 'Confirm file deletion'}
            </button>
          </div>
        </div>}
      </section>
    </>}
  </div>;
}
