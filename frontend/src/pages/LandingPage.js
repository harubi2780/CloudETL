import { Link } from '../navigation';
import './LandingPage.css';

const steps = [
  {
    title: 'Upload',
    tag: 'CSV & TSV',
    description: 'Bring multiple source datasets into an isolated workspace and review rows immediately.',
  },
  {
    title: 'Transform',
    tag: '11 Visual Operations',
    description: 'Clean, cast, filter with calendar popups, and join or append tables without writing code.',
  },
  {
    title: 'Export',
    tag: 'Diff & Download',
    description: 'Compare original vs. transformed data side-by-side and download full CSV or TSV outputs.',
  },
];

const capabilities = [
  {
    title: 'Multi-source workbook builder',
    description: 'Preview multiple files side-by-side, drag to reorder sources and steps, and join or append datasets.',
  },
  {
    title: 'Type-aware filtering & cleaning',
    description: 'Automatic column type detection unlocks date formatting, calendar filters, and type-safe comparisons.',
  },
  {
    title: 'Unified runs & result comparison',
    description: 'Track execution live, inspect schema diffs, compare original vs. result rows, and export in one view.',
  },
  {
    title: 'Per-user cloud storage isolation',
    description: 'Dedicated object storage quotas, SHA-256 snapshot verification, and saved reusable pipeline drafts.',
  },
];

export default function LandingPage({ user }) {
  const destination = user ? '/dashboard' : '/register';
  const action = user ? 'Open dashboard' : 'Get started';

  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link className="brand" to="/" aria-label="CloudETL home">CloudETL</Link>
        <nav className="landing-navigation" aria-label="Main navigation">
          {!user && <Link className="button button-secondary" to="/login">Sign in</Link>}
          <Link className="button button-primary" to={destination}>{action}</Link>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">Cloud Data Preparation &amp; ETL Workspace</p>
            <h1 id="landing-title">From raw data to ready.</h1>
            <p className="landing-introduction">
              Upload CSV and TSV datasets, configure multi-step transformations visually,
              and compare original vs. processed results in one unified workspace.
            </p>
            <div className="landing-actions">
              <Link className="button button-primary" to={destination}>{action}</Link>
              {!user && <Link className="button button-secondary" to="/login">Already have an account? Sign in</Link>}
            </div>
            <ul className="landing-highlights" aria-label="Key highlights">
              <li>Multi-file Join &amp; Append</li>
              <li>Drag-and-drop Pipeline Steps</li>
              <li>Side-by-side Result Diff</li>
            </ul>
          </div>

          <div className="landing-showcase-card" aria-hidden="true">
            <div className="landing-showcase-topbar">
              <span className="landing-showcase-dot" />
              <span className="landing-showcase-dot" />
              <span className="landing-showcase-dot" />
              <span className="landing-showcase-title">Monthly Revenue Cleanup · 2 sources</span>
              <span className="landing-showcase-badge">Ready to run</span>
            </div>
            <div className="landing-showcase-sources">
              <span className="landing-source-pill is-active">orders.csv (1,420×6) · Start</span>
              <span className="landing-source-pill">customers.tsv (380×5) · Used</span>
            </div>
            <div className="landing-showcase-steps">
              <div className="landing-showcase-step">
                <span className="landing-showcase-step-num">1</span>
                <div>
                  <strong>Filter rows</strong>
                  <span>order_date after 2026-01-01 · status equals &ldquo;paid&rdquo;</span>
                </div>
              </div>
              <div className="landing-showcase-step">
                <span className="landing-showcase-step-num">2</span>
                <div>
                  <strong>Clean text &amp; Convert types</strong>
                  <span>Trim region, Title Case · Cast total_amount → float</span>
                </div>
              </div>
              <div className="landing-showcase-step">
                <span className="landing-showcase-step-num">3</span>
                <div>
                  <strong>Join tables</strong>
                  <span>Left join customers.tsv on customer_id (+4 columns)</span>
                </div>
              </div>
            </div>
            <div className="landing-showcase-footer">
              <div>
                <span>Output preview</span>
                <strong>1,240 rows · 10 columns</strong>
              </div>
              <span className="landing-showcase-export">CSV / TSV Export</span>
            </div>
          </div>
        </section>

        <section className="landing-workflow" aria-labelledby="landing-workflow-title">
          <div className="landing-section-header">
            <h2 id="landing-workflow-title">Three steps. One workflow.</h2>
            <p>Everything you need to inspect, clean, combine, and export tabular datasets.</p>
          </div>
          <ol className="landing-steps">
            {steps.map((step, index) => (
              <li className="landing-step" key={step.title}>
                <div className="landing-step-head">
                  <span className="landing-step-number" aria-hidden="true">0{index + 1}</span>
                  <span className="landing-step-tag">{step.tag}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-capabilities" aria-labelledby="landing-capabilities-title">
          <div className="landing-section-header">
            <h2 id="landing-capabilities-title">Built for interactive data preparation</h2>
            <p>Designed for clarity, repeatability, and side-by-side verification.</p>
          </div>
          <div className="landing-capability-grid">
            {capabilities.map((item) => (
              <article className="landing-capability-card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span>CloudETL · Cloud Data Preparation Platform</span>
        <span>Keep your data moving.</span>
      </footer>
    </div>
  );
}
