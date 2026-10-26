import { useEffect, useRef } from 'react';
import AuthLayout from './components/AuthLayout';
import DashboardLayout from './components/DashboardLayout';
import useSession from './hooks/useSession';
import { navigate, useLocation } from './navigation';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import DatasetsPage from './pages/DatasetsPage';
import LandingPage from './pages/LandingPage';
import NotFoundPage from './pages/NotFoundPage';
import WorkspacePage from './pages/WorkspacePage';
import { findWorkspacePage, getReturnPath, normalizePath } from './routes';
import './App.css';

function Redirect({ to }) {
  useEffect(() => { navigate(to, { replace: true }); }, [to]);
  return null;
}

function App() {
  const location = useLocation();
  const pathname = normalizePath(location.pathname);
  const session = useSession();
  const page = findWorkspacePage(pathname);
  const authRoute = pathname === '/login' || pathname === '/register';
  const returnPath = getReturnPath(location.search);
  const previousPath = useRef(pathname);

  useEffect(() => {
    const title = page?.title || ({ '/': 'Data workflows, simplified', '/login': 'Sign in', '/register': 'Create account' }[pathname]) || 'Page not found';
    document.title = `${title} | CloudETL`;
    if (previousPath.current !== pathname) {
      const heading = document.querySelector('main h1');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
      window.scrollTo(0, 0);
      previousPath.current = pathname;
    }
  }, [pathname, page]);

  // The public landing page stays available even if the authentication API is
  // offline. Workspace route guards are UI navigation, not backend authorization.
  if (pathname === '/') return <LandingPage user={session.user} />;
  if (!page && !authRoute) return <NotFoundPage />;

  if (session.status !== 'ready') {
    return (
      <AuthLayout>
        {session.status === 'loading' ? (
          <div className="state-panel" role="status" aria-live="polite">
            <h1>Checking your session</h1>
            <p>Please wait a moment.</p>
          </div>
        ) : (
          <div className="state-panel">
            <h1>We couldn’t connect</h1>
            <p role="alert">{session.error}</p>
            <button className="button button-primary" type="button" onClick={session.restore}>Try again</button>
          </div>
        )}
      </AuthLayout>
    );
  }

  if (authRoute) {
    if (session.user) return <Redirect to={returnPath} />;
    return (
      <AuthPage key={pathname} mode={pathname === '/register' ? 'register' : 'login'} returnPath={returnPath}
        onSuccess={(user) => {
          session.authenticate(user);
          navigate(returnPath, { replace: true });
        }} />
    );
  }

  if (!session.user) return <Redirect to={`/login?next=${encodeURIComponent(pathname)}`} />;
  return (
    <DashboardLayout user={session.user} page={page} onSignOut={session.signOut}>
      {pathname === '/dashboard' ? <DashboardPage user={session.user} />
        : pathname === '/dashboard/datasets' ? <DatasetsPage onSessionExpired={session.expire} />
        : <WorkspacePage page={page} />}
    </DashboardLayout>
  );
}

export default App;
