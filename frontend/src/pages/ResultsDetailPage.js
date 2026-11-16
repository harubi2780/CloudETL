import { useEffect, useRef, useState } from 'react';
import etlApi from '../api/etl';
import DataTable from '../components/etl/DataTable';
import Pagination from '../components/etl/Pagination';
import useRun from '../hooks/useRun';
import { runDate } from './RunsPage';
import { Link } from '../navigation';
import './EtlWorkflow.css';

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
  const active = useRef(true);
  const downloadLock = useRef(false);
  const currentRunId = useRef(runId);
  currentRunId.current = runId;
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;

  useEffect(() => {
    active.current = true;
    setPage(1);
    setDownloadMessage('');
    setDownloadError('');
    setDownloading(false);
    downloadLock.current = false;
    return () => { active.current = false; };
  }, [runId]);

  useEffect(() => {
    if (run?.status !== 'succeeded') return undefined;
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
  }, [runId, run?.status, page, pageSize, attempt]);

  useEffect(() => {
    if (run?.status !== 'succeeded') return undefined;
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
  }, [runId, run?.status, formatAttempt]);

  async function download() {
    if (downloadLock.current || !formats.includes(format)) return;
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

  return <div className="etl-page">
    <Link to="/dashboard/results">← All results</Link>
    <header className="page-heading"><h1>{run ? `${run.name} — result` : 'Result'}</h1><p>Browse rows a page at a time. Downloads contain the full result.</p></header>
    {loading && <p role="status">Loading result…</p>}
    {error && <div className="etl-error" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={retry}>Retry result</button></div>}
    {run && <div className="etl-actions etl-detail-links"><Link to={`/dashboard/runs/${run.id}`}>Run details</Link><Link to={`/dashboard/pipelines?run=${run.id}`}>Edit and resubmit</Link></div>}
    {run && run.status !== 'succeeded' && <section className="etl-section"><h2>Result not ready</h2><p>{run.status === 'failed' ? run.error?.message || 'This run failed without producing a result.' : 'This run is still waiting or processing. Its status updates automatically.'}</p></section>}
    {run?.status === 'succeeded' && <>
      <dl className="etl-facts"><div><dt>Completed</dt><dd>{runDate(run.finished_at)}</dd></div><div><dt>Output rows</dt><dd>{run.summary?.final_rows?.toLocaleString() ?? 'Unavailable'}</dd></div><div><dt>Columns</dt><dd>{run.summary?.columns?.length ?? rowState.data?.columns?.length ?? 'Unavailable'}</dd></div></dl>
      <section className="etl-section" aria-labelledby="etl-download-title"><h2 id="etl-download-title">Download full result</h2><p className="etl-note">The selected format includes every output row, across all pages.</p>
        {formatsLoading && <p role="status">Loading download formats…</p>}
        {formatError && <div className="etl-error" role="alert"><p>{formatError}</p><button className="button button-secondary" type="button" onClick={() => setFormatAttempt((value) => value + 1)}>Retry formats</button></div>}
        {!formatsLoading && !formatError && formats.length === 0 && <p>No download formats are available.</p>}
        <div className="etl-toolbar"><label>File format <select value={format} onChange={(event) => setFormat(event.target.value)} disabled={formatsLoading || downloading || formats.length === 0}>{formats.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label><button className="button button-primary" type="button" onClick={download} disabled={downloading || formatsLoading || !formats.includes(format)}>{downloading ? 'Preparing download…' : 'Download full result'}</button></div>
        {downloadError && <p className="etl-error" role="alert">{downloadError}</p>}{downloadMessage && <p role="status">{downloadMessage}</p>}
      </section>
      <section className="etl-section" aria-labelledby="etl-rows-title"><div className="etl-toolbar"><h2 id="etl-rows-title">Result rows</h2><label>Rows per page <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div>
        {rowState.loading && <p role="status">Loading rows…</p>}
        {rowState.error && <div className="etl-error" role="alert"><p>{rowState.error}</p><button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry rows</button></div>}
        {rowState.data && <><p className="etl-note" aria-live="polite">Rows {rowState.data.total_count ? (rowState.data.page - 1) * rowState.data.page_size + 1 : 0}–{Math.min(rowState.data.page * rowState.data.page_size, rowState.data.total_count)} of {rowState.data.total_count}. {rowState.data.columns.length} columns.</p><DataTable columns={rowState.data.columns} rows={rowState.data.rows} caption={`Result rows · page ${rowState.data.page}`} /><Pagination page={rowState.data.page} totalPages={rowState.data.total_pages} totalCount={rowState.data.total_count} onPageChange={setPage} label="Result row pages" /></>}
      </section>
    </>}
  </div>;
}
