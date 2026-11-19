import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Spinner from '../etl/Spinner';
import './CheckoutDialog.css';

function focusableElements(dialog) {
  return Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter((element) => {
    if (element.hidden || element.tabIndex < 0) return false;
    const closed = element.closest('details:not([open])');
    return !closed || element === closed.querySelector('summary');
  });
}

export default function CheckoutDialog({ order, renewal = false, busy = false, error = '', onConfirm, onCancel, onClose, onSimulateFailure }) {
  const [portal] = useState(() => document.createElement('div'));
  const dialog = useRef(null);
  const primary = useRef(null);
  const heading = useRef(null);
  const actions = useRef({ busy, onClose });
  actions.current = { busy, onClose };
  const titleId = useId();
  const noticeId = useId();
  const orderId = order?.id;

  useLayoutEffect(() => {
    if (!orderId) return undefined;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    portal.className = 'checkout-dialog-layer';
    document.body.appendChild(portal);
    const background = Array.from(document.body.children).filter((element) => element !== portal).map((element) => ({
      element, inert: element.getAttribute('inert'), hidden: element.getAttribute('aria-hidden'),
    }));
    background.forEach(({ element }) => {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = 'hidden';

    function focusInside() {
      if (!actions.current.busy && primary.current && !primary.current.disabled) primary.current.focus();
      else heading.current?.focus();
    }

    function keepFocusInside(event) {
      if (!dialog.current?.contains(event.target)) focusInside();
    }

    function keyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!actions.current.busy) actions.current.onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = focusableElements(dialog.current);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); heading.current?.focus(); return; }
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !items.includes(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !items.includes(focused))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('focusin', keepFocusInside, true);
    focusInside();
    return () => {
      document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('focusin', keepFocusInside, true);
      background.forEach(({ element, inert, hidden }) => {
        if (inert === null) element.removeAttribute('inert');
        else element.setAttribute('inert', inert);
        if (hidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', hidden);
      });
      document.body.style.overflow = previousOverflow;
      portal.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [orderId, portal]); // One focus/scroll lifecycle per order, not per busy or error render.

  useLayoutEffect(() => {
    if (busy && dialog.current?.contains(document.activeElement)) heading.current?.focus();
  }, [busy]);

  if (!order) return null;
  const confirmLabel = renewal ? 'Confirm renewal' : 'Confirm upgrade';
  const title = renewal ? 'Renew Premium' : 'Review your upgrade';
  const amount = `${new Intl.NumberFormat('en-US').format(order.amount_vnd)} VND`;
  return createPortal(<div className="checkout-dialog-backdrop">
    <section className="checkout-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={noticeId} aria-busy={busy} ref={dialog}>
      <header className="checkout-dialog-heading"><div><p className="checkout-dialog-eyebrow">Checkout</p><h2 id={titleId} tabIndex={-1} ref={heading}>{title}</h2></div><button className="checkout-dialog-close" type="button" aria-label="Close checkout" disabled={busy} onClick={() => { if (!busy) onClose?.(); }}><span aria-hidden="true">×</span></button></header>
      <p className="checkout-dialog-notice" id={noticeId}>Test mode — no money charged</p>
      <dl className="checkout-dialog-summary"><div><dt>Plan</dt><dd>{order.plan_name}</dd></div><div><dt>Period</dt><dd>{order.period_days} days</dd></div><div className="checkout-dialog-total"><dt>Total</dt><dd>{amount}</dd></div></dl>
      <p className="checkout-dialog-note">This is a simulated payment. Your plan renews manually. There is no automatic renewal or automatic charge.</p>
      <p className="checkout-dialog-note">Checkout expires <time dateTime={order.expires_at}>{new Date(order.expires_at).toLocaleString()}</time>.</p>
      {error && <p className="checkout-dialog-error" role="alert">{error}</p>}
      <div className="checkout-dialog-actions"><button className="button button-primary" type="button" ref={primary} disabled={busy} onClick={() => { if (!busy) onConfirm?.(); }}>{busy && <Spinner />}{confirmLabel}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => { if (!busy) onCancel?.(); }}>Cancel checkout</button></div>
      {busy && <p className="checkout-dialog-processing" role="status">Applying your test payment…</p>}
      {onSimulateFailure && <details className="checkout-dialog-testing" aria-label="Testing tools"><summary>Testing tools</summary><p>Simulate a failed payment without changing your plan.</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => { if (!busy) onSimulateFailure(); }}>Simulate failed payment</button></details>}
      <details className="checkout-dialog-reference"><summary>Order reference</summary><p>{order.id}</p></details>
    </section>
  </div>, portal);
}
