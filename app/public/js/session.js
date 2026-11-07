/* Session state and the API client. Pages read `session.user`; the shell sets it (see shell.js). */

export const session = { token: null, user: null, onExpired: () => {} };
try { session.token = sessionStorage.getItem('ma_token'); } catch { /* storage may be unavailable */ }

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.token && !path.startsWith('/auth/login')) { session.onExpired(); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
