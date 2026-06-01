const LOCAL_API_ORIGIN = 'http://127.0.0.1:8000';

function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
  if (configuredBase) {
    return `${configuredBase}${path.startsWith('/') ? path : `/${path}`}`;
  }

  const currentPort = window.location.port;
  const isLocalHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  if (import.meta.env.DEV && isLocalHost && currentPort !== '5173') {
    return `${LOCAL_API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
  }

  return path;
}

// API helper
export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(resolveApiUrl(path), opts);
  const data = await res.json().catch(() => ({ detail: res.statusText })) as Record<string, unknown>;
  if (!res.ok) {
    const detail = data.detail;
    const msg = detail
      ? Array.isArray(detail)
        ? (detail as {msg?: string}[]).map(d => d.msg || JSON.stringify(d)).join('; ')
        : String(detail)
      : res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

// Formatting helpers
export const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : Number(v).toFixed(1);

export const fmtPrice = (v: number | null | undefined) =>
  !v || v === 0 ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`;

export function scoreColor(s: number | null | undefined): string {
  if (!s || s < 40) return '#ef4444';
  if (s < 55) return '#f59e0b';
  if (s < 70) return '#6366f1';
  return '#22c55e';
}

export function scoreGradient(s: number | null | undefined): string {
  const deg = `${((s || 0) / 100 * 360).toFixed(1)}deg`;
  return `conic-gradient(${scoreColor(s)} ${deg}, rgba(255,255,255,.06) 0)`;
}
