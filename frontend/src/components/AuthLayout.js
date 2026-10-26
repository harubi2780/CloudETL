import { Link } from '../navigation';

export default function AuthLayout({ children }) {
  return (
    <main className="page-shell" id="main-content">
      <section className="auth-panel" aria-label="Account access">
        <Link className="brand" to="/" aria-label="CloudETL home">CloudETL</Link>
        {children}
      </section>
    </main>
  );
}
