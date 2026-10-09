export function formatRelative(isoTs: string | null): string {
  if (!isoTs) return "—";
  const then = new Date(isoTs).getTime();
  if (Number.isNaN(then)) return isoTs;
  const dt = Date.now() - then;
  if (dt < 0) return new Date(then).toLocaleString();
  const s = Math.floor(dt / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * A duration in seconds: sub-second precision below 10 s ("0.4s", "3.2s",
 * "<0.1s"), whole seconds up to a minute, then "4m 5s" and "2h 3m". One
 * format for the Runs table, the run header and Summary cards.
 */
export function formatSeconds(seconds: number): string {
  const sec = Math.max(0, seconds);
  if (sec === 0) return "0s";
  if (sec < 0.05) return "<0.1s";
  if (sec < 9.95) return `${sec.toFixed(1)}s`;
  const s = Math.max(10, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export function formatDuration(startIso: string, endIso: string | null, now: number = Date.now()): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  return formatSeconds((end - start) / 1000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function safeJsonParse<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
