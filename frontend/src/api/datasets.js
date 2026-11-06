import { request } from './client';

const datasetsApi = {
  list(page = 1, { signal } = {}) {
    return request(`/api/datasets/?page=${encodeURIComponent(page)}`, { signal });
  },

  upload(file) {
    const body = new FormData();
    body.append('file', file);
    return request('/api/datasets/', { method: 'POST', body });
  },

  replace(id, file) {
    const body = new FormData();
    body.append('file', file);
    return request(`/api/datasets/${encodeURIComponent(id)}/replace/`, { method: 'POST', body });
  },

  remove(id) {
    return request(`/api/datasets/${encodeURIComponent(id)}/`, { method: 'DELETE' });
  },
};

export default datasetsApi;
