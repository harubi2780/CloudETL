import { RunHistoryList } from './RunsPage';
import './EtlWorkflow.css';

export default function ResultsPage({ onSessionExpired }) {
  return <div className="etl-page"><header className="page-heading"><h1>Results</h1><p>Browse completed pipeline outputs and download available processed files. Removed files retain their run history.</p></header><RunHistoryList resultsOnly onSessionExpired={onSessionExpired} /></div>;
}
