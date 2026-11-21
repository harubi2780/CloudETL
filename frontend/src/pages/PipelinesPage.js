import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import datasetsApi from '../api/datasets';
import etlApi from '../api/etl';
import DataTable from '../components/etl/DataTable';
import Spinner from '../components/etl/Spinner';
import AppliedStepsPanel from '../components/pipeline/AppliedStepsPanel';
import SourceTabs from '../components/pipeline/SourceTabs';
import WorkbookToolbar from '../components/pipeline/WorkbookToolbar';
import { clearPipelineDraft, loadPipelineDraft, savePipelineDraft } from '../lib/pipeline/draftStorage';
import { combinedSourceIds, dataType, defaultOperatorForType, newStep, schemasFor, sourceIds, validateWorkflow } from '../lib/pipeline/workflow';
import { Link, navigate } from '../navigation';
import './EtlWorkflow.css';
import './Workbook.css';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let stepSequence = 0;
const withId = (step) => ({ ...step, id: `step-${++stepSequence}` });

export default function PipelinesPage({ search = '', user = null, onSessionExpired }) {
  const userId = user?.id ?? null;
  const [caps, setCaps] = useState(null);
  const [boot, setBoot] = useState({ status: 'loading', error: '' });
  const [reload, setReload] = useState(0);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [library, setLibrary] = useState({ status: 'loading', data: null, error: '' });
  const [sources, setSources] = useState([]);
  const [primaryId, setPrimaryId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [focusId, setFocusId] = useState('');
  const [splitView, setSplitView] = useState(false);
  const [name, setName] = useState('Data cleaning pipeline');
  const [steps, setSteps] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [errors, setErrors] = useState([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedPipelineId, setSavedPipelineId] = useState('');
  const [savedDrawer, setSavedDrawer] = useState(false);
  const [savedPage, setSavedPage] = useState(1);
  const [savedAttempt, setSavedAttempt] = useState(0);
  const [savedList, setSavedList] = useState({ status: 'idle', data: null, error: '' });
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [sourcePicker, setSourcePicker] = useState(false);
  const [librarySelected, setLibrarySelected] = useState({});
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const pickerHeading = useRef(null);
  const pickerTrigger = useRef(null);
  const savedHeading = useRef(null);
  const savedTrigger = useRef(null);
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
        let savedId = '';
        let restoredPreviewId = '';
        let restoredCompareId = '';
        let restoredSplitView = false;
        let restoredDirty = false;
        if (params.has('pipeline')) {
          if (!uuid.test(params.get('pipeline'))) throw new Error('Choose a valid saved pipeline.');
          const response = await etlApi.getPipeline(params.get('pipeline'), { signal });
          savedId = response.pipeline.id;
          configuration = response.pipeline.configuration;
          ids = sourceIds(configuration, true);
        } else if (params.has('run')) {
          if (!uuid.test(params.get('run'))) throw new Error('Choose a valid run to reuse.');
          const response = await etlApi.getRun(params.get('run'), { signal });
          configuration = response.run.configuration;
          ids = sourceIds(configuration, true);
        } else if (!params.has('datasets')) {
          const draft = loadPipelineDraft(userId);
          if (draft && Array.isArray(draft.sourceIds)
              && draft.sourceIds.every((id) => uuid.test(id))
              && draft.sourceIds.length <= capabilities.limits.maxSources) {
            ids = [...new Set(draft.sourceIds)];
            configuration = {
              name: typeof draft.name === 'string' && draft.name ? draft.name : 'Data cleaning pipeline',
              datasetId: uuid.test(draft.primaryId || '') ? draft.primaryId : (ids[0] || ''),
              steps: Array.isArray(draft.steps) ? draft.steps : [],
            };
            savedId = uuid.test(draft.savedPipelineId || '') ? draft.savedPipelineId : '';
            restoredPreviewId = uuid.test(draft.previewId || '') ? draft.previewId : '';
            restoredCompareId = uuid.test(draft.compareId || '') ? draft.compareId : '';
            restoredSplitView = Boolean(draft.splitView);
            restoredDirty = Boolean(draft.dirty);
          }
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
        const initialPrimary = (configuration?.datasetId && ids.includes(configuration.datasetId)) ? configuration.datasetId : (ids[0] || '');
        const initialPreview = (restoredPreviewId && ids.includes(restoredPreviewId)) ? restoredPreviewId : initialPrimary;
        const initialCompare = (restoredCompareId && ids.includes(restoredCompareId) && restoredCompareId !== initialPreview)
          ? restoredCompareId : (ids.find((id) => id !== initialPreview) || '');
        setSources(metadata);
        setPrimaryId(initialPrimary);
        setPreviewId(initialPreview);
        setFocusId(initialPreview);
        setCompareId(initialCompare);
        setSplitView(restoredSplitView && ids.length >= 2);
        setName(configuration?.name || 'Data cleaning pipeline');
        const restored = (configuration?.steps || []).map(withId);
        setSteps(restored);
        setActiveId(restored[0]?.id || '');
        setSavedPipelineId(savedId);
        setSaveNotice('');
        setDirty(restoredDirty);
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
  }, [search, reload, userId, onSessionExpired, loadPreview]);

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
    if (!savedDrawer) return undefined;
    const controller = new AbortController();
    setSavedList((previous) => ({ ...previous, status: 'loading', error: '' }));
    etlApi.listPipelines({ page: savedPage, signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setSavedList({ status: 'ready', data, error: '' });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      if (error.status === 401) onSessionExpired?.();
      setSavedList((previous) => ({ ...previous, status: 'error', error: error.message }));
    });
    return () => controller.abort();
  }, [savedDrawer, savedPage, savedAttempt, onSessionExpired]);

  useEffect(() => {
    const warn = (event) => { if (dirty && !submitLock.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const schemas = useMemo(() => schemasFor(primaryId, steps, sources), [primaryId, steps, sources]);
  const previewSource = sources.find((source) => source.id === previewId) || sources[0] || null;
  const effectiveCompareSource = sources.find((source) => source.id === compareId && source.id !== previewSource?.id)
    || sources.find((source) => source.id !== previewSource?.id) || null;
  const effectiveCompareId = effectiveCompareSource?.id || '';
  const isSplitActive = splitView && sources.length >= 2 && Boolean(previewSource && effectiveCompareSource);
  const activeTargetId = isSplitActive && focusId === effectiveCompareId ? effectiveCompareId : (previewSource?.id || primaryId);
  const activeSource = sources.find((source) => source.id === activeTargetId) || previewSource;
  const activeColumns = (activeTargetId && schemas.bySource[activeTargetId]) || activeSource?.columns || [];
  const hasDateColumns = activeColumns.some((col) => dataType(col.type) === 'datetime');
  const payload = {
    schemaVersion: 1,
    name,
    datasetId: primaryId,
    steps: steps.map(({ type, config, enabled, sourceId }) => (
      sourceId && sourceId !== primaryId && !['join', 'concat'].includes(type)
        ? { type, config, enabled, sourceId }
        : { type, config, enabled }
    )),
  };
  const combinedIds = useMemo(() => combinedSourceIds({ datasetId: primaryId, steps }), [primaryId, steps]);
  const validation = validateWorkflow(payload, sources, caps);
  const change = (callback) => { callback(); setDirty(true); setErrors([]); setSaveNotice(''); };

  useEffect(() => {
    if (boot.status !== 'ready') return;
    const hasContent = sources.length > 0 || steps.length > 0 || Boolean(savedPipelineId) || dirty;
    if (!hasContent) {
      clearPipelineDraft(userId);
      return;
    }
    savePipelineDraft(userId, {
      name,
      sourceIds: sources.map((source) => source.id),
      primaryId,
      previewId: previewSource?.id || '',
      compareId: effectiveCompareId,
      splitView: isSplitActive,
      steps: steps.map(({ type, config, enabled, sourceId }) => (
        sourceId ? { type, config, enabled, sourceId } : { type, config, enabled }
      )),
      savedPipelineId,
      dirty,
    });
  }, [boot.status, userId, name, sources, primaryId, previewSource, effectiveCompareId, isSplitActive, steps, savedPipelineId, dirty]);

  useEffect(() => { if (sourcePicker) pickerHeading.current?.focus(); }, [sourcePicker]);
  useEffect(() => { if (savedDrawer) savedHeading.current?.focus(); }, [savedDrawer]);

  function selectSource(id) {
    if (isSplitActive && id === effectiveCompareId) {
      setFocusId(id);
    } else if (isSplitActive && focusId === effectiveCompareId && id !== previewSource?.id) {
      setCompareId(id);
      setFocusId(id);
    } else {
      setPreviewId(id);
      setFocusId(id);
    }
    setSelectedColumns([]); setSelectedCell(null);
  }

  function selectCellForSource(sourceId, cell) {
    if (cell) {
      setFocusId(sourceId);
      setSelectedCell(cell);
      setSelectedColumns([cell.columnName]);
    } else if (sourceId === activeTargetId) {
      setSelectedCell(null);
    }
  }

  function closePicker() {
    setSourcePicker(false); setLibrarySelected({}); pickerTrigger.current?.focus();
  }

  function closeSavedDrawer() {
    setSavedDrawer(false); savedTrigger.current?.focus();
  }

  function addSourcesBatch(datasetsToAdd) {
    const additions = datasetsToAdd.filter((dataset) => !sources.some((source) => source.id === dataset.id));
    if (!additions.length) return false;
    const totalCount = sources.length + additions.length;
    const totalBytes = sources.reduce((sum, source) => sum + source.size_bytes, 0)
      + additions.reduce((sum, dataset) => sum + dataset.size_bytes, 0);
    if (totalCount > caps.limits.maxSources || totalBytes > caps.limits.maxCombinedInputBytes) {
      setNotice('This selection would exceed the file count or combined size limit.');
      return false;
    }
    change(() => setSources((items) => [...items, ...additions.map((dataset) => ({ ...dataset, status: 'loading', columns: [] }))]));
    if (!primaryId) setPrimaryId(additions[0].id);
    if (!previewSource) {
      setPreviewId(additions[0].id);
      setFocusId(additions[0].id);
    } else if (!effectiveCompareId) {
      setCompareId(additions[0].id);
    }
    if (sources.length === 0 || !isSplitActive) {
      setPreviewId(additions[0].id);
      setFocusId(additions[0].id);
    }
    setSelectedColumns([]); setSelectedCell(null);
    for (const dataset of additions) {
      const controller = new AbortController();
      previewRequests.current.set(dataset.id, controller);
      loadPreview(dataset.id, controller.signal);
    }
    setNotice('');
    closePicker();
    return true;
  }

  function addSource(dataset) {
    addSourcesBatch([dataset]);
  }

  function toggleLibrarySelect(dataset) {
    setNotice('');
    setLibrarySelected((previous) => {
      const next = { ...previous };
      if (next[dataset.id]) delete next[dataset.id];
      else next[dataset.id] = dataset;
      return next;
    });
  }

  function removeSource(id) {
    previewRequests.current.get(id)?.abort();
    const remaining = sources.filter((source) => source.id !== id);
    change(() => setSources(remaining));
    if (primaryId === id) setPrimaryId(remaining[0]?.id || '');
    if (previewId === id) {
      setPreviewId(remaining[0]?.id || '');
      setFocusId(remaining[0]?.id || '');
    }
    if (compareId === id) setCompareId(remaining.find((item) => item.id !== previewId)?.id || '');
    if (remaining.length < 2) setSplitView(false);
  }

  function addStep(type, overrides = null) {
    const isCombine = ['join', 'concat'].includes(type);
    const targetId = !isCombine && activeTargetId && activeTargetId !== primaryId ? activeTargetId : primaryId;
    const targetColumns = schemas.bySource[targetId] || [];
    const workingSources = sources.map((source) => ({ ...source, columns: schemas.bySource[source.id] || source.columns || [] }));
    const step = withId(newStep(type, targetColumns, workingSources, primaryId));
    if (!isCombine && targetId && targetId !== primaryId) step.sourceId = targetId;
    if (overrides) {
      step.config = { ...step.config, ...overrides };
    } else {
      if (type === 'join') {
        const preferredRight = (activeTargetId && activeTargetId !== primaryId)
          ? activeTargetId
          : (isSplitActive && effectiveCompareId && effectiveCompareId !== primaryId ? effectiveCompareId : '');
        if (preferredRight) {
          const rightCols = schemas.bySource[preferredRight] || [];
          const shared = (schemas.final || []).find((col) => rightCols.some((r) => r.name === col.name))?.name || '';
          step.config = { datasetId: preferredRight, on: shared, how: 'left' };
        }
      }
      // Header selection configures a repeatable transformation, never source edits.
      const columns = selectedColumns.filter((name) => targetColumns.some((column) => column.name === name));
      const column = columns[0];
      if (column) {
        if (type === 'select_columns') step.config.selectedColumns = columns;
        if (type === 'merge_columns' && columns.length >= 2) step.config.columns = columns;
        if (type === 'drop_duplicates') step.config.rules = [{ allColumns: false, columns, keep: 'first' }];
        if (type === 'handle_null') step.config.rules = columns.map((name) => ({ column: name, strategy: 'drop' }));
        if (type === 'string_transform') step.config.rules = columns.map((name) => ({ column: name, trim: true, caseMode: 'none' }));
        if (type === 'cast_type') step.config.conversions = columns.map((name) => ({ column: name, toType: 'str' }));
        if (type === 'filter_rows') {
          step.config.conditions = columns.map((name) => {
            const col = targetColumns.find((item) => item.name === name);
            const operator = defaultOperatorForType(col?.type, caps);
            return { column: name, operator, value: ['is_true', 'is_false'].includes(operator) ? null : '' };
          });
        }
        if (type === 'replace_value') step.config.column = column;
        if (type === 'format_datetime' && dataType(targetColumns.find((item) => item.name === column)?.type) === 'datetime') step.config.column = column;
        if (type === 'replace_value' && selectedCell?.columnName === column) step.config.oldValue = selectedCell.value ?? '';
        if (type === 'join' && workingSources.find((source) => source.id === step.config.datasetId)?.columns.some((item) => item.name === column)) step.config.on = column;
      }
    }
    change(() => setSteps((items) => [...items, step]));
    setActiveId(step.id);
  }

  function quickCombine(kind, targetId) {
    if (kind === 'join') {
      const rightCols = schemas.bySource[targetId] || [];
      const shared = (schemas.final || []).find((col) => rightCols.some((r) => r.name === col.name))?.name || '';
      addStep('join', { datasetId: targetId, on: shared, how: 'left' });
    } else {
      addStep('concat', { datasetIds: [targetId] });
    }
  }

  function changeStepSource(stepId, nextSourceId) {
    change(() => setSteps((items) => items.map((step) => {
      if (step.id !== stepId) return step;
      if (nextSourceId) return { ...step, sourceId: nextSourceId };
      const { sourceId, ...rest } = step;
      return rest;
    })));
  }

  async function savePipeline(asNew = false) {
    if (busy || saveBusy || !primaryId || !name.trim()) return;
    setSaveBusy(true);
    setErrors([]);
    setSaveNotice('');
    try {
      const response = savedPipelineId && !asNew
        ? await etlApi.updatePipeline(savedPipelineId, payload)
        : await etlApi.createPipeline(payload);
      if (!mounted.current) return;
      setSavedPipelineId(response.pipeline.id);
      setDirty(false);
      setSaveNotice(`Saved "${response.pipeline.name}".`);
      if (savedDrawer) setSavedAttempt((value) => value + 1);
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401) onSessionExpired?.();
      setErrors([error.message, ...Object.entries(error.fields || {}).map(([key, values]) => `${key}: ${[].concat(values).join(' ')}`)]);
    } finally {
      if (mounted.current) setSaveBusy(false);
    }
  }

  async function removeSavedPipeline(id) {
    setSaveBusy(true);
    try {
      await etlApi.deletePipeline(id);
      if (!mounted.current) return;
      if (savedPipelineId === id) setSavedPipelineId('');
      setSavedAttempt((value) => value + 1);
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401) onSessionExpired?.();
      setSavedList((previous) => ({ ...previous, error: error.message }));
    } finally {
      if (mounted.current) setSaveBusy(false);
    }
  }

  function move(index, delta) {
    change(() => setSteps((items) => {
      const result = [...items];
      [result[index], result[index + delta]] = [result[index + delta], result[index]];
      return result;
    }));
  }

  function resetDraft() {
    previewRequests.current.forEach((request) => request.abort());
    previewRequests.current.clear();
    setSources([]);
    setPrimaryId('');
    setPreviewId('');
    setCompareId('');
    setFocusId('');
    setSplitView(false);
    setName('Data cleaning pipeline');
    setSteps([]);
    setActiveId('');
    setSavedPipelineId('');
    setDirty(false);
    setErrors([]);
    setNotice('');
    setSaveNotice('');
    setSelectedColumns([]);
    setSelectedCell(null);
    clearPipelineDraft(userId);
    if (search) navigate('/dashboard/pipelines', { replace: true });
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
      clearPipelineDraft(userId);
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

  function renderSheetPane(source, side) {
    const isFocused = !isSplitActive || activeTargetId === source.id;
    const compareChoices = sources.filter((item) => item.id !== previewSource?.id);
    return <div key={`${side}-${source.id}`} className={`workbook-pane${isSplitActive && isFocused ? ' is-focused-pane' : ''}`}
      onClick={() => setFocusId(source.id)}>
      <div className="workbook-sheet-heading">
        <div className="workbook-pane-title">
          <h2>Source preview: {source.filename}</h2>
          {side === 'right' && compareChoices.length > 1 && (
            <select aria-label="Compare dataset" value={source.id} onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                setCompareId(event.target.value);
                setFocusId(event.target.value);
                setSelectedColumns([]);
                setSelectedCell(null);
              }}>
              {compareChoices.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
            </select>
          )}
        </div>
        <div>
          {primaryId === source.id ? <span className="workbook-start">Starting dataset</span> : <>
            <button type="button" onClick={(event) => { event.stopPropagation(); change(() => { setPrimaryId(source.id); setSelectedColumns([]); setSelectedCell(null); }); }}>Use as starting dataset</button>
            {caps.operations.join && <button type="button" disabled={busy || source.status !== 'ready' || steps.length >= caps.limits.maxSteps} onClick={(event) => { event.stopPropagation(); quickCombine('join', source.id); }}>Join into start</button>}
            {caps.operations.concat && <button type="button" disabled={busy || source.status !== 'ready' || steps.length >= caps.limits.maxSteps} onClick={(event) => { event.stopPropagation(); quickCombine('concat', source.id); }}>Append to start</button>}
          </>}
          <button type="button" aria-label={'Remove source ' + source.filename} onClick={(event) => { event.stopPropagation(); removeSource(source.id); }}>Remove source</button>
        </div>
      </div>
      {source.status === 'loading' && <div className="workbook-empty" role="status"><Spinner />Extracting the first ten rows…</div>}
      {source.status === 'error' && <div className="workbook-empty"><p role="alert">{source.error}</p><button type="button" onClick={() => { const controller = new AbortController(); previewRequests.current.set(source.id, controller); loadPreview(source.id, controller.signal); }}>Retry preview</button></div>}
      {source.status === 'ready' && <DataTable columns={source.preview.columns} rows={source.preview.rows} caption={'Source preview · ' + source.filename}
        selectionKey={source.id + ':' + primaryId} selectedColumns={isFocused ? selectedColumns : []}
        onColumnSelectionChange={(cols) => { setFocusId(source.id); setSelectedColumns(cols); }}
        onCellSelect={(cell) => selectCellForSource(source.id, cell)} disabled={busy} />}
    </div>;
  }

  if (boot.status === 'loading') return <div className="etl-page"><h1>Pipelines</h1><p role="status">Loading pipeline tools…</p></div>;
  if (boot.status === 'error') return <div className="etl-page"><h1>Pipelines</h1><p role="alert">{boot.error}</p><button className="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>;
  const hasDraft = sources.length > 0 || steps.length > 0 || Boolean(savedPipelineId) || dirty;
  return <div className="workbook">
    <h1 className="sr-only">Pipelines</h1>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="workbook-layout">
        <header className="workbook-titlebar">
          <label className="workbook-name">Pipeline name<input value={name} maxLength={120} onChange={(event) => change(() => setName(event.target.value))} /></label>
          <span className="workbook-draft">{saveNotice || (dirty ? 'Draft changes' : savedPipelineId ? 'Saved pipeline' : 'Pipeline workspace')}</span>
          <button ref={savedTrigger} type="button" className="workbook-source-button" aria-expanded={savedDrawer} aria-controls="saved-pipelines" onClick={() => { setSavedDrawer(!savedDrawer); setSourcePicker(false); }}>Saved</button>
          <button type="button" className="workbook-save-button" disabled={busy || saveBusy || !primaryId || !name.trim()} onClick={() => savePipeline(false)}>
            {saveBusy ? 'Saving…' : savedPipelineId ? 'Save' : 'Save pipeline'}
          </button>
          {savedPipelineId && <button type="button" className="workbook-save-button" disabled={busy || saveBusy || !primaryId || !name.trim()} onClick={() => savePipeline(true)}>Save as new</button>}
          <button type="button" className="workbook-save-button" disabled={busy || saveBusy || !hasDraft} onClick={resetDraft}>New draft</button>
          <button ref={pickerTrigger} type="button" className="workbook-source-button" aria-expanded={sourcePicker} aria-controls="source-library" onClick={() => { setSourcePicker(!sourcePicker); setSavedDrawer(false); }}>Sources ({sources.length})</button>
          <Link to="/dashboard/datasets" className="workbook-upload-link">Upload files</Link>
          <button className="button button-primary workbook-run" type="submit" aria-describedby="workbook-validation" disabled={busy || saveBusy || validation.length > 0}>{busy && <Spinner />}{busy ? 'Submitting pipeline…' : 'Run pipeline'}</button>
        </header>
        <WorkbookToolbar capabilities={caps} onAddStep={addStep} sourceCount={sources.length} selectedColumns={selectedColumns}
          hasDateColumns={hasDateColumns} columns={activeColumns}
          disabled={!sources.length || sources.some((source) => source.status !== 'ready') || steps.length >= caps.limits.maxSteps} />
        <div className="workbook-body">
          <div className="workbook-center">
            {sources.length > 0 && (
              <SourceTabs sources={sources} activeId={activeTargetId} primaryId={primaryId} combinedIds={combinedIds}
                splitView={isSplitActive} canSplit={sources.length >= 2} onToggleSplit={() => setSplitView((value) => !value)}
                onSelect={selectSource} onAdd={() => setSourcePicker(true)} />
            )}
            {savedDrawer && <section id="saved-pipelines" className="workbook-library" aria-label="Saved pipelines" onKeyDown={(event) => { if (event.key === 'Escape') closeSavedDrawer(); }}>
              <div className="workbook-panel-heading"><h2 ref={savedHeading} tabIndex={-1}>Saved pipelines</h2><button type="button" onClick={closeSavedDrawer}>Close saved pipelines</button></div>
              {savedList.status === 'loading' && <p role="status"><Spinner /> Loading saved pipelines…</p>}
              {savedList.status === 'error' && <><p role="alert">{savedList.error}</p><button type="button" onClick={() => setSavedAttempt((value) => value + 1)}>Retry saved pipelines</button></>}
              {savedList.status === 'ready' && <>
                {!savedList.data.pipelines.length && <p className="workbook-hint">No saved pipelines yet. Save your current pipeline to reuse it later.</p>}
                <ul className="workbook-library-list">{savedList.data.pipelines.map((item) => <li key={item.id}>
                  <div><strong>{item.name}</strong><span>{item.source_count} {item.source_count === 1 ? 'source' : 'sources'} · {item.step_count} {item.step_count === 1 ? 'step' : 'steps'}</span></div>
                  <div className="workbook-library-actions">
                    <button type="button" onClick={() => { closeSavedDrawer(); navigate(`/dashboard/pipelines?pipeline=${item.id}`); }}>Open</button>
                    <button type="button" disabled={saveBusy} aria-label={'Delete saved pipeline ' + item.name} onClick={() => removeSavedPipeline(item.id)}>Delete</button>
                  </div>
                </li>)}</ul>
                <nav className="workbook-library-pages" aria-label="Saved pipeline pages"><button type="button" disabled={savedPage <= 1} onClick={() => setSavedPage((page) => page - 1)}>Previous pipelines</button><span>Page {savedList.data.page} of {savedList.data.total_pages}</span><button type="button" disabled={savedPage >= savedList.data.total_pages} onClick={() => setSavedPage((page) => page + 1)}>Next pipelines</button></nav>
              </>}
            </section>}
            {sourcePicker && <section id="source-library" className="workbook-library" aria-label="Source library" onKeyDown={(event) => { if (event.key === 'Escape') closePicker(); }}>
              <div className="workbook-panel-heading"><h2 ref={pickerHeading} tabIndex={-1}>Add saved datasets</h2><button type="button" onClick={closePicker}>Close source library</button></div>
              <p className="workbook-hint">CSV/TSV · Loaded {sources.length}/{caps.limits.maxSources} files · {(sources.reduce((sum, s) => sum + s.size_bytes, 0) / 1048576).toFixed(2)}/{(caps.limits.maxCombinedInputBytes / 1048576).toFixed(0)} MiB combined.</p>
              {notice && <p className="workbook-step-errors" role="alert">{notice}</p>}
              {library.status === 'loading' && <p role="status"><Spinner /> Loading saved datasets…</p>}
              {library.status === 'error' && <><p role="alert">{library.error}</p><button type="button" onClick={() => setLibraryAttempt((value) => value + 1)}>Retry dataset list</button></>}
              {library.status === 'ready' && <>
                {!library.data.datasets.length && <p>No saved datasets. <Link to="/dashboard/datasets">Upload files to begin.</Link></p>}
                <ul className="workbook-library-list">{library.data.datasets.map((dataset) => {
                  const alreadyLoaded = sources.some((source) => source.id === dataset.id);
                  const supported = caps.inputFormats.includes(dataset.format);
                  return <li key={dataset.id}>
                    <label className="workbook-library-check">
                      <input type="checkbox" aria-label={'Select source ' + dataset.filename}
                        checked={Boolean(librarySelected[dataset.id])} disabled={!supported || alreadyLoaded}
                        onChange={() => toggleLibrarySelect(dataset)} />
                      <div><strong>{dataset.filename}</strong><span>{dataset.format.toUpperCase()} · {(dataset.size_bytes / 1024).toFixed(1)} KiB</span></div>
                    </label>
                    <button type="button" disabled={!supported || alreadyLoaded} onClick={() => addSource(dataset)} aria-label={'Add source ' + dataset.filename}>{supported ? alreadyLoaded ? 'Selected' : 'Add' : 'Storage only'}</button>
                  </li>;
                })}</ul>
                <div className="workbook-library-pages">
                  <button type="button" disabled={Object.keys(librarySelected).length === 0} onClick={() => addSourcesBatch(Object.values(librarySelected))}>
                    Add selected ({Object.keys(librarySelected).length})
                  </button>
                  <nav aria-label="Saved dataset pages"><button type="button" disabled={libraryPage <= 1} onClick={() => setLibraryPage((page) => page - 1)}>Previous datasets</button> <span>Page {library.data.page} of {library.data.total_pages}</span> <button type="button" disabled={libraryPage >= library.data.total_pages} onClick={() => setLibraryPage((page) => page + 1)}>Next datasets</button></nav>
                </div>
              </>}
            </section>}
            <div className="workbook-sheet" id="workbook-sheet" role="tabpanel" aria-labelledby={previewSource ? 'source-tab-' + previewSource.id : undefined} aria-label={previewSource ? undefined : 'Source preview'}>
              {previewSource ? (
                isSplitActive ? (
                  <div className="workbook-split" aria-label="Side-by-side source comparison">
                    {renderSheetPane(previewSource, 'left')}
                    {renderSheetPane(effectiveCompareSource, 'right')}
                  </div>
                ) : renderSheetPane(previewSource, 'single')
              ) : <div className="workbook-empty"><h2>Start with your data</h2><p>Add a saved file to preview its columns and first ten rows.</p><button type="button" onClick={() => setSourcePicker(true)}>Add source</button><Link to="/dashboard/datasets">Upload new files</Link></div>}
            </div>
          </div>
          <AppliedStepsPanel steps={steps} activeId={activeId} schemas={schemas} sources={sources} primaryId={primaryId} capabilities={caps} validation={validation}
            onSelect={setActiveId} onPreviewSource={selectSource} onMove={move} onSourceChange={changeStepSource}
            onToggle={(id) => change(() => setSteps((items) => items.map((step) => step.id === id ? { ...step, enabled: !step.enabled } : step)))}
            onRemove={(id) => change(() => { setSteps((items) => items.filter((step) => step.id !== id)); if (activeId === id) setActiveId(''); })}
            onChange={(config) => change(() => setSteps((items) => items.map((step) => step.id === activeId ? { ...step, config } : step)))} />
        </div>
        <footer className="workbook-statusbar">
          <span>{activeSource?.status === 'ready' ? `${activeSource.filename} · First ${activeSource.preview.rows.length} of ${activeSource.preview.final_rows} rows · Original data` : 'Source preview'} · {steps.filter((step) => step.enabled).length} active {steps.filter((step) => step.enabled).length === 1 ? 'step' : 'steps'} · One output</span>
          <details className="workbook-info"><summary>Preview details</summary><div>Data shown above is the original source; transformed rows appear after execution. Types are inferred; phone numbers may lose leading zeros and mixed dates may need review. Current-session drafts are preserved while navigating across workspace pages.</div></details>
          <div id="workbook-validation" aria-live="polite">
            {validation.length ? (
              <div className="workbook-issues">
                <span className="workbook-issues-summary">{validation.length} {validation.length === 1 ? 'issue to resolve' : 'issues to resolve'}:</span>
                <ul className="workbook-issues-list">{validation.map((error) => <li key={error}>{error}</li>)}</ul>
              </div>
            ) : <span className="workbook-ready">Ready to run</span>}
          </div>
          {!!errors.length && <div role="alert" className="workbook-submit-error"><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
        </footer>
      </fieldset>
    </form>
  </div>;
}
