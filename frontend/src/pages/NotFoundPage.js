import AuthLayout from '../components/AuthLayout';
import { Link } from '../navigation';

export default function NotFoundPage() {
  return (
    <AuthLayout>
      <div className="state-panel">
        <h1>Page not found</h1>
        <p>This address does not match a page.</p>
        <Link className="button button-primary" to="/">Back to home</Link>
      </div>
    </AuthLayout>
  );
}
