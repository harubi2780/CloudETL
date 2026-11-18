import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import datasetsApi from '../api/datasets';
import etlApi from '../api/etl';
import DataTable from '../components/etl/DataTable';
import Spinner from '../components/etl/Spinner';
import AppliedStepsPanel from '../components/pipeline/AppliedStepsPanel';
import SourceTabs from '../components/pipeline/SourceTabs';
import WorkbookToolbar from '../components/pipeline/WorkbookToolbar';
import { dataType, newStep, schemasFor, sourceIds, validateWorkflow } from '../lib/pipeline/workflow';
import { Link, navigate } from '../navigation';
import './EtlWorkflow.css';
import './Workbook.css';

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
  const [sourcePicker, setSourcePicker] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const pickerHeading = useRef(null);
  const pickerTrigger = useRef(null);
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
  const previewSource = sources.find((source) => source.id === previewId);
  const payload = { schemaVersion: 1, name, datasetId: primaryId, steps: steps.map(({ type, config, enabled }) => ({ type, config, enabled })) };
  const validation = validateWorkflow(payload, sources, caps);
  const change = (callback) => { callback(); setDirty(true); setErrors([]); };

  useEffect(() => { if (sourcePicker) pickerHeading.current?.focus(); }, [sourcePicker]);

  function selectSource(id) {
    setPreviewId(id); setSelectedColumns([]); setSelectedCell(null);
  }

  function selectCell(cell) {
    setSelectedCell(cell);
    if (cell) setSelectedColumns([cell.columnName]);
  }

  function closePicker() {
    setSourcePicker(false); pickerTrigger.current?.focus();
  }

  function addSource(dataset) {
    if (sources.some((source) => source.id === dataset.id)) return;
    if (sources.length >= caps.limits.maxSources || sources.reduce((sum, source) => sum + source.size_bytes, dataset.size_bytes) > caps.limits.maxCombinedInputBytes) {
      setNotice('This source would exceed the file count or combined size limit.'); return;
    }
    change(() => setSources((items) => [...items, { ...dataset, status: 'loading', columns: [] }]));
    if (!primaryId) setPrimaryId(dataset.id);
    selectSource(dataset.id);
    const controller = new AbortController();
    previewRequests.current.set(dataset.id, controller);
    loadPreview(dataset.id, controller.signal);
    setNotice('');
    closePicker();
  }

  function removeSource(id) {
    previewRequests.current.get(id)?.abort();
    const remaining = sources.filter((source) => source.id !== id);
    change(() => setSources(remaining));
    if (primaryId === id) setPrimaryId(remaining[0]?.id || '');
    if (previewId === id) selectSource(remaining[0]?.id || '');
  }

  function addStep(type) {
    const step = withId(newStep(type, schemas.final, sources, primaryId));
    // Header selection configures a repeatable transformation, never source edits.
    const columns = selectedColumns.filter((name) => schemas.final.some((column) => column.name === name));
    const column = columns[0];
    if (column) {
      if (type === 'select_columns') step.config.selectedColumns = columns;
      if (type === 'drop_duplicates') step.config.rules = [{ allColumns: false, columns, keep: 'first' }];
      if (type === 'handle_null') step.config.rules = columns.map((name) => ({ column: name, strategy: 'drop' }));
      if (type === 'string_transform') step.config.rules = columns.map((name) => ({ column: name, trim: true, caseMode: 'none' }));
      if (type === 'cast_type') step.config.conversions = columns.map((name) => ({ column: name, toType: 'string' }));
      if (type === 'filter_rows') step.config.conditions = columns.map((name) => ({ column: name,
        operator: ['integer', 'float'].includes(schemas.final.find((item) => item.name === name)?.type) ? 'greater_than' : 'contains', value: '' }));
      if (['replace_value', 'format_datetime'].includes(type)) step.config.column = column;
      if (type === 'replace_value' && selectedCell?.columnName === column) step.config.oldValue = selectedCell.value ?? '';
      if (type === 'join' && sources.find((source) => source.id === step.config.datasetId)?.columns.some((item) => item.name === column)) step.config.on = column;
    }
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
  return <div className="workbook">
    <h1 className="sr-only">Pipelines</h1>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="workbook-layout">
        <header className="workbook-titlebar">
          <label className="workbook-name">Pipeline name<input value={name} maxLength={120} onChange={(event) => change(() => setName(event.target.value))} /></label>
          <span className="workbook-draft">{dirty ? 'Draft changes' : 'Pipeline workspace'}</span>
          <button ref={pickerTrigger} type="button" className="workbook-source-button" aria-expanded={sourcePicker} aria-controls="source-library" onClick={() => setSourcePicker(!sourcePicker)}>Sources ({sources.length})</button>
          <Link to="/dashboard/datasets" className="workbook-upload-link">Upload files</Link>
          <button className="button button-primary workbook-run" type="submit" aria-describedby="workbook-validation" disabled={busy || validation.length > 0}>{busy && <Spinner />}{busy ? 'Submitting pipeline…' : 'Run pipeline'}</button>
        </header>
        <WorkbookToolbar capabilities={caps} onAddStep={addStep} sourceCount={sources.length} selectedColumns={selectedColumns}
          disabled={!sources.length || sources.some((source) => source.status !== 'ready') || steps.length >= caps.limits.maxSteps} />
        <div className="workbook-body">
          <div className="workbook-center">
            {sourcePicker && <section id="source-library" className="workbook-library" aria-label="Source library" onKeyDown={(event) => { if (event.key === 'Escape') closePicker(); }}>
              <div className="workbook-panel-heading"><h2 ref={pickerHeading} tabIndex={-1}>Add saved datasets</h2><button type="button" onClick={closePicker}>Close source library</button></div>
              <p className="workbook-hint">CSV/TSV · up to {caps.limits.maxSources} files · {(caps.limits.maxCombinedInputBytes / 1048576).toFixed(0)} MiB combined.</p>
              {notice && <p className="workbook-step-errors" role="alert">{notice}</p>}
              {library.status === 'loading' && <p role="status"><Spinner /> Loading saved datasets…</p>}
              {library.status === 'error' && <><p role="alert">{library.error}</p><button type="button" onClick={() => setLibraryAttempt((value) => value + 1)}>Retry dataset list</button></>}
              {library.status === 'ready' && <>
                {!library.data.datasets.length && <p>No saved datasets. <Link to="/dashboard/datasets">Upload files to begin.</Link></p>}
                <ul className="workbook-library-list">{library.data.datasets.map((dataset) => <li key={dataset.id}><div><strong>{dataset.filename}</strong><span>{dataset.format.toUpperCase()} · {(dataset.size_bytes / 1024).toFixed(1)} KiB</span></div>
                  <button type="button" disabled={!caps.inputFormats.includes(dataset.format) || sources.some((source) => source.id === dataset.id)} onClick={() => addSource(dataset)} aria-label={'Add source ' + dataset.filename}>{caps.inputFormats.includes(dataset.format) ? sources.some((source) => source.id === dataset.id) ? 'Selected' : 'Add' : 'Storage only'}</button>
                </li>)}</ul>
                <nav className="workbook-library-pages" aria-label="Saved dataset pages"><button type="button" disabled={libraryPage <= 1} onClick={() => setLibraryPage((page) => page - 1)}>Previous datasets</button><span>Page {library.data.page} of {library.data.total_pages}</span><button type="button" disabled={libraryPage >= library.data.total_pages} onClick={() => setLibraryPage((page) => page + 1)}>Next datasets</button></nav>
              </>}
            </section>}
            <div className="workbook-sheet" id="workbook-sheet" role="tabpanel" aria-labelledby={previewSource ? 'source-tab-' + previewSource.id : undefined} aria-label={previewSource ? undefined : 'Source preview'}>
              {previewSource ? <>
                <div className="workbook-sheet-heading"><h2>Source preview: {previewSource.filename}</h2><div>
                  {primaryId === previewSource.id ? <span className="workbook-start">Starting dataset</span> : <button type="button" onClick={() => change(() => { setPrimaryId(previewSource.id); setSelectedColumns([]); setSelectedCell(null); })}>Use as starting dataset</button>}
                  <button type="button" aria-label={'Remove source ' + previewSource.filename} onClick={() => removeSource(previewSource.id)}>Remove source</button>
                </div></div>
                {previewSource.status === 'loading' && <div className="workbook-empty" role="status"><Spinner />Extracting the first ten rows…</div>}
                {previewSource.status === 'error' && <div className="workbook-empty"><p role="alert">{previewSource.error}</p><button type="button" onClick={() => { const controller = new AbortController(); previewRequests.current.set(previewSource.id, controller); loadPreview(previewSource.id, controller.signal); }}>Retry preview</button></div>}
                {previewSource.status === 'ready' && <DataTable columns={previewSource.preview.columns} rows={previewSource.preview.rows} caption={'Source preview · ' + previewSource.filename}
                  selectionKey={previewSource.id + ':' + primaryId} selectedColumns={selectedColumns} onColumnSelectionChange={setSelectedColumns} onCellSelect={selectCell} disabled={busy} />}
              </> : <div className="workbook-empty"><h2>Start with your data</h2><p>Add a saved file to preview its columns and first ten rows.</p><button type="button" onClick={() => setSourcePicker(true)}>Add source</button><Link to="/dashboard/datasets">Upload new files</Link></div>}
            </div>
            <SourceTabs sources={sources} activeId={previewId} primaryId={primaryId} onSelect={selectSource} onAdd={() => setSourcePicker(true)} />
          </div>
          <AppliedStepsPanel steps={steps} activeId={activeId} schemas={schemas} sources={sources} primaryId={primaryId} capabilities={caps} validation={validation}
            onSelect={setActiveId} onPreviewSource={selectSource} onMove={move}
            onToggle={(id) => change(() => setSteps((items) => items.map((step) => step.id === id ? { ...step, enabled: !step.enabled } : step)))}
            onRemove={(id) => change(() => { setSteps((items) => items.filter((step) => step.id !== id)); if (activeId === id) setActiveId(''); })}
            onChange={(config) => change(() => setSteps((items) => items.map((step) => step.id === activeId ? { ...step, config } : step)))} />
        </div>
        <footer className="workbook-statusbar">
          <span>{previewSource?.status === 'ready' ? 'First ' + previewSource.preview.rows.length + ' of ' + previewSource.preview.final_rows + ' rows · Original data' : 'Source preview'} · {steps.filter((step) => step.enabled).length} enabled steps · One output</span>
          <details className="workbook-info"><summary>Preview details</summary><div>Data shown above is the original source; transformed rows appear after execution. Types are inferred; phone numbers may lose leading zeros and mixed dates may need review. Draft changes stay on this page until submitted.</div></details>
          <div id="workbook-validation">{validation.length ? <details className="workbook-issues"><summary>{validation.length} {validation.length === 1 ? 'issue to resolve' : 'issues to resolve'}</summary><ul>{validation.map((error) => <li key={error}>{error}</li>)}</ul></details> : <span className="workbook-ready">Ready to run</span>}</div>
          {!!errors.length && <div role="alert" className="workbook-submit-error"><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
        </footer>
      </fieldset>
    </form>
  </div>;
}
