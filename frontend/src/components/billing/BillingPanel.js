import { useCallback, useEffect, useRef, useState } from 'react';
import billingApi from '../../api/billing';
import { formatStorageBytes } from '../StorageUsage';
import Spinner from '../etl/Spinner';
import CheckoutDialog from './CheckoutDialog';
import './BillingPanel.css';

const vnd = (amount) => `${new Intl.NumberFormat('en-US').format(amount)} VND`;
const dateTime = (value) => new Date(value).toLocaleString();
const stateLabels = { pending: 'Pending', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired' };
const completionMessage = {
  succeeded: 'Your Premium plan is active.',
  failed: 'Payment was unsuccessful. Your plan has not changed.',
  cancelled: 'Checkout cancelled. Your plan has not changed.',
  expired: 'Checkout expired. No payment was applied.',
};

export default function BillingPanel({ onAccountChanged, onSessionExpired, currentPlanCode }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmExpiry, setConfirmExpiry] = useState(false);
  const active = useRef(true);
  const controller = useRef(null);
  const version = useRef(0);
  const actionLock = useRef(false);
  const accountChanged = useRef(onAccountChanged);
  const expired = useRef(onSessionExpired);
  accountChanged.current = onAccountChanged;
  expired.current = onSessionExpired;

  const load = useCallback(async () => {
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    const requestVersion = ++version.current;
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const data = await billingApi.get({ signal: requestController.signal });
      if (!active.current || requestController.signal.aborted || requestVersion !== version.current) return null;
      setState({ loading: false, data, error: '' });
      setCheckout((current) => current ? data.orders.find((order) => order.id === current.id && order.status === 'pending') || null : null);
      return data;
    } catch (error) {
      if (!active.current || requestController.signal.aborted || requestVersion !== version.current || error.name === 'AbortError') return null;
      if (error.status === 401) expired.current?.();
      setState((previous) => ({ ...previous, loading: false, error: error.message || 'We could not load billing details.' }));
      return null;
    }
  }, []);

  useEffect(() => {
    active.current = true;
    load();
    return () => { active.current = false; controller.current?.abort(); };
  }, [load]);

  function recordOrder(order) {
    setState((previous) => ({ ...previous, data: { ...previous.data,
      orders: [order, ...previous.data.orders.filter((item) => item.id !== order.id)].slice(0, 20) } }));
  }

  async function perform(action, execute) {
    if (actionLock.current || !state.data?.demo_enabled || state.loading || state.error) return;
    actionLock.current = true;
    setBusy(action);
    setActionError('');
    setNotice('');
    try {
      const response = await execute();
      if (!active.current) return;
      if (action === 'creating') {
        recordOrder(response.order);
        setCheckout(response.order.status === 'pending' ? response.order : null);
        setNotice('');
      } else if (action === 'completing') {
        recordOrder(response.order);
        setCheckout(null);
        setNotice(completionMessage[response.order.status] || 'Payment details updated.');
        if (response.order.status === 'succeeded') accountChanged.current?.();
        await load();
      } else {
        setConfirmExpiry(false);
        setNotice('Premium access ended. Your account now uses the Free allowance.');
        accountChanged.current?.();
        await load();
      }
    } catch (error) {
      if (!active.current) return;
      if (error.status === 401) expired.current?.();
      if (error.status === 410) {
        setCheckout(null);
        setNotice('Checkout expired. Refresh payment history before starting again.');
        const refreshed = await load();
        if (active.current && refreshed) setNotice('Checkout expired. Start a new checkout when ready.');
      } else {
        setActionError(error.message || 'We could not complete this action. Please try again.');
      }
    } finally {
      actionLock.current = false;
      if (active.current) setBusy('');
    }
  }

  const data = state.data;
  const premium = data?.plans.find((plan) => plan.code === 'premium');
  const free = data?.plans.find((plan) => plan.code === 'free');
  const unavailable = Boolean(busy || state.loading || state.error);
  const activePremium = data?.subscription.status === 'active';
  const selectedPlan = currentPlanCode || (activePremium ? 'premium' : 'free');
  const pendingOrder = data?.orders.find((order) => order.status === 'pending');

  function resume(order) {
    setCheckout(order);
    setActionError('');
    setNotice('');
  }

  return <section className="billing-panel" aria-labelledby="billing-panel-title">
    <div className="billing-heading"><div><h2 id="billing-panel-title">Plan and billing</h2><p className="billing-note">Choose the space you need for your data.</p></div><div className="billing-heading-actions">{data?.demo_enabled && <span className="billing-mode">Test mode</span>}<button className="button button-secondary" aria-label="Refresh billing" type="button" onClick={load} disabled={Boolean(busy || state.loading)}>Refresh</button></div></div>
    {state.loading && <p className="billing-loading" role="status"><Spinner />Loading billing details...</p>}
    {state.error && <div className="billing-error" role="alert"><p>{state.error}</p><button className="button button-secondary" type="button" onClick={load} disabled={Boolean(busy)}>Retry billing</button></div>}
    {actionError && !checkout && <p className="billing-error" role="alert">{actionError}</p>}
    {notice && <p className="billing-feedback" role="status">{notice}</p>}
    {data && <>
      {state.error && <p className="billing-note">Showing the last loaded billing details.</p>}
      <div className="billing-plans">{data.plans.map((plan) => <article key={plan.code} className={`billing-plan${selectedPlan === plan.code ? ' billing-plan-current' : ''}`} aria-label={`${plan.name} plan`}>
        <div className="billing-plan-heading"><h3>{plan.name}</h3>{selectedPlan === plan.code && <span className="billing-current">Current plan</span>}</div>
        <p className="billing-allowance">{formatStorageBytes(plan.storage_limit_bytes)} <span>storage</span></p><p className="billing-price">{vnd(plan.amount_vnd)}{plan.period_days && <span> / {plan.period_days} days</span>}</p>
        <p className="billing-note">{plan.code === 'free' ? 'For small projects and everyday data preparation.' : 'More room for source files and processed results.'}</p>
      </article>)}</div>
      <p className="billing-note">All plans include the same ETL tools and export formats. Storage covers uploads and saved results.</p>
      <div className="billing-subscription" aria-label="Subscription status">
        {activePremium ? <p>Premium active{data.subscription.current_period_end && <> until <time dateTime={data.subscription.current_period_end}>{dateTime(data.subscription.current_period_end)}</time></>}.</p>
          : <p>{data.subscription.status === 'expired' ? 'Premium period ended. Free storage limits apply.' : 'Free plan - no expiry date.'}</p>}
        {activePremium && <p className="billing-note">Renew anytime to add {premium?.period_days || 30} days to your remaining access. No automatic renewal.</p>}
      </div>
      {!data.demo_enabled && <p className="billing-note">Plan changes are not available in this environment.</p>}
      {data.demo_enabled && <>
        <div className="billing-actions">
          {premium && <button className="button button-primary" type="button" disabled={unavailable || Boolean(checkout)} onClick={() => pendingOrder ? resume(pendingOrder) : perform('creating', () => billingApi.createDemoOrder())}>{busy === 'creating' ? <><Spinner />Preparing checkout...</> : pendingOrder ? 'Continue checkout' : activePremium ? 'Renew Premium' : 'Upgrade to Premium'}</button>}
          <span className="billing-note">{premium && `${vnd(premium.amount_vnd)} for ${premium.period_days} days. `}No automatic charges.</span>
        </div>
        {checkout && <CheckoutDialog order={checkout} renewal={activePremium} busy={Boolean(busy)} error={actionError}
          onClose={() => { if (!actionLock.current) { setCheckout(null); setActionError(''); } }}
          onConfirm={() => perform('completing', () => billingApi.completeDemoOrder(checkout.id, 'succeeded'))}
          onCancel={() => perform('completing', () => billingApi.completeDemoOrder(checkout.id, 'cancelled'))}
          onSimulateFailure={() => perform('completing', () => billingApi.completeDemoOrder(checkout.id, 'failed'))} />}
        {activePremium && <details className="billing-testing"><summary>Testing tools</summary><p className="billing-note">Preview the end of a subscription without waiting for its expiry date.</p>
          <button className="button button-secondary" type="button" disabled={unavailable || Boolean(checkout)} onClick={() => { setConfirmExpiry(true); setActionError(''); }}>End Premium access</button>
          {confirmExpiry && <section className="billing-confirmation" aria-labelledby="billing-expiry-title"><h3 id="billing-expiry-title">End Premium access now?</h3><p>Your account returns to Free{free ? ` with ${formatStorageBytes(free.storage_limit_bytes)} storage` : ''}. Existing files stay saved. New uploads or results may be blocked if usage exceeds the Free allowance.</p><div className="billing-actions"><button className="button button-secondary" type="button" disabled={unavailable} onClick={() => setConfirmExpiry(false)}>Keep Premium</button><button className="button button-secondary" type="button" disabled={unavailable} onClick={() => perform('expiring', () => billingApi.expireDemoSubscription())}>{busy === 'expiring' ? <><Spinner />Ending access...</> : 'Confirm expiry'}</button></div></section>}
        </details>}
      </>}
      <div className="billing-history"><h3>Payment history</h3>{data.orders.length === 0 ? <div className="billing-empty"><p>No payments yet</p><span>Your plan purchases and renewals will appear here.</span></div> : <div className="billing-table-scroll"><table className="billing-table"><caption>Recent payments (up to 20)</caption><thead><tr><th scope="col">Plan</th><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead><tbody>{data.orders.map((order) => <tr key={order.id}><th scope="row">{order.plan_name}<span className="billing-reference">#{order.id.slice(-8).toUpperCase()}</span></th><td><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></td><td>{vnd(order.amount_vnd)}</td><td><span className={`billing-status billing-status-${order.status}`}>{stateLabels[order.status]}</span></td><td>
        <details className="billing-order-details"><summary aria-label={`Details for order ${order.id}`}>View details</summary><dl><div><dt>Order reference</dt><dd>{order.id}</dd></div><div><dt>Created</dt><dd>{dateTime(order.created_at)}</dd></div><div><dt>Checkout expires</dt><dd>{dateTime(order.expires_at)}</dd></div>{order.completed_at && <div><dt>Updated</dt><dd>{dateTime(order.completed_at)}</dd></div>}</dl></details>
        {order.status === 'pending' && data.demo_enabled && <button className="button button-secondary" type="button" disabled={unavailable || Boolean(checkout)} aria-label={`Continue payment for order ${order.id}`} onClick={() => resume(order)}>Continue payment</button>}
      </td></tr>)}</tbody></table></div>}</div>
    </>}
  </section>;
}
