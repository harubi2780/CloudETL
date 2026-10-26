import { useState } from 'react';
import { Link, navigate } from '../navigation';
import { workspacePages } from '../routes';
import './DashboardLayout.css';

export default function DashboardLayout({ user, page, onSignOut, children }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await onSignOut();
      navigate('/login', { replace: true });
    } catch (error) {
      setNotice(error.message || 'We could not log you out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-layout">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="dashboard-sidebar">
        <Link className="brand" to="/" aria-label="CloudETL home">CloudETL</Link>
        <p className="nav-caption">Workspace</p>
        <nav className="dashboard-navigation" aria-label="Workspace">
          {workspacePages.map((item) => (
            <Link key={item.path} to={item.path} aria-current={page.path === item.path ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="dashboard-account">
          <strong>{user.username}</strong>
          <span>{user.email}</span>
          {notice && <p className="form-alert" role="alert">{notice}</p>}
          <button className="button button-secondary" type="button" onClick={handleSignOut} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-topbar">
          <span>Workspace / {page.label}</span>
          <span className="preview-label">Workspace preview</span>
        </header>
        <main className="dashboard-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
