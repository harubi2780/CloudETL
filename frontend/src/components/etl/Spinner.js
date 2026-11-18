import './Spinner.css';

// Decorative only: callers provide visible status text beside the indicator.
export default function Spinner({ className = '' }) {
  return <span className={`etl-spinner${className ? ` ${className}` : ''}`} aria-hidden="true" data-testid="status-spinner" />;
}
