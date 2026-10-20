/**
 * Small host helpers shared by the renderer and the blocker. Keep this module
 * independent of the rule compiler so the React UI does not bundle rule data
 * or tldts.
 */

const HOST_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/** Lowercases and validates a hostname, dropping `www.` and leading dots. */
export function normalizeAdblockHost(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^\.+/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host || host.length > 253) return null;
  if (!HOST_PATTERN.test(host)) return null;
  return host;
}

/** True when `host` equals or is a subdomain of any allowlist entry. */
export function isAllowlisted(host: string, allowlist: readonly string[]): boolean {
  const target = normalizeAdblockHost(host);
  if (!target) return false;
  return allowlist.some((entry) => {
    const allowed = normalizeAdblockHost(entry);
    if (!allowed) return false;
    return target === allowed || target.endsWith(`.${allowed}`);
  });
}
