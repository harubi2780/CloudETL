import { useEffect, useRef, useState } from 'react';
import etlApi from '../api/etl';

const pending = (status) => status === 'queued' || status === 'running';

export default function useRun(runId, onSessionExpired) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ run: null, loading: true, error: '', checkedAt: null });
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;

  useEffect(() => {
    let active = true;
    let timer;
    let controller;
    let inFlight = false;
    let lastStatus;
    setState({ run: null, loading: true, error: '', checkedAt: null });

    async function load() {
      if (!active || inFlight) return;
      clearTimeout(timer);
      inFlight = true;
      controller = new AbortController();
      try {
        const { run } = await etlApi.getRun(runId, { signal: controller.signal });
        if (!active || controller.signal.aborted) return;
        lastStatus = run.status;
        setState({ run, loading: false, error: '', checkedAt: Date.now() });
        if (pending(lastStatus) && !document.hidden) timer = setTimeout(load, 2000);
      } catch (error) {
        if (!active || controller.signal.aborted || error.name === 'AbortError') return;
        if (error.status === 401) expired.current?.();
        lastStatus = null;
        setState((previous) => ({ ...previous, loading: false, error: error.message || 'We could not load this run.' }));
      } finally {
        inFlight = false;
      }
    }

    function onVisibilityChange() {
      clearTimeout(timer);
      if (!document.hidden && pending(lastStatus)) load();
    }

    load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [runId, attempt]);

  return { ...state, run: state.run?.id === runId ? state.run : null, retry: () => setAttempt((value) => value + 1) };
}
