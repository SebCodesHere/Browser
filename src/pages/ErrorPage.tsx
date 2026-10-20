import type { PageError, TabState } from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import { ArrowLeft, Home, Onion, Reload, ShieldAlert, WifiOff } from "../components/Icons";
import { prettyUrl } from "../lib/format";

export function ErrorPage({ tab }: { tab: TabState }) {
  const { openInternal, notify } = useBrowser();
  const error: PageError =
    tab.error ??
    ({
      kind: "crash",
      code: "renderer_crashed",
      title: "This page stopped responding",
      description: "Chromium's renderer ended unexpectedly. Reload to start a fresh process.",
      url: tab.url,
      retryable: true
    } satisfies PageError);

  const icon =
    error.kind === "certificate" || error.kind === "proxy" ? (
      <ShieldAlert size={30} />
    ) : error.kind === "network" ? (
      <WifiOff size={30} />
    ) : (
      <Onion size={30} />
    );

  return (
    <div className="error-page">
      <div className="error-glow" aria-hidden="true" />
      <div className="error-card">
        <span className={`error-icon kind-${error.kind}`}>{icon}</span>
        <span className="eyebrow">
          {error.kind === "proxy"
            ? "Tor connection"
            : error.kind === "certificate"
              ? "Certificate warning"
              : error.kind === "blocked"
                ? "Blocked by Xuvon"
                : "Page unavailable"}
        </span>
        <h1>{error.title}</h1>
        <p className="error-description">{error.description}</p>
        <div className="error-url">{prettyUrl(error.url)}</div>
        {error.kind === "proxy" ? (
          <div className="error-hint">
            <Onion size={16} />
            <span>
              Xuvon fails closed. If Tor is unavailable, this tab will not silently connect to the
              clear web without it.
            </span>
          </div>
        ) : null}
        <div className="error-actions">
          {error.retryable ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void window.xuvon.tabs.reload(tab.id).catch((cause) => notify({ tone: "error", message: String(cause) }))}
            >
              <Reload size={16} />
              Try again
            </button>
          ) : null}
          {tab.canGoBack ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void window.xuvon.tabs.back(tab.id)}
            >
              <ArrowLeft size={16} />
              Go back
            </button>
          ) : null}
          <button type="button" className="secondary-button" onClick={() => void openInternal("xuvon://newtab")}>
            <Home size={16} />
            New tab
          </button>
        </div>
        <p className="error-fineprint">
          Error code {String(error.code)}. Xuvon does not bypass certificate or proxy errors.
        </p>
      </div>
    </div>
  );
}
