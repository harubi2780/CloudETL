import { useEffect, useMemo, useRef, useState } from 'react';
import etlApi from '../api/etl';
import DataTable from '../components/etl/DataTable';
import Pagination from '../components/etl/Pagination';
import Spinner from '../components/etl/Spinner';
import useRun from '../hooks/useRun';
import { computeColumnDiff, describeStep, operations, sourceIds } from '../lib/pipeline/workflow';
import { Link } from '../navigation';
import { runDate, RunStatus } from './RunsPage';
import './EtlWorkflow.css';
import './ResultFileActions.css';

function elapsed(run, checkedAt) {
  if (!run.started_at) return 'Waiting for a worker';
  const start = Date.parse(run.started_at);
  const end = run.finished_at ? Date.parse(run.finished_at) : checkedAt;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Unavailable';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatRowDelta(initialRows, finalRows) {
  if (typeof initialRows !== 'number' || typeof finalRows !== 'number') return 'Unavailable';
  const delta = finalRows - initialRows;
  if (delta > 0) return `+${delta.toLocaleString()}`;
  return delta.toLocaleString();
}

export default function RunDetailPage({
  runId,
  onSessionExpired,
  backTo = '/dashboard/runs',
  backLabel = '← All runs',
}) {
  const { run, loading, error, checkedAt, retry } = useRun(runId, onSessionExpired);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [attempt, setAttempt] = useState(0);
  const [rowState, setRowState] = useState({ loading: false, data: null, error: '' });
  const [viewMode, setViewMode] = useState('split');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [sourcePage, setSourcePage] = useState(1);
  const [sourcePageSize, setSourcePageSize] = useState(25);
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [sourceRowState, setSourceRowState] = useState({ loading: false, data: null, error: '', errorCode: '' });
  const [formats, setFormats] = useState([]);
  const [formatError, setFormatError] = useState('');
  const [formatAttempt, setFormatAttempt] = useState(0);
  const [formatsLoading, setFormatsLoading] = useState(false);
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

  const runSources = useMemo(() => {
    if (!run) return [];
    if (run.sources_meta && typeof run.sources_meta === 'object' && Object.keys(run.sources_meta).length > 0) {
      return Object.values(run.sources_meta).sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
    }
    if (run.configuration?.datasetId) {
      return sourceIds(run.configuration, false).map((id, index) => ({
        id,
        filename: id === run.configuration.datasetId ? 'Primary source' : `Source ${index + 1}`,
        available: true,
        matches_snapshot: true,
        is_primary: id === run.configuration.datasetId,
      }));
    }
    return [];
  }, [run]);

  const effectiveSourceId = runSources.some((item) => item.id === selectedSourceId)
    ? selectedSourceId
    : (runSources.find((item) => item.is_primary)?.id || runSources[0]?.id || '');
  const selectedSource = runSources.find((item) => item.id === effectiveSourceId) || null;
  const sourcesMeta = run?.sources_meta || {};
  const steps = run?.configuration?.steps || [];

  useEffect(() => {
    active.current = true;
    setPage(1);
    setPageSize(25);
    setViewMode('split');
    setSelectedSourceId('');
    setSourcePage(1);
    setSourcePageSize(25);
    setSourceRowState({ loading: false, data: null, error: '', errorCode: '' });
    setDownloadMessage('');
    setDownloadError('');
    setDownloading(false);
    setRowState({ loading: false, data: null, error: '' });
    setFormats([]);
    setFormatError('');
    setFormatsLoading(false);
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
    if (!resultAvailable || !effectiveSourceId) return undefined;
    if (selectedSource?.available === false) {
      setSourceRowState({ loading: false, data: null, error: '', errorCode: 'dataset_not_found' });
      return undefined;
    }
    if (selectedSource?.matches_snapshot === false) {
      setSourceRowState({ loading: false, data: null, error: '', errorCode: 'source_modified' });
      return undefined;
    }
    const controller = new AbortController();
    setSourceRowState({ loading: true, data: null, error: '', errorCode: '' });
    etlApi.runSourceRows(runId, {
      page: sourcePage,
      pageSize: sourcePageSize,
      datasetId: effectiveSourceId,
      signal: controller.signal,
    }).then((data) => {
      if (!controller.signal.aborted) setSourceRowState({ loading: false, data, error: '', errorCode: '' });
    }).catch((failure) => {
      if (controller.signal.aborted || failure.name === 'AbortError') return;
      if (failure.status === 401) expired.current?.();
      if (failure.status === 404 || failure.code === 'dataset_not_found') {
        setSourceRowState({
          loading: false,
          data: null,
          error: failure.message || 'Original dataset is no longer available.',
          errorCode: 'dataset_not_found',
        });
      } else if (failure.status === 409 || failure.code === 'source_modified') {
        setSourceRowState({
          loading: false,
          data: null,
          error: failure.message || 'Original dataset changed after this run.',
          errorCode: 'source_modified',
        });
      } else {
        setSourceRowState({
          loading: false,
          data: null,
          error: failure.message || 'We could not load the original source rows.',
          errorCode: failure.code || 'error',
        });
      }
    });
    return () => controller.abort();
  }, [runId, resultAvailable, effectiveSourceId, selectedSource?.available, selectedSource?.matches_snapshot, sourcePage, sourcePageSize, sourceAttempt]);

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
      setFormat((previous) => available.includes(previous) ? previous : available.includes('csv') ? 'csv' : available[0] || '');
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
      if (active.current && currentRunId.current === runId && downloadLock.current === downloadAttempt) {
        setDownloadMessage('The full-file download was handed to your browser.');
      }
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

  const resultColumns = rowState.data?.columns || run?.summary?.columns || [];
  const columnDiff = sourceRowState.data?.columns && resultColumns.length > 0
    ? computeColumnDiff(sourceRowState.data.columns, resultColumns)
    : null;
  const originalUnavailable = selectedSource?.available === false || sourceRowState.errorCode === 'dataset_not_found';
  const originalModified = selectedSource?.matches_snapshot === false || sourceRowState.errorCode === 'source_modified';

  return (
    <div className="etl-page">
      <Link to={backTo}>{backLabel}</Link>
      <header className="page-heading etl-result-heading" aria-label="Result heading">
        <div className="etl-result-heading-copy">
          <h1>{run?.name || 'Run details'}</h1>
          {run && (
            <div className="etl-actions etl-detail-links">
              <Link to={`/dashboard/pipelines?run=${run.id}`}>Edit and resubmit</Link>
            </div>
          )}
        </div>
        {resultAvailable && (
          <div className="etl-download-controls" role="group" aria-label="Download full result">
            <label>
              File format{' '}
              <select value={format} onChange={(event) => setFormat(event.target.value)}
                disabled={formatsLoading || downloading || deletion.confirming || formats.length === 0}>
                {formats.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
              </select>
            </label>
            <button className="button button-primary" type="button" onClick={download}
              disabled={downloading || deletion.confirming || formatsLoading || !formats.includes(format)}
              aria-describedby="etl-download-description" aria-busy={downloading}>
              {downloading && <Spinner />}
              {downloading ? 'Preparing download…' : 'Download full result'}
            </button>
            <span className="etl-note etl-download-description" id="etl-download-description">All rows, all pages.</span>
          </div>
        )}
      </header>

      {loading && <p className="etl-loading" role="status"><Spinner />Loading run…</p>}
      {error && (
        <div className="etl-error" role="alert">
          <p>{error}</p>
          <button className="button button-secondary" type="button" onClick={retry}>Retry status</button>
        </div>
      )}

      {resultAvailable && (formatsLoading || formatError || (!formatsLoading && formats.length === 0) || downloadError || downloadMessage) && (
        <div className="etl-download-feedback">
          {formatsLoading && <p className="etl-loading" role="status"><Spinner />Loading download formats…</p>}
          {formatError && (
            <div className="etl-error" role="alert">
              <p>{formatError}</p>
              <button className="button button-secondary" type="button" onClick={() => setFormatAttempt((value) => value + 1)}>Retry formats</button>
            </div>
          )}
          {!formatsLoading && !formatError && formats.length === 0 && <p>No download formats are available.</p>}
          {downloadError && <p className="etl-error" role="alert">{downloadError}</p>}
          {downloadMessage && <p role="status">{downloadMessage}</p>}
        </div>
      )}

      {run && (
        <>
          <section className="etl-section" aria-label="Run status">
            <div className="etl-toolbar">
              <RunStatus status={run.status} />
            </div>
            <dl className="etl-facts">
              <div><dt>Submitted</dt><dd>{runDate(run.created_at)}</dd></div>
              <div><dt>Started</dt><dd>{runDate(run.started_at)}</dd></div>
              <div><dt>Finished</dt><dd>{runDate(run.finished_at)}</dd></div>
              <div><dt>{run.finished_at ? 'Execution time' : 'Elapsed execution time'}</dt><dd>{elapsed(run, checkedAt)}</dd></div>
            </dl>
            {(run.status === 'queued' || run.status === 'running') && (
              <p className="etl-note" role="status">
                {run.status === 'queued' ? 'Queued for an available worker.' : 'The worker is processing this pipeline.'}
                {' '}
                {error ? 'Status updates are paused. Retry to reconnect.' : 'Status updates every 2 seconds while this page is visible.'}
              </p>
            )}
            {run.status === 'failed' && (
              <div className="etl-error" role="alert">
                <h2>Run failed</h2>
                <p>{run.error?.message || 'Processing failed. Review the configuration and submit a new run.'}</p>
                {run.error?.code && <p className="etl-note">Error code: {run.error.code}</p>}
              </div>
            )}
            {resultAvailable && (
              <div className="etl-complete">
                <h2>Result ready</h2>
                <p>
                  {typeof run.summary?.final_rows === 'number'
                    ? `${run.summary.final_rows.toLocaleString()} output rows.`
                    : 'The pipeline finished successfully.'}
                </p>
              </div>
            )}
          </section>

          {run.status !== 'succeeded' && (
            <section className="etl-section">
              <div className="etl-toolbar">
                <h2>Result not ready</h2>
              </div>
              <p>
                {run.status === 'failed'
                  ? 'This run failed without producing a result.'
                  : 'This run is still waiting or processing. Its status updates automatically.'}
              </p>
            </section>
          )}

          {run.status === 'succeeded' && !resultAvailable && (
            <section className="etl-section" aria-labelledby="etl-result-removed-title">
              <h2 id="etl-result-removed-title" ref={removedHeading} tabIndex={-1}>Result file removed</h2>
              <p>
                {removedRunId === runId ? 'The processed file was removed.' : 'This processed file is no longer available.'}
                {' '}Run history, submitted configuration, and summary remain available.
              </p>
              {removedRunId === runId && <p role="status">Result file deleted.</p>}
              {deletion.warning && <p className="etl-note" role="status">{deletion.warning}</p>}
              <p className="etl-note">Edit and resubmit the pipeline to create a new result.</p>
            </section>
          )}

          {run.summary && run.status === 'succeeded' && (
            <section className="etl-section" aria-labelledby="etl-summary-title">
              <h2 id="etl-summary-title">Run summary</h2>
              <dl className="etl-facts">
                <div><dt>Input rows</dt><dd>{typeof run.summary.initial_rows === 'number' ? run.summary.initial_rows.toLocaleString() : 'Unavailable'}</dd></div>
                <div><dt>Output rows</dt><dd>{typeof run.summary.final_rows === 'number' ? run.summary.final_rows.toLocaleString() : 'Unavailable'}</dd></div>
                <div><dt>Net row change</dt><dd>{formatRowDelta(run.summary.initial_rows, run.summary.final_rows)}</dd></div>
                <div><dt>Rows removed</dt><dd>{typeof run.summary.dropped_rows === 'number' ? run.summary.dropped_rows.toLocaleString() : 'Unavailable'}</dd></div>
                <div><dt>Rows added</dt><dd>{typeof run.summary.added_rows === 'number' ? run.summary.added_rows.toLocaleString() : 'Unavailable'}</dd></div>
                <div><dt>Output columns</dt><dd>{run.summary.columns?.length ?? rowState.data?.columns?.length ?? 'Unavailable'}</dd></div>
              </dl>
              {columnDiff && (
                <div className="etl-column-diff" aria-label="Column changes">
                  {columnDiff.added.length === 0 && columnDiff.removed.length === 0 && columnDiff.typeChanges.length === 0 ? (
                    <p className="etl-note">No column schema changes between original and result.</p>
                  ) : (
                    <ul className="etl-diff-list">
                      {columnDiff.added.length > 0 && <li><strong>Added columns:</strong> {columnDiff.added.join(', ')}</li>}
                      {columnDiff.removed.length > 0 && <li><strong>Removed columns:</strong> {columnDiff.removed.join(', ')}</li>}
                      {columnDiff.typeChanges.length > 0 && (
                        <li>
                          <strong>Type changes:</strong>{' '}
                          {columnDiff.typeChanges.map((item) => `${item.name} (${item.from} → ${item.to})`).join(', ')}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {run.configuration && (
            <section className="etl-section" aria-labelledby="etl-steps-title">
              <div className="etl-toolbar">
                <h2 id="etl-steps-title">Pipeline steps</h2>
                <span className="etl-note">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
              </div>
              {steps.length === 0 ? (
                <p className="etl-note">No transformation steps recorded.</p>
              ) : (
                <ol className="etl-step-summary-list">
                  {steps.map((step, index) => {
                    const opLabel = operations.find((op) => op.type === step.type)?.label || step.type;
                    const targetFilename = step.sourceId && step.sourceId !== run.configuration.datasetId
                      ? (sourcesMeta[step.sourceId]?.filename || step.sourceId)
                      : '';
                    const isDisabled = step.enabled === false;
                    return (
                      <li key={index} className={`etl-step-summary-item${isDisabled ? ' is-disabled' : ''}`}>
                        <div className="etl-step-summary-head">
                          <span className="etl-step-index">{index + 1}.</span>
                          <strong>{opLabel}</strong>
                          {targetFilename && <span className="etl-badge">{targetFilename}</span>}
                          {isDisabled && <span className="etl-badge etl-badge-muted">Disabled</span>}
                        </div>
                        <p className="etl-step-summary-desc">{describeStep(step, sourcesMeta)}</p>
                      </li>
                    );
                  })}
                </ol>
              )}
              <details className="etl-config-details" aria-label="Submitted configuration">
                <summary>Submitted configuration</summary>
                <pre className="etl-json">{JSON.stringify(run.configuration, null, 2)}</pre>
              </details>
            </section>
          )}

          {resultAvailable && (
            <>
              <section className="etl-section" aria-labelledby="etl-comparison-title">
                <div className="etl-toolbar">
                  <h2 id="etl-comparison-title">Original vs. Result comparison</h2>
                  <div className="etl-actions etl-view-toggle" role="group" aria-label="Data view mode">
                    <button type="button" aria-pressed={viewMode === 'split'} onClick={() => setViewMode('split')}>Side-by-side</button>
                    <button type="button" aria-pressed={viewMode === 'result'} onClick={() => setViewMode('result')}>Result only</button>
                    <button type="button" aria-pressed={viewMode === 'original'} onClick={() => setViewMode('original')}>Original only</button>
                  </div>
                  {runSources.length > 1 ? (
                    <label>
                      Original source dataset{' '}
                      <select aria-label="Original source dataset" value={effectiveSourceId}
                        onChange={(event) => { setSelectedSourceId(event.target.value); setSourcePage(1); }}>
                        {runSources.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.filename}{source.is_primary ? ' (Primary)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : selectedSource?.filename ? (
                    <span className="etl-note">Original source: {selectedSource.filename}</span>
                  ) : null}
                </div>

                <div className={viewMode === 'split' ? 'etl-comparison-grid' : 'etl-comparison-single'}>
                  {viewMode !== 'result' && (
                    <section className="etl-section etl-comparison-pane" aria-labelledby="etl-original-rows-title">
                      <div className="etl-toolbar">
                        <h3 id="etl-original-rows-title">
                          Original data{selectedSource?.filename ? ` (${selectedSource.filename})` : ''}
                        </h3>
                        <label>
                          Original rows per page{' '}
                          <select value={sourcePageSize} onChange={(event) => { setSourcePageSize(Number(event.target.value)); setSourcePage(1); }}>
                            {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                          </select>
                        </label>
                      </div>
                      {!effectiveSourceId && <p className="etl-note">Original source metadata is unavailable for this run.</p>}
                      {effectiveSourceId && originalUnavailable && (
                        <p className="etl-note">
                          Original source unavailable — The source dataset was deleted, so original rows cannot be displayed.
                          The run summary, pipeline steps, and result remain available.
                        </p>
                      )}
                      {effectiveSourceId && !originalUnavailable && originalModified && (
                        <p className="etl-note">
                          Original source changed after this run — This dataset was replaced or modified after execution,
                          so current rows would not match the snapshot used during the run.
                        </p>
                      )}
                      {effectiveSourceId && !originalUnavailable && !originalModified && sourceRowState.loading && (
                        <p className="etl-loading" role="status"><Spinner />Loading original rows…</p>
                      )}
                      {effectiveSourceId && !originalUnavailable && !originalModified && sourceRowState.error && (
                        <div className="etl-error" role="alert">
                          <p>{sourceRowState.error}</p>
                          <button className="button button-secondary" type="button" onClick={() => setSourceAttempt((value) => value + 1)}>
                            Retry original rows
                          </button>
                        </div>
                      )}
                      {effectiveSourceId && !originalUnavailable && !originalModified && sourceRowState.data && (
                        <>
                          <p className="etl-note" aria-live="polite">
                            Rows {sourceRowState.data.total_count ? (sourceRowState.data.page - 1) * sourceRowState.data.page_size + 1 : 0}
                            –{Math.min(sourceRowState.data.page * sourceRowState.data.page_size, sourceRowState.data.total_count)} of {sourceRowState.data.total_count}.
                            {' '}{sourceRowState.data.columns.length} columns.
                          </p>
                          <DataTable
                            columns={sourceRowState.data.columns}
                            rows={sourceRowState.data.rows}
                            caption={`Original rows (${sourceRowState.data.filename || selectedSource?.filename || 'source'}) · page ${sourceRowState.data.page}`}
                            rowOffset={(sourceRowState.data.page - 1) * sourceRowState.data.page_size}
                            selectionKey={`source:${runId}:${effectiveSourceId}:${sourceRowState.data.page}:${sourceRowState.data.page_size}`}
                          />
                          <Pagination
                            page={sourceRowState.data.page}
                            totalPages={sourceRowState.data.total_pages}
                            totalCount={sourceRowState.data.total_count}
                            onPageChange={setSourcePage}
                            label="Original row pages"
                          />
                        </>
                      )}
                    </section>
                  )}

                  {viewMode !== 'original' && (
                    <section className="etl-section etl-comparison-pane" aria-labelledby="etl-rows-title">
                      <div className="etl-toolbar">
                        <h3 id="etl-rows-title">Result rows</h3>
                        <label>
                          Result rows per page{' '}
                          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                            {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                          </select>
                        </label>
                      </div>
                      {rowState.loading && <p className="etl-loading" role="status"><Spinner />Loading rows…</p>}
                      {rowState.error && (
                        <div className="etl-error" role="alert">
                          <p>{rowState.error}</p>
                          <button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry rows</button>
                        </div>
                      )}
                      {rowState.data && (
                        <>
                          <p className="etl-note" aria-live="polite">
                            Rows {rowState.data.total_count ? (rowState.data.page - 1) * rowState.data.page_size + 1 : 0}
                            –{Math.min(rowState.data.page * rowState.data.page_size, rowState.data.total_count)} of {rowState.data.total_count}.
                            {' '}{rowState.data.columns.length} columns.
                          </p>
                          <DataTable
                            columns={rowState.data.columns}
                            rows={rowState.data.rows}
                            caption={`Result rows · page ${rowState.data.page}`}
                            rowOffset={(rowState.data.page - 1) * rowState.data.page_size}
                            selectionKey={`${runId}:${rowState.data.page}:${rowState.data.page_size}`}
                          />
                          <Pagination
                            page={rowState.data.page}
                            totalPages={rowState.data.total_pages}
                            totalCount={rowState.data.total_count}
                            onPageChange={setPage}
                            label="Result row pages"
                          />
                        </>
                      )}
                    </section>
                  )}
                </div>
              </section>

              <section className="etl-section etl-result-file-actions" aria-labelledby="etl-result-file-title">
                <div className="etl-toolbar">
                  <h2 id="etl-result-file-title">Stored result file</h2>
                  <button ref={deleteTrigger} className="button button-secondary etl-result-delete-button" type="button"
                    disabled={downloading || deletion.confirming} aria-expanded={deletion.confirming} aria-controls="etl-delete-result-confirmation"
                    onClick={() => setDeletion({ confirming: true, busy: false, error: '', warning: '' })}>
                    Delete result file
                  </button>
                </div>
                <p className="etl-note">Removing the processed file keeps this run's history, configuration, and summary.</p>
                {deletion.confirming && (
                  <div id="etl-delete-result-confirmation" className="etl-result-delete-confirmation" role="region"
                    aria-labelledby="etl-delete-result-title" aria-describedby="etl-delete-result-description" aria-busy={deletion.busy}>
                    <h3 id="etl-delete-result-title">Delete result file?</h3>
                    <p id="etl-delete-result-description">
                      This permanently removes the processed file. Row browsing and downloads will stop.
                      The run history, configuration, summary, and original source files remain saved.
                    </p>
                    {deletion.error && <p role="alert" className="etl-result-delete-error">{deletion.error}</p>}
                    <div className="etl-actions">
                      <button ref={cancelDeletion} className="button button-secondary" type="button" disabled={deletion.busy}
                        onClick={() => setDeletion({ confirming: false, busy: false, error: '', warning: '' })}>
                        Cancel deletion
                      </button>
                      <button className="button etl-result-delete-button" type="button" disabled={deletion.busy} onClick={deleteResult}>
                        {deletion.busy && <Spinner />}
                        {deletion.busy ? 'Deleting result file…' : 'Confirm file deletion'}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
