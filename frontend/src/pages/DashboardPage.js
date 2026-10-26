import { Link } from '../navigation';
import { workspacePages } from '../routes';

export default function DashboardPage({ user }) {
  return (
    <>
      <div className="page-heading">
        <h1>Welcome, {user.username}</h1>
        <p>A simple workspace for your data workflows.</p>
      </div>
      <section className="workspace-section" aria-labelledby="getting-started-title">
        <div className="section-heading">
          <h2 id="getting-started-title">Get started</h2>
          <span className="muted-copy">From source to result</span>
        </div>
        <ol className="workflow-list">
          <li><span className="step-number">01</span><div><h3>Add a dataset</h3><p>Bring a source file into your workspace.</p></div><Link className="text-link" to="/dashboard/datasets">View datasets</Link></li>
          <li><span className="step-number">02</span><div><h3>Build a pipeline</h3><p>Choose the steps that prepare your data.</p></div><Link className="text-link" to="/dashboard/pipelines">View pipelines</Link></li>
          <li><span className="step-number">03</span><div><h3>Review your output</h3><p>Follow a run and find its processed results.</p></div><Link className="text-link" to="/dashboard/results">View results</Link></li>
        </ol>
      </section>
      <section className="workspace-section" aria-labelledby="explore-title">
        <h2 id="explore-title">Your workspace</h2>
        <div className="workspace-links">
          {workspacePages.slice(1).map((page) => (
            <Link className="workspace-link" key={page.path} to={page.path}>
              <h3>{page.title}<span aria-hidden="true">↗</span></h3>
              <p>{page.description}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="workspace-section" aria-labelledby="activity-title">
        <div className="section-heading">
          <h2 id="activity-title">Recent activity</h2>
          <Link className="text-link" to="/dashboard/runs">View runs</Link>
        </div>
        <div className="activity-empty">
          <h3>No activity to show yet</h3>
          <p>Your workflow activity will appear here when pipeline execution is available.</p>
        </div>
      </section>
    </>
  );
}
