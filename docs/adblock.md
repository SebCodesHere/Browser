# Ad and tracker blocking

Xuvon compiles a small network-filter language once at startup and runs it in
Electron's main process through Chromium's `webRequest.onBeforeRequest`. It does
not inject a page script, rewrite HTML, or use a renderer-side blocker.

## Bundled rules and attribution

- The rules in [`shared/adblock-rules.ts`](../shared/adblock-rules.ts) are
  original Xuvon data, covered by the project's MIT license.
- **No third-party filter list is bundled or copied.** In particular, EasyList /
  EasyPrivacy are dual-licensed GPLv3+ / CC BY-SA 3.0+ (see the
  [EasyList licence page](https://easylist.to/pages/licence.html)). Xuvon does
  not import that data because its share-alike terms and full rule surface are
  outside this project's scope. uBlock Origin, AdGuard, and other publisher
  lists are likewise not bundled.
- The supported syntax is based on the public
  [Adblock Plus network-filter documentation](https://help.eyeo.com/adblockplus/how-to-write-filters).
  This is an attribution for the syntax, not a compatibility claim.
- The current rule-set version and review date are exported with
  `ADBLOCK_INFO` and shown in Privacy settings.

## Updating the bundled rules

Rules are shipped with the app; there is no remote fetch, subscription, or
automatic update. To change them:

1. Edit `shared/adblock-rules.ts`.
2. Bump `ADBLOCK_RULES_VERSION` and `ADBLOCK_RULES_UPDATED`.
3. Add or adjust synthetic tests in `tests/adblock-rules.spec.ts`.
4. Run `npm run typecheck`, `npx playwright test tests/adblock-rules.spec.ts`,
   and the adblock E2E suite.
5. Rebuild and package the app.

Before adding a rule, confirm it targets an ad, tracker, or telemetry endpoint,
not a shared CDN, payment flow, sign-in endpoint, or first-party application
asset. Prefer a host-only rule with a clear owner. Use a path, type, or
`$third-party` condition when a broad host rule would break legitimate pages.

## Supported syntax

Comments start with `!`. Lines such as `[Adblock Plus 2.0]` are ignored.

### Network patterns

| Form | Meaning |
| --- | --- |
| `||ads.example^` | Host anchor: `ads.example` and its subdomains, for HTTP(S) and WS(S). A host-only rule also applies to top-level navigation. |
| `||cdn.example/ads/*$script` | Host-anchored path with `*` wildcard. Path rules are subresource-only unless they opt in with `$document`. |
| `/pagead/` | Literal URL substring, anywhere in the URL, subresource-only by default. |
| `|https://example/path` | `|` at the start anchors to the beginning of the URL. |
| `...path|` | `|` at the end anchors to the end of the URL. |
| `^` | Separator: any character except letters, digits, `_`, `-`, `.`, `%`, or end of URL. |
| `*` | Zero or more characters. |

`@@` before a pattern turns it into an exception. Exceptions are matched first
and override all blocking rules regardless of file order.

### Options

Options follow the final `$`, separated by commas.

- Resource types: `document`, `subdocument` (alias `frame`), `script`, `image`,
  `stylesheet` (alias `css`), `font`, `media`, `xmlhttprequest` (alias `xhr`),
  `websocket`, `ping`, `object`, `other`.
- Negated types: `~script`, `~image`, and so on.
- Party: `third-party`, `~third-party` / `first-party`, and `~first-party`.
- Domains: `domain=example.com|~shop.example.com`. Includes and excludes match
  the top-level page host and its subdomains.
- Document opt-in: `$document` lets a path or generic rule match a top-level
  document. A host-only rule with no type options already does this.

Examples:

```text
||ads.example^
||cdn.example/ads/*$script,third-party
||pixel.example^$domain=news.example|~shop.news.example
@@||ads.example/allowed.js$script
@@||ads.example^$document
```

## Matching and precedence

For every request the order is:

1. `.onion` destinations are cancelled before adblock matching.
2. If the global blocker is off, allow.
3. If the top-level site or request host is paused/per-site allowlisted, allow.
4. Any matching `@@` exception allows.
5. Any matching blocking rule cancels.
6. Otherwise allow.

Exception rules win over blocking rules. File order is not significant.

The matching semantics are intentionally explicit:

- A host-only rule without type options matches all request types, including
  top-level documents (existing behavior).
- A path or generic URL rule matches subresources only unless it has
  `$document`. This prevents a page whose own path contains `/pagead/` from
  being blocked as a document.
- A rule with `$domain=` or a party condition does not match when no usable
  top-level page URL is available. This fails open rather than guessing.
- Domain scoping uses the top-level page URL, not the immediate iframe URL.
- Third-party means a different registrable site (eTLD+1, with private suffixes)
  from the top-level page, computed with `tldts`.
- Per-site pauses remain broader than exceptions: pausing a site bypasses all
  adblock rules for that top-level page.

Only HTTP(S) and WS(S) URLs are matched. Data, blob, file, and internal
`xuvon://` URLs are not filtered.

## Performance and limits

- Rule text is parsed and compiled once at module load, never per request.
- The rule compiler and rule data stay in the Electron main process. The React
  UI receives only summary counts and version metadata through bootstrap.
- Host-only rules are indexed by host suffix; a request checks only its own host
  and parent suffixes.
- Generic/path rules use a compiled regular expression plus a required literal
  substring prefilter.
- The matcher is synchronous and bounded: at most 10,000 rules, 2,048 characters
  per rule, 32 options per rule, 64 domain entries per rule, and 12 wildcards per
  rule. The bundled set is far below these limits.
- There is no network I/O or disk I/O on the request path.

## Not supported

- Full EasyList, EasyPrivacy, uBlock Origin, or Adblock Plus compatibility.
- Cosmetic filters (`##`, `#@#`), element hiding, scriptlets, and HTML filters.
- Regular-expression filters.
- `$removeparam`, `$redirect`, `$csp`, `$denyallow`, `$important`, `$match-case`,
  and other options not listed above.
- User-supplied rules and automatic filter-list updates/subscriptions.
- Filtering of requests outside Electron's session (server-side or native
  network traffic).

## Tests

`tests/adblock-rules.spec.ts` is deterministic and covers synthetic rules for
host/path matching, anchors and wildcards, exceptions, resource types, first- and
third-party requests, domain includes/excludes, malformed rules, per-site
pauses, and the shipped list. `tests/adblock.spec.ts` exercises the real Electron
session: ad and pixel requests are cancelled before reaching the test server,
requests on a matching top-level document path are not cancelled, per-site pause
and the global toggle still work, and the shield panel is laid out beside the
native tab view rather than underneath it.
