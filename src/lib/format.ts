export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "xuvon:") return url;
    const host = parsed.hostname.replace(/^www\./, "");
    const defaultPort =
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443");
    const port = parsed.port && !defaultPort ? `:${parsed.port}` : "";
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${host}${port}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
}

export function isHttpUrl(url: string | null | undefined): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}

export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || "Page";
  } catch {
    return url;
  }
}

export function displayTitle(title: string | null | undefined, url?: string): string {
  const clean = title?.trim();
  if (clean) return clean;
  if (url) return titleFromUrl(url);
  return "New Tab";
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** exponent;
  return `${amount >= 100 || exponent === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[exponent]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric"
  }).format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function dayGroup(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  if (time >= start) return "Today";
  if (time >= start - 86_400_000) return "Yesterday";
  if (time >= start - 6 * 86_400_000) return "This week";
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric"
  }).format(date);
}

export function hostInitial(urlOrTitle: string): string {
  const host = hostnameOf(urlOrTitle);
  const char = host.replace(/^https?:\/\//, "").charAt(0);
  return (char || "•").toUpperCase();
}

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  const delta = Date.now() - date.getTime();
  if (!Number.isFinite(delta)) return "";
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return formatDate(iso);
}

export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late-night wandering";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function colorClassFor(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return `tone-${hash % 5}`;
}

export function safeFavicon(value: string | null | undefined): string | null {
  return value && value.startsWith("data:") ? value : null;
}
