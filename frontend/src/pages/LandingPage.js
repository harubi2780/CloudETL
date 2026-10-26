import { Link } from '../navigation';
import './LandingPage.css';

const steps = [
  { title: 'Upload', description: 'Bring your dataset into one workspace.' },
  { title: 'Transform', description: 'Choose the steps that prepare your data.' },
  { title: 'Export', description: 'Get the processed results, ready for what comes next.' },
];

export default function LandingPage({ user }) {
  const destination = user ? '/dashboard' : '/register';
  const action = user ? 'Open dashboard' : 'Get started';

  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link className="brand" to="/" aria-label="CloudETL home">CloudETL</Link>
        <nav className="landing-navigation" aria-label="Main navigation">
          {!user && <Link className="text-link" to="/login">Sign in</Link>}
          <Link className="button button-primary" to={destination}>{action}</Link>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="landing-eyebrow">A simpler data workflow</p>
          <h1 id="landing-title">From raw data to ready.</h1>
          <p className="landing-introduction">
            Upload a dataset, configure your transformations, and get the results.
            CloudETL keeps each step in one place.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary" to={destination}>{action}</Link>
            {!user && <Link className="text-link" to="/login">Already have an account? Sign in</Link>}
          </div>
        </section>

        <section className="landing-workflow" aria-labelledby="landing-workflow-title">
          <h2 id="landing-workflow-title">Three steps. One workflow.</h2>
          <ol className="landing-steps">
            {steps.map((step, index) => (
              <li className="landing-step" key={step.title}>
                <span className="landing-step-number" aria-hidden="true">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="landing-footer">
        <span>CloudETL</span>
        <span>Keep your data moving.</span>
      </footer>
    </div>
  );
}
