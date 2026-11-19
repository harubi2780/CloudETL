import { useCallback, useEffect, useRef, useState } from 'react';
import accountApi from '../api/account';
import StorageUsage, { formatStorageBytes } from '../components/StorageUsage';
import Spinner from '../components/etl/Spinner';
import BillingPanel from '../components/billing/BillingPanel';
import './AccountPage.css';

export default function AccountPage({ onSessionExpired }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, account: null, error: '' });
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;
  const refreshAccount = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    accountApi.get({ signal: controller.signal }).then(({ account }) => {
      if (!controller.signal.aborted) setState({ loading: false, account, error: '' });
    }).catch((error) => {
      if (controller.signal.aborted || error.name === 'AbortError') return;
      if (error.status === 401) expired.current?.();
      setState((previous) => ({ ...previous, loading: false, error: error.message || 'We could not load your account.' }));
    });
    return () => controller.abort();
  }, [attempt]);

  const account = state.account;
  return <div className="account-page">
    <header className="account-page-heading"><div className="page-heading"><h1>Account</h1><p>Your profile, plan, and storage allowance.</p></div><button className="button button-secondary" type="button" disabled={state.loading} onClick={() => setAttempt((value) => value + 1)}>Refresh account</button></header>
    {state.loading && <p className="account-loading" role="status"><Spinner />Loading account…</p>}
    {state.error && <div className="account-error" role="alert"><p>{state.error}</p><button className="button button-secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Retry account</button></div>}
    {state.error && account && <p className="account-note">Showing the last loaded account details. Retry to update your plan and storage.</p>}
    {account && <>
      <div className="account-overview">
      <section className="account-section" aria-labelledby="account-profile-title"><div className="account-section-heading"><h2 id="account-profile-title">Profile</h2></div>
        <dl className="account-profile"><div><dt>Username</dt><dd>{account.username}</dd></div><div><dt>Email address</dt><dd>{account.email || 'No email address'}</dd></div><div><dt>Account status</dt><dd><span className={`account-pill${account.status === 'active' ? ' account-pill-active' : ''}`}>{account.status === 'active' ? 'Active' : 'Inactive'}</span></dd></div><div><dt>Joined</dt><dd><time dateTime={account.joined_at}>{new Date(account.joined_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time></dd></div></dl>
      </section>
      <section className="account-section" aria-labelledby="account-plan-title"><div className="account-section-heading"><h2 id="account-plan-title">Plan and storage</h2><span className={`account-pill${account.plan.code === 'premium' ? ' account-pill-premium' : ''}`} aria-label="Current plan">{account.plan.name}</span></div>
        <StorageUsage storage={account.storage} refreshing={state.loading} />
        <dl className="account-storage-breakdown"><div><dt>Uploaded files</dt><dd>{formatStorageBytes(account.storage.uploaded_bytes)}</dd></div><div><dt>Processed results</dt><dd>{formatStorageBytes(account.storage.result_bytes)}</dd></div><div><dt>Pending cleanup</dt><dd>{formatStorageBytes(account.storage.pending_cleanup_bytes)}</dd></div><div><dt>Reserved storage</dt><dd>{formatStorageBytes(account.storage.reserved_bytes)}</dd></div></dl>
        {account.storage.pending_cleanup_bytes > 0 && <p className="account-note">Files awaiting removal still count toward storage until cleanup finishes.</p>}
      </section>
      </div>
      <BillingPanel currentPlanCode={account.plan.code} onAccountChanged={refreshAccount} onSessionExpired={onSessionExpired} />
    </>}
  </div>;
}
