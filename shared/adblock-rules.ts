/**
 * Original network rules authored for Xuvon.
 *
 * No EasyList, EasyPrivacy, uBlock Origin, AdGuard, or other third-party
 * filter-list data is copied here. EasyList is dual-licensed GPLv3+ /
 * CC BY-SA 3.0+; importing it would bring share-alike obligations and a much
 * larger compatibility surface than this blocker implements. The rules below
 * are original Xuvon data and are covered by the project's MIT license.
 *
 * Syntax is a deliberately small, documented subset of Adblock Plus network
 * filter syntax. See docs/adblock.md before adding a rule. Rules are compiled
 * once at startup, not parsed per request.
 *
 * General rules without a host anchor are subresource-only unless they opt in
 * with `$document`. Host-only rules (for example `||ads.example^`) continue to
 * apply to top-level navigation, preserving Xuvon's existing behavior.
 */

export const ADBLOCK_RULES_VERSION = "2026.10.1";
export const ADBLOCK_RULES_UPDATED = "2026-10-20";

export const ADBLOCK_RULES_SOURCE = String.raw`
! Title: Xuvon built-in network rules
! Version: 2026.10.1
! Last reviewed: 2026-10-20
! License: MIT (original Xuvon rules; no third-party list data)
!
! Ad exchanges and networks
||2mdn.net^
||33across.com^
||adacado.com^
||adblade.com^
||adbutler.com^
||adcolony.com^
||adform.net^
||adkernel.com^
||adlightning.com^
||admanmedia.com^
||adnxs.com^
||adotmob.com^
||adroll.com^
||adsafeprotected.com^
||adsrvr.org^
||adsymptotic.com^
||adtechus.com^
||advertising.com^
||adzerk.net^
||aerserv.com^
||amazon-adsystem.com^
||amobee.com^
||applovin.com^
||appnexus.com^
||atomx.com^
||bidr.io^
||bidswitch.net^
||bidtellect.com^
||brightcom.com^
||buysellads.com^
||carbonads.com^
||casalemedia.com^
||chartboost.com^
||conversantmedia.com^
||cpmstar.com^
||criteo.com^
||criteo.net^
||dianomi.com^
||districtm.io^
||doubleclick.net^
||doubleverify.com^
||ezoic.net^
||fastclick.net^
||flashtalking.com^
||fwmrm.net^
||googleadservices.com^
||googlesyndication.com^
||gumgum.com^
||imrworldwide.com^
||indexww.com^
||inmobi.com^
||innovid.com^
||ironsrc.com^
||jivox.com^
||juicyads.com^
||lijit.com^
||loopme.me^
||media.net^
||mgid.com^
||mopub.com^
||nativeads.com^
||nativo.com^
||nexage.com^
||onetag.com^
||openx.net^
||plista.com^
||popads.net^
||popcash.net^
||propellerads.com^
||pubmatic.com^
||revcontent.com^
||rhythmone.com^
||rubiconproject.com^
||rtbhouse.com^
||serving-sys.com^
||sharethrough.com^
||sizmek.com^
||smaato.com^
||smartadserver.com^
||smartclip.net^
||sonobi.com^
||sovrn.com^
||spotxchange.com^
||springserve.com^
||stickyadstv.com^
||supersonicads.com^
||taboola.com^
||teads.tv^
||tremorhub.com^
||triplelift.com^
||tribalfusion.com^
||undertone.com^
||unityads.unity3d.com^
||unrulymedia.com^
||vungle.com^
||yieldlab.net^
||yieldmo.com^
||zedo.com^
||zemanta.com^
||zergnet.com^

! Analytics, telemetry, attribution, and audience measurement
||adobedtm.com^
||adservice.google.com^
||agkn.com^
||amplitude.com^
||analytics.pinterest.com^
||analytics.tiktok.com^
||analytics.twitter.com^
||appsflyer.com^
||bat.bing.com^
||bluekai.com^
||branch.io^
||chartbeat.com^
||clarity.ms^
||clicky.com^
||crazyegg.com^
||crwdcntrl.net^
||demdex.net^
||everesttech.net^
||exelator.com^
||fullstory.com^
||getclicky.com^
||google-analytics.com^
||googletagmanager.com^
||heap.io^
||hotjar.com^
||kissmetrics.com^
||krxd.net^
||mathtag.com^
||mc.yandex.ru^
||mc.yandex.com^
||metrika.yandex.ru^
||mixpanel.com^
||ml314.com^
||moatads.com^
||mouseflow.com^
||mxpnl.com^
||nr-data.net^
||omtrdc.net^
||optimizely.com^
||outbrain.com^
||parsely.com^
||pingdom.net^
||quantserve.com^
||quantcount.com^
||rlcdn.com^
||scorecardresearch.com^
||segment.io^
||statcounter.com^
||static.ads-twitter.com^
||tapad.com^
||tealiumiq.com^
||turn.com^
||visualwebsiteoptimizer.com^
||vwo.com^
||webtrends.com^

! Social pixels and mobile attribution
||ads.linkedin.com^$third-party
||ads.pinterest.com^$third-party
||ads.tiktok.com^$third-party
||ads.twitter.com^$third-party
||adjust.com^$third-party
||business-api.tiktok.com^$third-party
||connect.facebook.net^
||ct.pinterest.com^$third-party
||kochava.com^$third-party
||pangle.io^$third-party
||pixel.facebook.com^
||px.ads.linkedin.com^
||singular.net^$third-party
||tr.snapchat.com^$third-party
||ads-twitter.com^

! Scoped script pixels. Path rules are subresource-only by default.
||sc-static.net/scevent.min.js$script,third-party

! Content-level tracking endpoints. Excluding the owning site keeps its own
! first-party requests working while still blocking the pixel on other sites.
||facebook.com/tr^$domain=~facebook.com
||linkedin.com/px^$domain=~linkedin.com

! Generic URL patterns. These are subresource-only because they have no host
! anchor. Add $document only for a rule proven safe to apply to pages.
/pagead/
/adsbygoogle
googleads.
/adserver
/adservice
/banner_ad
/popunder
/gtag/js
/fbevents.js
/tracking-pixel
/tracking_pixel
/trackingpixel
/pixel.gif
/1x1.gif
/prebid

! Deliberate top-level click-through exceptions. Subresources on these hosts
! remain blocked; only an intentional page navigation is allowed.
@@||doubleclick.net^$document
@@||googleadservices.com^$document
`;
