import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import datasetsApi from '../api/datasets';
import etlApi from '../api/etl';
import DataTable from '../components/etl/DataTable';
import WorkflowStepConfig from '../components/pipeline/WorkflowStepConfig';
import { dataType, newStep, operations, schemasFor, sourceIds, validateWorkflow } from '../lib/pipeline/workflow';
import { Link, navigate } from '../navigation';
import './EtlWorkflow.css';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let stepSequence = 0;
const withId = (step) => ({ ...step, id: `step-${++stepSequence}` });

export default function PipelinesPage({ search = '', onSessionExpired }) {
  const [caps, setCaps] = useState(null);
  const [boot, setBoot] = useState({ status: 'loading', error: '' });
  const [reload, setReload] = useState(0);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [library, setLibrary] = useState({ status: 'loading', data: null, error: '' });
  const [sources, setSources] = useState([]);
  const [primaryId, setPrimaryId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [name, setName] = useState('Data cleaning pipeline');
  const [steps, setSteps] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [errors, setErrors] = useState([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const submitLock = useRef(false);
  const previewRequests = useRef(new Map());
  const previewVersions = useRef(new Map());
  const mounted = useRef(true);

  const loadPreview = useCallback(async (id, signal) => {
    const version = (previewVersions.current.get(id) || 0) + 1;
    previewVersions.current.set(id, version);
    setSources((items) => items.map((item) => item.id === id ? { ...item, status: 'loading', error: '' } : item));
    try {
      const { preview } = await etlApi.preview(id, { signal });
      if (!mounted.current || signal.aborted || previewVersions.current.get(id) !== version) return;
      setSources((items) => items.map((item) => item.id === id ? {
        ...item, status: 'ready', preview, columns: preview.columns.map((column) => ({ ...column, type: dataType(column.type) })),
      } : item));
    } catch (error) {
      if (!mounted.current || signal.aborted || previewVersions.current.get(id) !== version) return;
      if (error.status === 401) onSessionExpired?.();
      setSources((items) => items.map((item) => item.id === id ? { ...item, status: 'error', error: error.message } : item));
    }
  }, [onSessionExpired]);

  useEffect(() => {
    mounted.current = true;
    const requests = previewRequests.current;
    return () => { mounted.current = false; requests.forEach((request) => request.abort()); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setBoot({ status: 'loading', error: '' });
    async function initialize() {
      try {
        const capabilities = await etlApi.capabilities({ signal });
        if (signal.aborted) return;
        setCaps(capabilities);
        const params = new URLSearchParams(search);
        let ids = [...new Set((params.get('datasets') || '').split(',').filter(Boolean))];
        let configuration;
        if (params.has('run')) {
          if (!uuid.test(params.get('run'))) throw new Error('Choose a valid run to reuse.');
          const response = await etlApi.getRun(params.get('run'), { signal });
          configuration = response.run.configuration;
          ids = sourceIds(configuration, true);
        }
        if (ids.some((id) => !uuid.test(id)) || ids.length > capabilities.limits.maxSources) throw new Error('Choose valid datasets within the source limit.');
        const metadata = await Promise.all(ids.map(async (id) => {
          try {
            const { dataset } = await etlApi.dataset(id, { signal });
            return { ...dataset, status: 'loading', columns: [] };
          } catch (error) {
            if (error.status === 401 || signal.aborted) throw error;
            return { id, filename: `Unavailable source (${id})`, size_bytes: 0, format: '', status: 'error', columns: [], error: error.message };
          }
        }));
        if (signal.aborted) return;
        setSources(metadata);
        setPrimaryId(configuration?.datasetId || ids[0] || '');
        setPreviewId(configuration?.datasetId || ids[0] || '');
        setName(configuration?.name || 'Data cleaning pipeline');
        const restored = (configuration?.steps || []).map(withId);
        setSteps(restored);
        setActiveId(restored[0]?.id || '');
        setDirty(false);
        setBoot({ status: 'ready', error: '' });
        metadata.filter((item) => item.format).forEach((item) => loadPreview(item.id, signal));
      } catch (error) {
        if (signal.aborted) return;
        if (error.status === 401) onSessionExpired?.();
        setBoot({ status: 'error', error: error.message || 'Could not load the pipeline.' });
      }
    }
    initialize();
    return () => controller.abort();
  }, [search, reload, onSessionExpired, loadPreview]);

  useEffect(() => {
    const controller = new AbortController();
    setLibrary((previous) => ({ ...previous, status: 'loading', error: '' }));
    datasetsApi.list(libraryPage, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setLibrary({ status: 'ready', data, error: '' });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error.status === 401) onSessionExpired?.();
      setLibrary({ status: 'error', data: null, error: error.message });
    });
    return () => controller.abort();
  }, [libraryPage, libraryAttempt, onSessionExpired]);

  useEffect(() => {
    const warn = (event) => { if (dirty && !submitLock.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const schemas = useMemo(() => schemasFor(primaryId, steps, sources), [primaryId, steps, sources]);
  const activeIndex = steps.findIndex((step) => step.id === activeId);
  const activeStep = steps[activeIndex];
  const previewSource = sources.find((source) => source.id === previewId);
  const payload = { schemaVersion: 1, name, datasetId: primaryId, steps: steps.map(({ type, config, enabled }) => ({ type, config, enabled })) };
  const validation = validateWorkflow(payload, sources, caps);
  const change = (callback) => { callback(); setDirty(true); setErrors([]); };

  function addSource(dataset) {
    if (sources.some((source) => source.id === dataset.id)) return;
    if (sources.length >= caps.limits.maxSources || sources.reduce((sum, source) => sum + source.size_bytes, dataset.size_bytes) > caps.limits.maxCombinedInputBytes) {
      setNotice('This source would exceed the file count or combined size limit.'); return;
    }
    change(() => setSources((items) => [...items, { ...dataset, status: 'loading', columns: [] }]));
    if (!primaryId) setPrimaryId(dataset.id);
    setPreviewId(dataset.id);
    const controller = new AbortController();
    previewRequests.current.set(dataset.id, controller);
    loadPreview(dataset.id, controller.signal);
    setNotice('');
  }

  function removeSource(id) {
    previewRequests.current.get(id)?.abort();
    const remaining = sources.filter((source) => source.id !== id);
    change(() => setSources(remaining));
    if (primaryId === id) setPrimaryId(remaining[0]?.id || '');
    if (previewId === id) setPreviewId(remaining[0]?.id || '');
  }

  function addStep(type) {
    const step = withId(newStep(type, schemas.final, sources, primaryId));
    change(() => setSteps((items) => [...items, step]));
    setActiveId(step.id);
  }

  function move(index, delta) {
    change(() => setSteps((items) => {
      const result = [...items];
      [result[index], result[index + delta]] = [result[index + delta], result[index]];
      return result;
    }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitLock.current) return;
    if (validation.length) { setErrors(validation); return; }
    submitLock.current = true;
    setBusy(true); setErrors([]);
    try {
      const { run } = await etlApi.submit(payload);
      if (!mounted.current) return;
      setDirty(false);
      navigate(`/dashboard/runs/${run.id}`);
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401) onSessionExpired?.();
      setErrors([error.message, ...Object.entries(error.fields || {}).map(([key, values]) => `${key}: ${[].concat(values).join(' ')}`)]);
    } finally {
      submitLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (boot.status === 'loading') return <div className="etl-page"><h1>Pipelines</h1><p role="status">Loading pipeline tools…</p></div>;
  if (boot.status === 'error') return <div className="etl-page"><h1>Pipelines</h1><p role="alert">{boot.error}</p><button className="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>;
  return <div className="etl-page">
    <div className="etl-inline"><div><h1>Pipelines</h1><p>Choose sources, configure ordered steps, and run one output dataset.</p></div><Link className="button button-secondary" to="/dashboard/datasets">Upload files</Link></div>
    <p className="etl-muted">Draft changes stay on this page until submitted. Completed runs keep their configuration for reuse.</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="etl-fieldset">
        <label className="etl-field">Pipeline name<input value={name} maxLength={120} onChange={(event) => change(() => setName(event.target.value))} /></label>
        <section aria-labelledby="sources-title" className="etl-section"><h2 id="sources-title">1. Sources and extraction</h2>
          <p>CSV/TSV only. Up to {caps.limits.maxSources} files and {(caps.limits.maxCombinedInputBytes / 1048576).toFixed(0)} MiB combined. Original files stay saved.</p>
          {notice && <p role="alert">{notice}</p>}
          <ul className="etl-source-list">{sources.map((source) => <li key={source.id}>
            <button type="button" aria-pressed={previewId === source.id} onClick={() => setPreviewId(source.id)}>{source.filename}</button>
            <label><input type="radio" name="primary" checked={primaryId === source.id} onChange={() => change(() => setPrimaryId(source.id))} /> Starting dataset</label>
            <span>{source.status === 'ready' ? `${source.preview.final_rows} rows` : source.status === 'loading' ? 'Loading preview…' : 'Preview unavailable'}</span>
            <button type="button" onClick={() => removeSource(source.id)} aria-label={`Remove source ${source.filename}`}>Remove</button>
          </li>)}</ul>
          <details><summary>Add saved datasets</summary>
            {library.status === 'loading' && <p role="status">Loading saved datasets…</p>}
            {library.status === 'error' && <><p role="alert">{library.error}</p><button type="button" onClick={() => setLibraryAttempt((value) => value + 1)}>Retry dataset list</button></>}
            {library.status === 'ready' && <>
              {!library.data.datasets.length && <p>No saved datasets. Upload files to begin.</p>}
              <ul className="etl-source-list">{library.data.datasets.map((dataset) => <li key={dataset.id}><span>{dataset.filename} ({dataset.format.toUpperCase()})</span>
                <button type="button" disabled={!caps.inputFormats.includes(dataset.format) || sources.some((source) => source.id === dataset.id)} onClick={() => addSource(dataset)} aria-label={`Add source ${dataset.filename}`}>{caps.inputFormats.includes(dataset.format) ? sources.some((source) => source.id === dataset.id) ? 'Selected' : 'Add' : 'Storage only'}</button>
              </li>)}</ul>
              <div className="etl-inline"><button type="button" disabled={libraryPage <= 1} onClick={() => setLibraryPage((page) => page - 1)}>Previous datasets</button><span>Page {library.data.page} of {library.data.total_pages}</span><button type="button" disabled={libraryPage >= library.data.total_pages} onClick={() => setLibraryPage((page) => page + 1)}>Next datasets</button></div>
            </>}
          </details>
          {previewSource && <div className="etl-section"><h3>Source preview: {previewSource.filename}</h3>
            {previewSource.status === 'loading' && <p role="status">Extracting the first ten rows…</p>}
            {previewSource.status === 'error' && <><p role="alert">{previewSource.error}</p><button type="button" onClick={() => { const controller = new AbortController(); previewRequests.current.set(previewSource.id, controller); loadPreview(previewSource.id, controller.signal); }}>Retry preview</button></>}
            {previewSource.status === 'ready' && <><p className="etl-muted">First {previewSource.preview.rows.length} of {previewSource.preview.final_rows} rows. Types are inferred; phone numbers may lose leading zeros and mixed dates may need review.</p><DataTable columns={previewSource.preview.columns} rows={previewSource.preview.rows} caption={`Source preview · ${previewSource.filename}`} /></>}
          </div>}
        </section>
        <section className="etl-section" aria-labelledby="transform-title"><h2 id="transform-title">2. Transform and combine</h2><p>Steps run from top to bottom. Data shown above is the original source; transformed rows appear after execution.</p>
          <label className="etl-field">Add operation<select value="" disabled={!sources.length || sources.some((source) => source.status !== 'ready') || steps.length >= caps.limits.maxSteps} onChange={(event) => addStep(event.target.value)}><option value="">Choose an operation</option>{operations.filter((operation) => caps.operations[operation.type]).map((operation) => <option key={operation.type} value={operation.type} disabled={['join', 'concat'].includes(operation.type) && sources.length < 2}>{operation.label}</option>)}</select></label>
          <div className="etl-builder"><ol className="etl-steps">{steps.map((step, index) => <li key={step.id}>
            <button type="button" aria-pressed={activeId === step.id} onClick={() => setActiveId(step.id)}>{index + 1}. {operations.find((operation) => operation.type === step.type)?.label || step.type}</button>
            <div className="etl-inline"><label><input type="checkbox" checked={step.enabled} onChange={() => change(() => setSteps((items) => items.map((item) => item.id === step.id ? { ...item, enabled: !item.enabled } : item)))} /> Enable step {index + 1}</label>
              <button type="button" disabled={index === 0} aria-label={`Move step ${index + 1} up`} onClick={() => move(index, -1)}>Up</button><button type="button" disabled={index === steps.length - 1} aria-label={`Move step ${index + 1} down`} onClick={() => move(index, 1)}>Down</button>
              <button type="button" aria-label={`Remove step ${index + 1}`} onClick={() => change(() => { setSteps((items) => items.filter((item) => item.id !== step.id)); if (activeId === step.id) setActiveId(''); })}>Remove</button></div>
          </li>)}</ol><div>
            {activeStep ? <><h3>Configure step {activeIndex + 1}</h3><WorkflowStepConfig step={activeStep} columns={schemas.before[activeIndex]} sources={sources} primaryId={primaryId} capabilities={caps} onPreviewSource={setPreviewId} onChange={(config) => change(() => setSteps((items) => items.map((item) => item.id === activeId ? { ...item, config } : item)))} /></> : <p>Select a step to configure it. No steps means save the extracted data as one result.</p>}
          </div></div>
        </section>
        <section className="etl-section" aria-labelledby="review-title"><h2 id="review-title">3. Review and run</h2><p>{sources.length} selected source(s), {steps.filter((step) => step.enabled).length} enabled step(s), one output dataset.</p>
          {validation.length > 0 && <div className="etl-muted"><p>Before running:</p><ul>{validation.map((error) => <li key={error}>{error}</li>)}</ul></div>}
          {!!errors.length && <div role="alert"><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
          <button className="button button-primary" type="submit" disabled={busy || validation.length > 0}>{busy ? 'Submitting pipeline…' : 'Run pipeline'}</button>
        </section>
      </fieldset>
    </form>
  </div>;
}
