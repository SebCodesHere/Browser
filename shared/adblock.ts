/**
 * Xuvon's precompiled network-rule blocker.
 *
 * The supported syntax is a deliberately small subset of Adblock Plus network
 * filters, documented in docs/adblock.md. Rules are compiled once at module
 * load. No rule text is parsed on the request path, and host-anchored rules are
 * indexed by host suffix instead of scanning the whole list.
 *
 * No third-party filter list is bundled. The built-in rules in
 * `shared/adblock-rules.ts` were written for Xuvon under the project's MIT
 * license. See docs/adblock.md for list attribution and update policy.
 */

import { getDomain } from "tldts";
import {
  ADBLOCK_RULES_SOURCE,
  ADBLOCK_RULES_UPDATED,
  ADBLOCK_RULES_VERSION
} from "./adblock-rules";
import { isAllowlisted, normalizeAdblockHost } from "./adblock-utils";
import type { AdblockInfo } from "./types";

export const ADBLOCK_RULE_SYNTAX_VERSION = 1;

export type AdblockResourceType =
  | "document"
  | "subdocument"
  | "script"
  | "image"
  | "stylesheet"
  | "font"
  | "media"
  | "xmlhttprequest"
  | "websocket"
  | "ping"
  | "object"
  | "other";

export type AdblockParty = "first-party" | "third-party";

export interface RejectedAdblockRule {
  lineNumber: number;
  line: string;
  reason: string;
}

export interface CompiledAdblockRule {
  /** The original rule text, useful for diagnostics and tests. */
  source: string;
  lineNumber: number;
  exception: boolean;
  /** True for `||host^` rules that can use the host index. */
  hostOnly: boolean;
  /** Normalized host name when `hostOnly` is true. */
  host: string | null;
  /** Compiled matcher for path/generic rules, or null for host-only rules. */
  regex: RegExp | null;
  /** Cheap required-substring prefilter for generic rules. */
  literal: string | null;
  types: ReadonlySet<AdblockResourceType>;
  excludedTypes: ReadonlySet<AdblockResourceType>;
  domains: readonly string[];
  excludedDomains: readonly string[];
  party: AdblockParty | null;
  /** Whether this rule may match a top-level document request. */
  documentEligible: boolean;
}

export interface AdblockCompilation {
  rules: readonly CompiledAdblockRule[];
  hostRules: ReadonlyMap<string, readonly CompiledAdblockRule[]>;
  genericRules: readonly CompiledAdblockRule[];
  rejected: readonly RejectedAdblockRule[];
  info: AdblockInfo;
}

export interface AdblockDecision {
  /** The request host that matched. */
  host: string;
  reason: "rule";
  /** The exact rule that matched. */
  rule: string;
}

export interface AdblockDecisionOptions {
  url: string;
  /** Electron resource type: mainFrame, script, image, xhr, etc. */
  resourceType: string;
  /** Top-level page URL, used for third-party and domain scoping. */
  topUrl?: string;
  /** Per-site pause list from the Rust core. */
  allowlist?: readonly string[];
}

const MAX_RULE_LENGTH = 2_048;
const MAX_RULES = 10_000;
const MAX_OPTIONS = 32;
const MAX_DOMAINS_PER_RULE = 64;
const MAX_WILDCARDS_PER_RULE = 12;

const RESOURCE_TYPES = new Set<AdblockResourceType>([
  "document",
  "subdocument",
  "script",
  "image",
  "stylesheet",
  "font",
  "media",
  "xmlhttprequest",
  "websocket",
  "ping",
  "object",
  "other"
]);

const ELECTRON_RESOURCE_TYPES: Record<string, AdblockResourceType> = {
  mainframe: "document",
  subframe: "subdocument",
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  font: "font",
  media: "media",
  xhr: "xmlhttprequest",
  xmlhttprequest: "xmlhttprequest",
  websocket: "websocket",
  ping: "ping",
  object: "object",
  other: "other",
  cspreport: "other",
  preflight: "other"
};

const HOST_ONLY_PATTERN = /^\|\|([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\^?$/i;
const REGEX_FILTER_PATTERN = /^\/[\s\S]+\/$/;
const REGEX_META_PATTERN = /[\\[\](){}?+^$|]/;
const COSMETIC_MARKERS = ["##", "#@#", "#?#", "#$#"];

/** Maps an Electron `resourceType` to the blocker's normalized type. */
export function adblockResourceType(resourceType: string): AdblockResourceType {
  return ELECTRON_RESOURCE_TYPES[resourceType.toLowerCase()] ?? "other";
}

interface CompiledRuleResult {
  rule?: CompiledAdblockRule;
  error?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function parseRule(raw: string, lineNumber: number): CompiledRuleResult {
  if (raw.length > MAX_RULE_LENGTH) {
    return { error: `rule exceeds ${MAX_RULE_LENGTH} characters` };
  }
  if (raw.startsWith("#") || COSMETIC_MARKERS.some((marker) => raw.includes(marker))) {
    return { error: "cosmetic and element-hiding filters are not supported" };
  }
  if (/\s/.test(raw)) {
    return { error: "whitespace is not supported in network rules" };
  }

  let source = raw;
  let exception = false;
  if (source.startsWith("@@")) {
    exception = true;
    source = source.slice(2);
  }
  if (!source) return { error: "missing network pattern" };

  const optionIndex = source.lastIndexOf("$");
  let pattern = source;
  let optionText = "";
  if (optionIndex !== -1) {
    pattern = source.slice(0, optionIndex);
    optionText = source.slice(optionIndex + 1);
    if (!pattern || !optionText) return { error: "empty pattern or option list" };
  }
  if (!pattern) return { error: "missing network pattern" };

  if (REGEX_FILTER_PATTERN.test(pattern) && REGEX_META_PATTERN.test(pattern.slice(1, -1))) {
    return { error: "regular-expression filters are not supported" };
  }
  if ((pattern.match(/\*/g)?.length ?? 0) > MAX_WILDCARDS_PER_RULE) {
    return { error: `more than ${MAX_WILDCARDS_PER_RULE} wildcards` };
  }

  const types = new Set<AdblockResourceType>();
  const excludedTypes = new Set<AdblockResourceType>();
  const domains: string[] = [];
  const excludedDomains: string[] = [];
  let party: AdblockParty | null = null;

  const setParty = (next: AdblockParty): string | null => {
    if (party && party !== next) return "conflicting first/third-party options";
    party = next;
    return null;
  };

  if (optionText) {
    const options = optionText.split(",");
    if (options.length > MAX_OPTIONS) {
      return { error: `more than ${MAX_OPTIONS} options` };
    }
    for (const rawOption of options) {
      const option = rawOption.trim();
      if (!option) return { error: "empty option" };
      const negated = option.startsWith("~");
      const body = negated ? option.slice(1) : option;
      const equals = body.indexOf("=");
      const name = equals === -1 ? body : body.slice(0, equals);
      const value = equals === -1 ? undefined : body.slice(equals + 1);
      const normalizedName = name.toLowerCase();

      if (normalizedName === "domain") {
        if (negated || !value) return { error: "domain requires a value" };
        for (const rawDomain of value.split("|")) {
          const exclude = rawDomain.startsWith("~");
          const normalized = normalizeAdblockHost(exclude ? rawDomain.slice(1) : rawDomain);
          if (!normalized) return { error: "invalid domain option" };
          (exclude ? excludedDomains : domains).push(normalized);
        }
        if (domains.length + excludedDomains.length > MAX_DOMAINS_PER_RULE) {
          return { error: `more than ${MAX_DOMAINS_PER_RULE} domains` };
        }
        continue;
      }

      if (normalizedName === "third-party") {
        if (value !== undefined) return { error: `option does not take a value: ${name}` };
        const conflict = setParty(negated ? "first-party" : "third-party");
        if (conflict) return { error: conflict };
        continue;
      }
      if (normalizedName === "first-party") {
        if (value !== undefined) return { error: `option does not take a value: ${name}` };
        const conflict = setParty(negated ? "third-party" : "first-party");
        if (conflict) return { error: conflict };
        continue;
      }

      let typeName = normalizedName as AdblockResourceType;
      if (normalizedName === "xhr") typeName = "xmlhttprequest";
      else if (normalizedName === "css") typeName = "stylesheet";
      else if (normalizedName === "frame") typeName = "subdocument";
      if (!RESOURCE_TYPES.has(typeName)) {
        return { error: `unsupported option: ${option}` };
      }
      if (value !== undefined) return { error: `option does not take a value: ${name}` };
      (negated ? excludedTypes : types).add(typeName);
    }
    for (const type of types) {
      if (excludedTypes.has(type)) return { error: `conflicting type option: ${type}` };
    }
  }

  const hostOnlyMatch = HOST_ONLY_PATTERN.exec(pattern);
  let hostOnly = false;
  let host: string | null = null;
  if (hostOnlyMatch) {
    host = normalizeAdblockHost(hostOnlyMatch[1]);
    if (!host) return { error: "invalid host" };
    hostOnly = true;
  } else if (pattern.startsWith("||") && !/^[a-z0-9]/i.test(pattern.slice(2))) {
    return { error: "host anchor must start with a hostname" };
  }

  let regex: RegExp | null = null;
  if (!hostOnly) {
    let start = 0;
    let prefix = "";
    if (pattern.startsWith("||")) {
      start = 2;
      prefix = "^(?:https?|wss?)://(?:[^/?#]*\\.)?";
    } else if (pattern.startsWith("|")) {
      start = 1;
      prefix = "^";
    }
    let end = pattern.length;
    let suffix = "";
    if (end > start && pattern.endsWith("|")) {
      end -= 1;
      suffix = "$";
    }
    if (start >= end) return { error: "empty network pattern" };

    let body = "";
    for (let index = start; index < end; index += 1) {
      const character = pattern[index];
      if (character === "*") {
        body += ".*";
      } else if (character === "^") {
        body += "(?:[^a-zA-Z0-9_.%-]|$)";
      } else {
        body += escapeRegex(character);
      }
    }
    try {
      regex = new RegExp(`${prefix}${body}${suffix}`, "i");
    } catch {
      return { error: "invalid pattern after compilation" };
    }
  }

  const literalSource = pattern
    .slice(pattern.startsWith("||") ? 2 : pattern.startsWith("|") ? 1 : 0)
    .replace(/\|$/, "");
  let literal: string | null = null;
  if (!hostOnly) {
    for (const chunk of literalSource.split(/[*^]/)) {
      if (chunk.length >= 3 && (!literal || chunk.length > literal.length)) {
        literal = chunk.toLowerCase();
      }
    }
  }

  const excludedDocument = excludedTypes.has("document");
  const documentEligible = excludedDocument
    ? false
    : types.has("document") || (hostOnly && types.size === 0);

  return {
    rule: {
      source: raw,
      lineNumber,
      exception,
      hostOnly,
      host,
      regex,
      literal,
      types,
      excludedTypes,
      domains,
      excludedDomains,
      party,
      documentEligible
    }
  };
}

/** Compiles rule text once into host-indexed and generic matchers. */
export function compileAdblockRules(source: string): AdblockCompilation {
  const rules: CompiledAdblockRule[] = [];
  const rejected: RejectedAdblockRule[] = [];
  const hostRules = new Map<string, CompiledAdblockRule[]>();
  const genericRules: CompiledAdblockRule[] = [];

  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith("!") || (raw.startsWith("[") && raw.endsWith("]"))) {
      continue;
    }
    if (rules.length >= MAX_RULES) {
      rejected.push({
        lineNumber: index + 1,
        line: raw,
        reason: `rule limit of ${MAX_RULES} exceeded`
      });
      continue;
    }
    const parsed = parseRule(raw, index + 1);
    if (!parsed.rule) {
      rejected.push({
        lineNumber: index + 1,
        line: raw,
        reason: parsed.error ?? "invalid rule"
      });
      continue;
    }
    const rule = parsed.rule;
    rules.push(rule);
    if (rule.hostOnly && rule.host) {
      const bucket = hostRules.get(rule.host);
      if (bucket) bucket.push(rule);
      else hostRules.set(rule.host, [rule]);
    } else {
      genericRules.push(rule);
    }
  }

  const hostRuleCount = rules.filter((rule) => rule.hostOnly).length;
  const exceptionRuleCount = rules.filter((rule) => rule.exception).length;
  const info: AdblockInfo = {
    ruleCount: rules.length,
    blockRuleCount: rules.length - exceptionRuleCount,
    exceptionRuleCount,
    hostRuleCount,
    patternRuleCount: rules.length - hostRuleCount,
    rejectedRuleCount: rejected.length,
    listName: "Xuvon built-in network rules",
    listVersion: ADBLOCK_RULES_VERSION,
    license: "MIT",
    updatedAt: ADBLOCK_RULES_UPDATED,
    syntaxVersion: ADBLOCK_RULE_SYNTAX_VERSION
  };

  return { rules, hostRules, genericRules, rejected, info };
}

function topLevelHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return normalizeAdblockHost(parsed.hostname);
  } catch {
    return null;
  }
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function siteOf(host: string): string {
  return (getDomain(host, { allowPrivateDomains: true }) ?? host).toLowerCase();
}

function isThirdParty(topHost: string, requestHost: string): boolean {
  return siteOf(topHost) !== siteOf(requestHost);
}

function ruleMatches(
  rule: CompiledAdblockRule,
  type: AdblockResourceType,
  host: string,
  topHost: string | null,
  lowerUrl: string
): boolean {
  if (type === "document" && !rule.documentEligible) return false;
  if (rule.excludedTypes.has(type)) return false;
  if (rule.types.size > 0 && !rule.types.has(type)) return false;

  if (rule.domains.length > 0 || rule.excludedDomains.length > 0) {
    if (!topHost) return false;
    if (rule.excludedDomains.some((domain) => hostMatchesDomain(topHost, domain))) {
      return false;
    }
    if (rule.domains.length > 0 && !rule.domains.some((domain) => hostMatchesDomain(topHost, domain))) {
      return false;
    }
  }

  if (rule.party) {
    if (!topHost) return false;
    const thirdParty = isThirdParty(topHost, host);
    if (rule.party === "third-party" && !thirdParty) return false;
    if (rule.party === "first-party" && thirdParty) return false;
  }

  if (rule.hostOnly) return true;
  if (rule.literal && !lowerUrl.includes(rule.literal)) return false;
  return rule.regex ? rule.regex.test(lowerUrl) : false;
}

function hostCandidates(
  index: ReadonlyMap<string, readonly CompiledAdblockRule[]>,
  host: string
): CompiledAdblockRule[] {
  const candidates: CompiledAdblockRule[] = [];
  let current = host;
  for (;;) {
    const rules = index.get(current);
    if (rules) candidates.push(...rules);
    const dot = current.indexOf(".");
    if (dot === -1) break;
    current = current.slice(dot + 1);
  }
  return candidates;
}

/**
 * Decides whether a request should be cancelled. Returns `null` when the
 * request is allowed. Exceptions win over blocking rules; per-site pauses and
 * onion policy are handled before this function.
 */
export function decideAdblock(
  options: AdblockDecisionOptions,
  compiled: AdblockCompilation = BUNDLED_ADBLOCK
): AdblockDecision | null {
  let request: URL;
  try {
    request = new URL(options.url);
  } catch {
    return null;
  }
  if (
    request.protocol !== "http:" &&
    request.protocol !== "https:" &&
    request.protocol !== "ws:" &&
    request.protocol !== "wss:"
  ) {
    return null;
  }

  const host = normalizeAdblockHost(request.hostname);
  if (!host) return null;

  const type = adblockResourceType(options.resourceType);
  const allowlist = options.allowlist ?? [];
  const isDocument = type === "document";
  const parsedTopHost = isDocument ? host : topLevelHost(options.topUrl);

  if (isDocument) {
    if (isAllowlisted(host, allowlist)) return null;
  } else {
    if (parsedTopHost && isAllowlisted(parsedTopHost, allowlist)) return null;
    if (isAllowlisted(host, allowlist)) return null;
  }

  const candidates = hostCandidates(compiled.hostRules, host);
  if (compiled.genericRules.length > 0) candidates.push(...compiled.genericRules);
  const lowerUrl = request.href.toLowerCase();

  // Exception rules win over every blocking rule, independent of file order.
  for (const rule of candidates) {
    if (!rule.exception) continue;
    if (ruleMatches(rule, type, host, parsedTopHost, lowerUrl)) return null;
  }

  for (const rule of candidates) {
    if (rule.exception) continue;
    if (!ruleMatches(rule, type, host, parsedTopHost, lowerUrl)) continue;
    return { host, reason: "rule", rule: rule.source };
  }

  return null;
}

const BUNDLED_ADBLOCK = compileAdblockRules(ADBLOCK_RULES_SOURCE);

export const ADBLOCK_INFO: AdblockInfo = BUNDLED_ADBLOCK.info;
