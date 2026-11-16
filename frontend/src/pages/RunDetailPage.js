import useRun from '../hooks/useRun';
import { Link } from '../navigation';
import { runDate, RunStatus } from './RunsPage';
import './EtlWorkflow.css';

function elapsed(run, checkedAt) {
  if (!run.started_at) return 'Waiting for a worker';
  const start = Date.parse(run.started_at);
  const end = run.finished_at ? Date.parse(run.finished_at) : checkedAt;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Unavailable';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function RunDetailPage({ runId, onSessionExpired }) {
  const { run, loading, error, checkedAt, retry } = useRun(runId, onSessionExpired);
  return <div className="etl-page">
    <Link to="/dashboard/runs">← All runs</Link>
    <header className="page-heading"><h1>{run?.name || 'Run details'}</h1><p>Execution status and the configuration submitted for this run.</p></header>
    {loading && <p role="status">Loading run…</p>}
    {error && <div className="etl-error" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={retry}>Retry status</button></div>}
    {run && <>
      <section className="etl-section" aria-label="Run status">
        <div className="etl-toolbar"><RunStatus status={run.status} /><Link to={`/dashboard/pipelines?run=${run.id}`}>Edit and resubmit</Link></div>
        <dl className="etl-facts"><div><dt>Submitted</dt><dd>{runDate(run.created_at)}</dd></div><div><dt>Started</dt><dd>{runDate(run.started_at)}</dd></div><div><dt>Finished</dt><dd>{runDate(run.finished_at)}</dd></div><div><dt>{run.finished_at ? 'Execution time' : 'Elapsed execution time'}</dt><dd>{elapsed(run, checkedAt)}</dd></div></dl>
        {(run.status === 'queued' || run.status === 'running') && <p className="etl-note" role="status">{run.status === 'queued' ? 'Queued for an available worker.' : 'The worker is processing this pipeline.'} {error ? 'Status updates are paused. Retry to reconnect.' : 'Status updates every 2 seconds while this page is visible.'}</p>}
        {run.status === 'failed' && <div className="etl-error" role="alert"><h2>Run failed</h2><p>{run.error?.message || 'Processing failed. Review the configuration and submit a new run.'}</p>{run.error?.code && <p className="etl-note">Error code: {run.error.code}</p>}</div>}
        {run.status === 'succeeded' && <div className="etl-complete"><h2>Result ready</h2><p>{typeof run.summary?.final_rows === 'number' ? `${run.summary.final_rows.toLocaleString()} output rows.` : 'The pipeline finished successfully.'}</p><Link className="button button-primary" to={`/dashboard/results/${run.id}`}>View result</Link></div>}
      </section>
      {run.summary && run.status === 'succeeded' && <section className="etl-section" aria-labelledby="etl-summary-title"><h2 id="etl-summary-title">Run summary</h2><dl className="etl-facts">{[['Input rows', 'initial_rows'], ['Output rows', 'final_rows'], ['Rows removed', 'dropped_rows'], ['Rows added', 'added_rows']].map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{typeof run.summary[key] === 'number' ? run.summary[key].toLocaleString() : 'Unavailable'}</dd></div>)}</dl></section>}
      {run.configuration && <section className="etl-section" aria-labelledby="etl-config-title"><h2 id="etl-config-title">Submitted configuration</h2><details><summary>Show pipeline JSON</summary><pre className="etl-json">{JSON.stringify(run.configuration, null, 2)}</pre></details></section>}
    </>}
  </div>;
}
