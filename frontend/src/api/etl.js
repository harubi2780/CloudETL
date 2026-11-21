import { ApiError, request } from './client';

const runUrl = (id) => `/api/etl/runs/${encodeURIComponent(id)}/`;
const etlApi = {
  capabilities({ signal } = {}) { return request('/api/etl/capabilities/', { signal }); },
  dataset(id, { signal } = {}) { return request(`/api/etl/datasets/${encodeURIComponent(id)}/`, { signal }); },
  preview(id, { signal } = {}) { return request(`/api/etl/datasets/${encodeURIComponent(id)}/preview/`, { signal }); },
  datasetRows(id, { page = 1, pageSize = 25, signal } = {}) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    return request(`/api/etl/datasets/${encodeURIComponent(id)}/rows/?${params}`, { signal });
  },
  listPipelines({ page = 1, signal } = {}) {
    return request(`/api/etl/pipelines/?page=${encodeURIComponent(String(page))}`, { signal });
  },
  getPipeline(id, { signal } = {}) { return request(`/api/etl/pipelines/${encodeURIComponent(id)}/`, { signal }); },
  createPipeline(payload) { return request('/api/etl/pipelines/', { method: 'POST', body: payload }); },
  updatePipeline(id, payload) { return request(`/api/etl/pipelines/${encodeURIComponent(id)}/`, { method: 'PUT', body: payload }); },
  deletePipeline(id) { return request(`/api/etl/pipelines/${encodeURIComponent(id)}/`, { method: 'DELETE' }); },
  submit(payload) { return request('/api/etl/runs/', { method: 'POST', body: payload }); },
  listRuns({ page = 1, status = '', signal } = {}) {
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set('status', status);
    return request(`/api/etl/runs/?${params}`, { signal });
  },
  getRun(id, { signal } = {}) { return request(runUrl(id), { signal }); },
  deleteResult(id) { return request(`${runUrl(id)}result/`, { method: 'DELETE' }); },
  rows(id, { page = 1, pageSize = 25, signal } = {}) {
    return request(`${runUrl(id)}rows/?page=${page}&page_size=${pageSize}`, { signal });
  },
  runSourceRows(id, { page = 1, pageSize = 25, datasetId = '', signal } = {}) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (datasetId) params.set('dataset_id', datasetId);
    return request(`${runUrl(id)}source-rows/?${params}`, { signal });
  },
  async download(id, format) {
    let response;
    try {
      response = await fetch(`${runUrl(id)}download/?format=${encodeURIComponent(format)}`, { credentials: 'same-origin' });
    } catch {
      throw new ApiError('We could not reach the download service. Please try again.');
    }
    if (!response.ok) {
      let data;
      try { data = await response.json(); } catch { /* Never expose raw proxy responses. */ }
      throw new ApiError(data?.error?.message || 'Download failed. Please try again.', { status: response.status, code: data?.error?.code });
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `result-${id}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};

export default etlApi;
