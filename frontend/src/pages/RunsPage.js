import { useEffect, useRef, useState } from 'react';
import etlApi from '../api/etl';
import Pagination from '../components/etl/Pagination';
import Spinner from '../components/etl/Spinner';
import { Link } from '../navigation';
import './EtlWorkflow.css';

export function runDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

export function RunStatus({ status }) {
  const label = ({ queued: 'Queued', running: 'Running', succeeded: 'Succeeded', failed: 'Failed' })[status] || 'Unknown';
  return <span className={`etl-status etl-status-${status}`}>{status === 'running' && <Spinner />}{label}</span>;
}

export function RunHistoryList({ onSessionExpired, resultsOnly = false }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, data: null, error: '' });
    etlApi.listRuns({ page, status: resultsOnly ? 'succeeded' : filter, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setState({ loading: false, data, error: '' });
    }).catch((error) => {
      if (controller.signal.aborted || error.name === 'AbortError') return;
      if (error.status === 401) expired.current?.();
      setState({ loading: false, data: null, error: error.message || 'We could not load run history.' });
    });
    return () => controller.abort();
  }, [page, filter, attempt, resultsOnly]);

  return (
    <section className="etl-section" aria-label={resultsOnly ? 'Completed results' : 'Run history'}>
      <div className="etl-toolbar">
        {!resultsOnly && <label>Status <select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
          <option value="">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option>
        </select></label>}
        <button className="button button-secondary" type="button" disabled={state.loading} onClick={() => setAttempt((value) => value + 1)}>Refresh {resultsOnly ? 'results' : 'runs'}</button>
      </div>
      {state.loading && <p className="etl-loading" role="status"><Spinner />Loading {resultsOnly ? 'results' : 'runs'}…</p>}
      {state.error && <div className="etl-error" role="alert"><p>{state.error}</p><button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
      {state.data && state.data.runs.length === 0 && <div className="etl-empty"><h2>{resultsOnly ? 'No completed results yet' : filter ? 'No runs with this status' : 'No runs yet'}</h2><p>{resultsOnly ? 'Results appear here when a run succeeds.' : 'Choose a dataset and submit a pipeline to start processing.'}</p><Link to="/dashboard/pipelines">Open pipeline builder</Link></div>}
      {state.data && state.data.runs.length > 0 && <>
        <div className="etl-table-scroll"><table className="etl-table"><caption>{resultsOnly ? 'Completed ETL results' : 'ETL run history'}</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Submitted</th><th scope="col">Finished</th><th scope="col">Actions</th></tr></thead>
          <tbody>{state.data.runs.map((run) => <tr key={run.id}>
            <th scope="row"><Link to={`/dashboard/${resultsOnly && run.result_available !== false ? 'results' : 'runs'}/${run.id}`}>{run.name}</Link></th>
            <td><RunStatus status={run.status} /></td><td>{runDate(run.created_at)}</td><td>{runDate(run.finished_at)}</td>
            <td><div className="etl-actions"><Link to={`/dashboard/runs/${run.id}`}>Run details</Link>{run.status === 'succeeded' && (run.result_available === false ? <span className="etl-note">File removed</span> : <Link to={`/dashboard/results/${run.id}`}>View result</Link>)}</div></td>
          </tr>)}</tbody>
        </table></div>
        <Pagination page={state.data.page} totalPages={state.data.total_pages} totalCount={state.data.total_count} onPageChange={setPage} label={resultsOnly ? 'Result pages' : 'Run pages'} />
      </>}
    </section>
  );
}

export default function RunsPage({ onSessionExpired }) {
  return <div className="etl-page"><header className="page-heading"><h1>Runs</h1><p>Track submitted pipelines and inspect their status.</p></header><RunHistoryList onSessionExpired={onSessionExpired} /></div>;
}
