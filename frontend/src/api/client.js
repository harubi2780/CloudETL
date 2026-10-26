// One in-memory CSRF token shared by authentication and dataset requests.
let csrfToken = null;

export class ApiError extends Error {
  constructor(message, { status, code, fields } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export async function request(url, { method = 'GET', body, signal } = {}) {
  const options = { method: method.toUpperCase(), credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (signal) options.signal = signal;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(options.method)) options.headers['X-CSRFToken'] = csrfToken || '';
  if (body !== undefined) {
    if (body instanceof FormData) options.body = body;
    else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('We could not reach the service. Please try again.');
  }
  let data = null;
  try { data = await response.json(); } catch {
    // Proxies can send non-JSON errors; never show raw server content to users.
  }
  if (data && typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
  if (!response.ok) {
    const payload = data && data.error;
    throw new ApiError((payload && payload.message) || 'The service could not complete your request. Please try again.',
      { status: response.status, code: payload && payload.code, fields: payload && payload.fields });
  }
  return data;
}
