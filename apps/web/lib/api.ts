const BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const TOKEN_KEY = 'aeo_access_token';
const REFRESH_KEY = 'aeo_refresh_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

export function clearTokens() {
  setToken(null);
  setRefreshToken(null);
  clearStashedAdmin();
}

// ── Admin impersonation ("Login as" → "Back to Admin") ──────────────────
// When an admin impersonates someone we stash the admin's tokens under separate
// keys so their workspace can offer a one-click return to the admin session,
// along with the page the admin left so they land back where they started.
const ADMIN_STASH_TOKEN = 'aeo_admin_stash_token';
const ADMIN_STASH_REFRESH = 'aeo_admin_stash_refresh';
const ADMIN_STASH_RETURN = 'aeo_admin_stash_return';

/** Save the current (admin) session before swapping to someone else's. */
export function stashAdminSession(returnTo?: string) {
  if (typeof window === 'undefined') return;
  const t = getToken();
  const r = getRefreshToken();
  if (t) localStorage.setItem(ADMIN_STASH_TOKEN, t);
  if (r) localStorage.setItem(ADMIN_STASH_REFRESH, r);
  localStorage.setItem(
    ADMIN_STASH_RETURN,
    returnTo || window.location.pathname || '/dashboard',
  );
}

/** True when an admin session is stashed (i.e. we're currently impersonating). */
export function hasStashedAdmin(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(ADMIN_STASH_TOKEN);
}

/**
 * Restore the stashed admin session. Returns the page the admin came from, or
 * null if nothing was stashed (i.e. this isn't an impersonated session).
 */
export function restoreAdminSession(): string | null {
  if (typeof window === 'undefined') return null;
  const t = localStorage.getItem(ADMIN_STASH_TOKEN);
  if (!t) return null;
  const r = localStorage.getItem(ADMIN_STASH_REFRESH);
  const back = localStorage.getItem(ADMIN_STASH_RETURN);
  setToken(t);
  setRefreshToken(r);
  clearStashedAdmin();
  return back || '/dashboard';
}

/** Drop any stashed admin session (e.g. on a clean sign-out). */
export function clearStashedAdmin() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ADMIN_STASH_TOKEN);
  localStorage.removeItem(ADMIN_STASH_REFRESH);
  localStorage.removeItem(ADMIN_STASH_RETURN);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Coalesce concurrent refreshes so a burst of 401s only refreshes once.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = await res.json();
    setToken(data.accessToken);
    if (data.refreshToken) setRefreshToken(data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  // Access token expired → transparently refresh once and retry.
  if (
    res.status === 401 &&
    !retried &&
    !path.startsWith('/auth/')
  ) {
    if (!refreshing) refreshing = tryRefresh().finally(() => (refreshing = null));
    const ok = await refreshing;
    if (ok) return request<T>(method, path, body, true);
    // Refresh failed → session is dead; send the user back to login.
    clearTokens();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = Array.isArray(data.message)
        ? data.message.join(', ')
        : (data.message ?? message);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Fetch a binary response (e.g. a gated attachment) with the auth header. */
export async function fetchBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

/** Fired when the server holds a change for approval instead of applying it. */
export const PENDING_CHANGE_EVENT = 'aeo:pending-change';

function notePending<T>(p: Promise<T>): Promise<T> {
  return p.then((r) => {
    if (
      typeof window !== 'undefined' &&
      r &&
      typeof r === 'object' &&
      (r as { pendingApproval?: boolean }).pendingApproval
    ) {
      window.dispatchEvent(new Event(PENDING_CHANGE_EVENT));
    }
    return r;
  });
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => notePending(request<T>('POST', path, body)),
  put: <T>(path: string, body?: unknown) => notePending(request<T>('PUT', path, body)),
  patch: <T>(path: string, body?: unknown) => notePending(request<T>('PATCH', path, body)),
  del: <T>(path: string) => notePending(request<T>('DELETE', path)),
};
