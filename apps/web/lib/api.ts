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

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
