import { useState } from 'react';
import authApi, { AuthApiError } from '../api/auth';
import AuthLayout from '../components/AuthLayout';
import { Link } from '../navigation';

const emptyLogin = { username: '', password: '' };
const emptyRegistration = { username: '', email: '', password: '', password_confirmation: '' };

export default function AuthPage({ mode, returnPath, onSuccess }) {
  const [login, setLogin] = useState(emptyLogin);
  const [registration, setRegistration] = useState(emptyRegistration);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const isRegistration = mode === 'register';
  const next = returnPath === '/dashboard' ? '' : `?next=${encodeURIComponent(returnPath)}`;

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice('');
    setFieldErrors({});
    try {
      const user = isRegistration ? await authApi.register(registration) : await authApi.login(login);
      setLogin(emptyLogin);
      setRegistration(emptyRegistration);
      onSuccess(user);
    } catch (error) {
      if (error instanceof AuthApiError && error.fields) setFieldErrors(error.fields);
      setNotice(error.message || 'We could not complete your request. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="card-heading">
        <h1>{isRegistration ? 'Create your account' : 'Welcome back'}</h1>
        <p>{isRegistration ? 'Enter your details to get started.' : 'Sign in to your workspace.'}</p>
      </div>
      <nav className="mode-switch" aria-label="Account access">
        <Link to={`/login${next}`} aria-current={!isRegistration ? 'page' : undefined}>Sign in</Link>
        <Link to={`/register${next}`} aria-current={isRegistration ? 'page' : undefined}>Create account</Link>
      </nav>
      <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={busy}>
        {isRegistration ? (
          <>
            <FormField id="register-username" label="Username" autoComplete="username" value={registration.username} errors={fieldErrors.username} onChange={(value) => setRegistration({ ...registration, username: value })} disabled={busy} />
            <FormField id="register-email" label="Email address" type="email" autoComplete="email" value={registration.email} errors={fieldErrors.email} onChange={(value) => setRegistration({ ...registration, email: value })} disabled={busy} />
            <FormField id="register-password" label="Password" type="password" autoComplete="new-password" value={registration.password} errors={fieldErrors.password} onChange={(value) => setRegistration({ ...registration, password: value })} disabled={busy} />
            <FormField id="register-password-confirmation" label="Confirm password" type="password" autoComplete="new-password" value={registration.password_confirmation} errors={fieldErrors.password_confirmation} onChange={(value) => setRegistration({ ...registration, password_confirmation: value })} disabled={busy} />
          </>
        ) : (
          <>
            <FormField id="login-username" label="Username" autoComplete="username" value={login.username} errors={fieldErrors.username} onChange={(value) => setLogin({ ...login, username: value })} disabled={busy} />
            <FormField id="login-password" label="Password" type="password" autoComplete="current-password" value={login.password} errors={fieldErrors.password} onChange={(value) => setLogin({ ...login, password: value })} disabled={busy} />
          </>
        )}
        {notice && <p className="form-alert" role="alert">{notice}</p>}
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isRegistration ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}

function FormField({ id, label, type = 'text', autoComplete, value, errors, onChange, disabled }) {
  const errorText = Array.isArray(errors) ? errors.join(' ') : errors;
  const errorId = `${id}-error`;
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} type={type} autoComplete={autoComplete} value={value}
        onChange={(event) => onChange(event.target.value)} disabled={disabled}
        aria-invalid={Boolean(errorText)} aria-describedby={errorText ? errorId : undefined} required />
      {errorText && <span className="field-error" id={errorId}>{errorText}</span>}
    </div>
  );
}
