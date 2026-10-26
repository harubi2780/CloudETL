import { useSyncExternalStore } from 'react';

const navigationEvent = 'cloudetl:navigate';

function subscribe(callback) {
  window.addEventListener('popstate', callback);
  window.addEventListener(navigationEvent, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(navigationEvent, callback);
  };
}

function getSnapshot() {
  return window.location.pathname + window.location.search + window.location.hash;
}

export function useLocation() {
  const location = useSyncExternalStore(subscribe, getSnapshot);
  const url = new URL(location, window.location.origin);
  return { pathname: url.pathname, search: url.search, hash: url.hash };
}

export function navigate(to, { replace = false } = {}) {
  const destination = new URL(to, window.location.origin);
  if (destination.origin !== window.location.origin) return;
  const next = destination.pathname + destination.search + destination.hash;
  if (getSnapshot() === next) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
  window.dispatchEvent(new Event(navigationEvent));
}

// Real anchors retain open-in-new-tab, copy-link, and browser history behavior.
export function Link({ to, onClick, children, ...props }) {
  function handleClick(event) {
    onClick?.(event);
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey ||
      event.ctrlKey || event.shiftKey || event.altKey ||
      (props.target && props.target !== '_self') || props.download !== undefined
    ) return;
    const destination = new URL(to, window.location.origin);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(to);
  }
  return <a {...props} href={to} onClick={handleClick}>{children}</a>;
}
