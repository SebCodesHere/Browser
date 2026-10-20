import { expect, test } from "@playwright/test";
import {
  ADBLOCK_INFO,
  compileAdblockRules,
  decideAdblock,
  type AdblockDecisionOptions
} from "../shared/adblock";

function decide(
  rules: string,
  request: Omit<AdblockDecisionOptions, "allowlist"> & { allowlist?: readonly string[] }
) {
  const compiled = compileAdblockRules(rules);
  return decideAdblock({ allowlist: [], ...request }, compiled);
}

test("bundled rules compile once, reject nothing, and report honest counts", () => {
  expect(ADBLOCK_INFO.rejectedRuleCount).toBe(0);
  expect(ADBLOCK_INFO.ruleCount).toBeGreaterThan(150);
  expect(ADBLOCK_INFO.blockRuleCount).toBe(ADBLOCK_INFO.ruleCount - ADBLOCK_INFO.exceptionRuleCount);
  expect(ADBLOCK_INFO.exceptionRuleCount).toBeGreaterThan(0);
  expect(ADBLOCK_INFO.listName).toContain("Xuvon");
  expect(ADBLOCK_INFO.license).toBe("MIT");
});

test("host-anchored rules cover subdomains and top-level documents", () => {
  const rules = "||ads.test^";
  expect(decide(rules, { url: "https://ads.test/a.js", resourceType: "script" })).toMatchObject({
    host: "ads.test",
    rule: "||ads.test^"
  });
  expect(
    decide(rules, { url: "https://cdn.ads.test/a.js", resourceType: "script" })
  ).toMatchObject({ host: "cdn.ads.test" });
  expect(decide(rules, { url: "https://ads.test/", resourceType: "mainFrame" })).toMatchObject({
    host: "ads.test"
  });
  expect(decide(rules, { url: "https://notads.test/a.js", resourceType: "script" })).toBeNull();
});

test("path and generic patterns are subresource-only unless $document is explicit", () => {
  const rules = ["/pagead/", "||cdn.test/ads/*$script", "|https://exact.test/sponsor|"].join("\n");

  expect(decide(rules, { url: "https://news.test/pagead/landing", resourceType: "mainFrame" })).toBeNull();
  expect(decide(rules, { url: "https://news.test/pagead/banner.js", resourceType: "script" })).toMatchObject({
    rule: "/pagead/"
  });
  expect(decide(rules, { url: "https://cdn.test/ads/banner.js", resourceType: "script" })).toMatchObject({
    rule: "||cdn.test/ads/*$script"
  });
  expect(decide(rules, { url: "https://cdn.test/ads/banner.png", resourceType: "image" })).toBeNull();
  expect(decide(rules, { url: "https://exact.test/sponsor", resourceType: "subFrame" })).toMatchObject({
    rule: "|https://exact.test/sponsor|"
  });
  expect(decide(rules, { url: "https://exact.test/sponsor/extra", resourceType: "subFrame" })).toBeNull();

  const explicit = "||docs.test/sponsor^$document";
  expect(decide(explicit, { url: "https://docs.test/sponsor/page", resourceType: "mainFrame" })).toMatchObject({
    rule: explicit
  });
  expect(decide(explicit, { url: "https://docs.test/sponsor/page", resourceType: "script" })).toBeNull();
});

test("exception rules win over blocking rules regardless of order", () => {
  const rules = [
    "@@||ads.test/allowed.js$script",
    "||ads.test^",
    "@@||ads.test^$document"
  ].join("\n");

  expect(decide(rules, { url: "https://ads.test/allowed.js", resourceType: "script" })).toBeNull();
  expect(decide(rules, { url: "https://ads.test/other.js", resourceType: "script" })).toMatchObject({
    rule: "||ads.test^"
  });
  expect(decide(rules, { url: "https://ads.test/other.png", resourceType: "image" })).toMatchObject({
    rule: "||ads.test^"
  });
  expect(decide(rules, { url: "https://ads.test/", resourceType: "mainFrame" })).toBeNull();

  const scoped = ["||ads.test^", "@@||ads.test/track.js$script,domain=news.test"].join("\n");
  expect(
    decide(scoped, {
      url: "https://ads.test/track.js",
      resourceType: "script",
      topUrl: "https://news.test/article"
    })
  ).toBeNull();
  expect(
    decide(scoped, {
      url: "https://ads.test/track.js",
      resourceType: "script",
      topUrl: "https://other.test/article"
    })
  ).not.toBeNull();
});

test("resource-type options block only the requested types", () => {
  const rules = [
    "||scripts.test^$script",
    "||not-images.test^$~image",
    "||styles.test^$stylesheet",
    "||api.test^$xhr",
    "||frame.test^$frame",
    "||socket.test^$websocket"
  ].join("\n");

  expect(decide(rules, { url: "https://scripts.test/a.js", resourceType: "script" })).not.toBeNull();
  expect(decide(rules, { url: "https://scripts.test/a.png", resourceType: "image" })).toBeNull();

  expect(decide(rules, { url: "https://not-images.test/a.js", resourceType: "script" })).not.toBeNull();
  expect(decide(rules, { url: "https://not-images.test/a.png", resourceType: "image" })).toBeNull();

  expect(decide(rules, { url: "https://styles.test/a.css", resourceType: "stylesheet" })).not.toBeNull();
  expect(decide(rules, { url: "https://styles.test/a.js", resourceType: "script" })).toBeNull();

  expect(decide(rules, { url: "https://api.test/data", resourceType: "xhr" })).not.toBeNull();
  expect(decide(rules, { url: "https://api.test/data", resourceType: "script" })).toBeNull();
  expect(decide(rules, { url: "https://frame.test/", resourceType: "subFrame" })).not.toBeNull();
  expect(decide(rules, { url: "wss://socket.test/feed", resourceType: "webSocket" })).not.toBeNull();
  expect(decide(rules, { url: "https://socket.test/feed", resourceType: "script" })).toBeNull();
});

test("third-party and first-party conditions use the top-level site", () => {
  const rules = [
    "||tracker-example.net^$third-party",
    "||cdn.publisher-example.com^$first-party",
    "||alias.publisher-example.com^$~third-party"
  ].join("\n");

  expect(
    decide(rules, {
      url: "https://tracker-example.net/pixel",
      resourceType: "image",
      topUrl: "https://publisher-example.com/article"
    })
  ).not.toBeNull();
  expect(
    decide(rules, {
      url: "https://tracker-example.net/pixel",
      resourceType: "image",
      topUrl: "https://www.tracker-example.net/article"
    })
  ).toBeNull();

  expect(
    decide(rules, {
      url: "https://cdn.publisher-example.com/app.js",
      resourceType: "script",
      topUrl: "https://publisher-example.com/article"
    })
  ).not.toBeNull();
  expect(
    decide(rules, {
      url: "https://cdn.publisher-example.com/app.js",
      resourceType: "script",
      topUrl: "https://other-example.com/article"
    })
  ).toBeNull();
  expect(
    decide(rules, {
      url: "https://alias.publisher-example.com/app.js",
      resourceType: "script",
      topUrl: "https://publisher-example.com/article"
    })
  ).not.toBeNull();
});

test("domain-scoped include and exclude rules apply to the top-level page", () => {
  const rules = [
    "||news.test/tracker.js$script,domain=news.test|~shop.news.test",
    "||pixel.test^$domain=~news.test"
  ].join("\n");

  expect(
    decide(rules, {
      url: "https://news.test/tracker.js",
      resourceType: "script",
      topUrl: "https://www.news.test/article"
    })
  ).not.toBeNull();
  expect(
    decide(rules, {
      url: "https://news.test/tracker.js",
      resourceType: "script",
      topUrl: "https://shop.news.test/article"
    })
  ).toBeNull();
  expect(
    decide(rules, {
      url: "https://news.test/tracker.js",
      resourceType: "script",
      topUrl: "https://other.test/article"
    })
  ).toBeNull();
  expect(
    decide(rules, {
      url: "https://news.test/tracker.js",
      resourceType: "script",
      topUrl: ""
    })
  ).toBeNull();

  expect(
    decide(rules, {
      url: "https://pixel.test/p.gif",
      resourceType: "image",
      topUrl: "https://other.test/article"
    })
  ).toMatchObject({ rule: "||pixel.test^$domain=~news.test" });
  expect(
    decide(rules, {
      url: "https://pixel.test/p.gif",
      resourceType: "image",
      topUrl: "https://news.test/article"
    })
  ).toBeNull();
});

test("per-site pauses still bypass matching rules", () => {
  const rules = "||ads.test/*";
  expect(
    decide(rules, {
      url: "https://ads.test/pixel",
      resourceType: "image",
      topUrl: "https://news.test/",
      allowlist: ["ads.test"]
    })
  ).toBeNull();
  expect(
    decide(rules, {
      url: "https://ads.test/pixel",
      resourceType: "image",
      topUrl: "https://news.test/",
      allowlist: ["news.test"]
    })
  ).toBeNull();
});

test("malformed and unsupported rules are rejected without disabling valid rules", () => {
  const rules = [
    "||valid.test^",
    "||",
    "||bad.test^$unknown",
    "||bad.test^$domain=",
    "||bad.test^$domain=foo.com=bar",
    "||bad.test^$script,~script",
    "||bad.test^$script=1",
    "||bad.test^$third-party=1",
    "||bad.test^$third-party,first-party",
    "bad.test##.ad",
    "/ads[0-9]+/",
    "@@",
    "x".repeat(2_049),
    `||bad.test/${"*".repeat(13)}`
  ].join("\n");

  const compiled = compileAdblockRules(rules);
  expect(compiled.rejected.map((item) => item.line)).toEqual(rules.split("\n").slice(1));
  expect(compiled.info.ruleCount).toBe(1);
  expect(compiled.info.rejectedRuleCount).toBe(13);
  expect(
    decideAdblock({ url: "https://valid.test/a.js", resourceType: "script", allowlist: [] }, compiled)
  ).not.toBeNull();
});

test("built-in domain and document exceptions work in the shipped list", () => {
  const builtIn = (request: Omit<AdblockDecisionOptions, "allowlist">) =>
    decideAdblock({ allowlist: [], ...request });

  expect(
    builtIn({
      url: "https://facebook.com/tr?id=1",
      resourceType: "image",
      topUrl: "https://news.test/"
    })
  ).toMatchObject({ rule: "||facebook.com/tr^$domain=~facebook.com" });
  expect(
    builtIn({
      url: "https://facebook.com/tr?id=1",
      resourceType: "image",
      topUrl: "https://facebook.com/"
    })
  ).toBeNull();
  expect(
    builtIn({
      url: "https://doubleclick.net/landing",
      resourceType: "mainFrame"
    })
  ).toBeNull();
  expect(
    builtIn({
      url: "https://doubleclick.net/ad.js",
      resourceType: "script",
      topUrl: "https://news.test/"
    })
  ).not.toBeNull();
});
