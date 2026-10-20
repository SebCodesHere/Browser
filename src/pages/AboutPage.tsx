import { useBrowser } from "../BrowserContext";
import {
  Code,
  External,
  Globe,
  Lock,
  Onion,
  ShieldCheck,
  Sparkles,
  XuvonMark
} from "../components/Icons";
import { PageShell, Section } from "../components/Ui";

export function AboutPage() {
  const { app, settings, openDataDirectory, openInternal } = useBrowser();

  return (
    <PageShell
      eyebrow="About"
      title="Xuvon Browser"
      intro="旭文瀏覽器 — a quieter, privacy-first window onto the web. Made by one person, with care, for people who want fewer detectors."
      className="about-page"
    >
      <div className="about-hero panel">
        <div className="about-mark">
          <XuvonMark size={74} />
        </div>
        <div className="about-hero-copy">
          <span className="eyebrow">Version {app?.version ?? "0.1.0"}</span>
          <h2>A browser that keeps its promises small and real.</h2>
          <p>
            Xuvon pairs Chromium's rendering engine with a typed Rust core. The interface is a custom
            React layer, not a reskinned stock browser. Privacy controls are enforced at the Electron
            session boundary and recorded by Rust, not decorative switches.
          </p>
          <div className="about-chips">
            <span><ShieldCheck size={14} /> Local-first data</span>
            <span><Lock size={14} /> HTTPS validation</span>
            <span><Onion size={14} /> Optional Tor clear-web routing</span>
            <span><Sparkles size={14} /> No telemetry</span>
          </div>
        </div>
      </div>

      <div className="ai-disclosure panel">
        <span className="ai-disclosure-icon">
          <Sparkles size={22} />
        </span>
        <div>
          <span className="eyebrow">Made with AI</span>
          <h2>Completely vibecoded.</h2>
          <p>
            Xuvon was made with AI. Its design, Rust core, Electron host, React interface, tests, and
            documentation are completely vibecoded — written through AI assistance and directed, reviewed,
            and tested by Seb. AI-generated software can still contain mistakes, so the test suites and the
            verification notes in the repository are the honest measure of what works.
          </p>
        </div>
      </div>

      <div className="two-column">
        <Section title="Under the glass" description="The honest architecture." compact>
          <div className="architecture-list">
            <div className="architecture-row">
              <span className="arch-icon mint"><Code size={18} /></span>
              <div>
                <strong>Rust core</strong>
                <p>Owns settings, bookmarks, history, downloads metadata, navigation resolution, privacy policy, workspace persistence, and the extensions registry. Communicates over typed JSON-RPC.</p>
              </div>
            </div>
            <div className="architecture-row">
              <span className="arch-icon sky"><Globe size={18} /></span>
              <div>
                <strong>Chromium renderer</strong>
                <p>Electron {app?.electron ?? "—"} hosts Chromium {app?.chromium ?? "—"} for real web rendering, the network stack, DevTools, downloads, and GPU compositing.</p>
              </div>
            </div>
            <div className="architecture-row">
              <span className="arch-icon peach"><Sparkles size={18} /></span>
              <div>
                <strong>React interface</strong>
                <p>A sandboxed, context-isolated UI with a narrow preload bridge. Website content never receives access to privileged Xuvon APIs.</p>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Privacy boundaries" description="What this build does — and doesn't do." compact>
          <ul className="principles">
            <li>Normal, private, and Tor tabs use separate Chromium sessions. Private and Tor sessions are in memory.</li>
            <li>Private and Tor pages are never written to history. Favicons are suppressed in those modes to avoid UI-origin requests.</li>
            <li>Onion addresses are blocked before DNS, in every mode. Tor routing is for clear-web traffic only.</li>
            <li>Certificate errors are never bypassed. If a Tor circuit cannot be verified, Xuvon fails closed rather than connecting directly.</li>
            <li>This is not an anti-fingerprinting or anonymity suite. Logins, extensions, downloads, and your network can still identify you.</li>
          </ul>
        </Section>
      </div>

      <Section title="Build details" description="Copy this when reporting a problem.">
        <dl className="details-grid">
          <div><dt>Xuvon</dt><dd>{app?.version ?? "—"}</dd></div>
          <div><dt>Electron</dt><dd>{app?.electron ?? "—"}</dd></div>
          <div><dt>Chromium</dt><dd>{app?.chromium ?? "—"}</dd></div>
          <div><dt>Node</dt><dd>{app?.node ?? "—"}</dd></div>
          <div><dt>Platform</dt><dd>{app ? `${app.platform} · ${app.arch}` : "—"}</dd></div>
          <div><dt>Packaged</dt><dd>{app?.isPackaged ? "Yes" : "Development build"}</dd></div>
          <div className="wide"><dt>Data directory</dt><dd>{app?.dataDir ?? "—"}</dd></div>
          <div className="wide"><dt>Log file</dt><dd>{app?.logPath ?? "—"}</dd></div>
          <div className="wide"><dt>Theme</dt><dd>{settings?.theme ?? "system"}</dd></div>
        </dl>
        <div className="about-actions">
          <button type="button" className="secondary-button" onClick={() => void openDataDirectory()}>
            <External size={15} />
            Open data folder
          </button>
          <button type="button" className="secondary-button" onClick={() => void openInternal("xuvon://settings")}>
            Settings
          </button>
        </div>
        <p className="license-note">
          Xuvon's own source is released under the MIT license. The app bundles Chromium, Electron,
          Node.js, React, and other open-source components under their respective licenses. Platform
          packaging is configured for macOS, Windows, and Linux; only macOS has been built and tested in
          this development environment. Windows and Linux builds must be verified on their own machines
          before being treated as supported.
        </p>
      </Section>

      <div className="about-signoff">
        <span className="footer-brand-mark">X</span>
        <p>Made with love by Seb &lt;3</p>
        <span>For the small, quiet corners of the internet.</span>
      </div>
    </PageShell>
  );
}
