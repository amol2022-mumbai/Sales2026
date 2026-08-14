const TOKEN_KEY = 'crm.accessToken';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Core fetch wrapper. Attaches the JWT, normalizes errors, and routes
 * 401 responses back to the login screen.
 *
 * Set `options.raw = true` to receive the full response envelope
 * (e.g. `{ data, meta }`) instead of just the `data` field.
 */
export async function apiFetch(path, options = {}) {
  const { raw, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  if (fetchOptions.body && typeof fetchOptions.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(fetchOptions.body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, { ...fetchOptions, headers });
  } catch (err) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server', undefined);
  }

  if (res.status === 204) return null;

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const error = payload?.error || {};
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('crm:unauthorized'));
    }
    throw new ApiError(res.status, error.code || 'ERROR', error.message || 'Request failed', error.details);
  }

  if (raw) return payload;
  return payload?.data ?? payload;
}
