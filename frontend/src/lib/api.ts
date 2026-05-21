// API helper
export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, opts);
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
