import { Link } from '../navigation';
import { workspacePages } from '../routes';

export default function DashboardPage({ user }) {
  const visibleWorkspacePages = workspacePages.filter((page) => page.path !== '/dashboard' && !page.hiddenInNav);

  return (
    <div className="overview-page">
      <div className="overview-hero">
        <div className="page-heading">
          <span className="overview-badge">CloudETL Workspace</span>
          <h1>Welcome, {user.username}</h1>
          <p>Upload source files, design multi-step visual transformations, and inspect or export your processed datasets.</p>
        </div>
        <div className="overview-hero-actions">
          <Link className="button button-primary" to="/dashboard/pipelines">Open pipeline builder</Link>
          <Link className="button button-secondary" to="/dashboard/datasets">Upload datasets</Link>
          <Link className="button button-secondary" to="/dashboard/runs">View runs &amp; results</Link>
        </div>
      </div>

      <section className="workspace-section" aria-labelledby="getting-started-title">
        <div className="section-heading">
          <div>
            <h2 id="getting-started-title">Get started</h2>
            <p className="section-subheading">Three guided stages from raw CSV/TSV files to clean, downloadable outputs.</p>
          </div>
          <span className="overview-pill">End-to-end ETL</span>
        </div>
        <ol className="workflow-list">
          <li>
            <div className="workflow-card-top">
              <span className="step-number">01</span>
              <span className="workflow-tag">CSV &amp; TSV</span>
            </div>
            <div>
              <h3>Add a dataset</h3>
              <p>Upload source files into your private storage bucket and review tabular rows immediately.</p>
            </div>
            <Link className="button button-secondary" to="/dashboard/datasets">View datasets</Link>
          </li>
          <li>
            <div className="workflow-card-top">
              <span className="step-number">02</span>
              <span className="workflow-tag">11 Operations</span>
            </div>
            <div>
              <h3>Build a pipeline</h3>
              <p>Filter, clean, cast types, and join or append multiple tables in the interactive workbook.</p>
            </div>
            <Link className="button button-secondary" to="/dashboard/pipelines">View pipelines</Link>
          </li>
          <li>
            <div className="workflow-card-top">
              <span className="step-number">03</span>
              <span className="workflow-tag">Compare &amp; Export</span>
            </div>
            <div>
              <h3>Inspect runs &amp; results</h3>
              <p>Monitor execution, compare original vs. result rows side-by-side, and download processed files.</p>
            </div>
            <Link className="button button-secondary" to="/dashboard/runs">View runs</Link>
          </li>
        </ol>
      </section>

      <section className="workspace-section" aria-labelledby="explore-title">
        <div className="section-heading">
          <div>
            <h2 id="explore-title">Your workspace</h2>
            <p className="section-subheading">Jump directly to any module in your CloudETL account.</p>
          </div>
        </div>
        <div className="workspace-links">
          {visibleWorkspacePages.map((page) => (
            <Link className="workspace-link" key={page.path} to={page.path}>
              <h3>{page.title}<span className="workspace-link-arrow" aria-hidden="true">Open →</span></h3>
              <p>{page.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="activity-title">
        <div className="section-heading">
          <div>
            <h2 id="activity-title">Recent activity &amp; outputs</h2>
            <p className="section-subheading">All pipeline executions and completed result exports live in one unified Runs view.</p>
          </div>
          <Link className="button button-secondary" to="/dashboard/runs">View all runs</Link>
        </div>
        <div className="activity-empty">
          <div className="activity-empty-copy">
            <h3>Track pipeline runs and download completed results</h3>
            <p>Open Runs to monitor queued jobs, inspect step-by-step schema changes, compare original vs. output tables, and export CSV/TSV results.</p>
          </div>
          <div className="activity-empty-actions">
            <Link className="button button-primary" to="/dashboard/runs">Open runs &amp; results</Link>
            <Link className="button button-secondary" to="/dashboard/pipelines">Create new pipeline</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
