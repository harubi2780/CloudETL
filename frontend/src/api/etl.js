import { ApiError, request } from './client';

const runUrl = (id) => `/api/etl/runs/${encodeURIComponent(id)}/`;
const etlApi = {
  capabilities({ signal } = {}) { return request('/api/etl/capabilities/', { signal }); },
  dataset(id, { signal } = {}) { return request(`/api/etl/datasets/${encodeURIComponent(id)}/`, { signal }); },
  preview(id, { signal } = {}) { return request(`/api/etl/datasets/${encodeURIComponent(id)}/preview/`, { signal }); },
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
