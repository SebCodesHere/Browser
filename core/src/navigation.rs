use crate::error::{CoreError, CoreResult};
use crate::settings::{self, is_internal_url, Settings};
use crate::tor;
pub use crate::tor::is_onion_host;
use serde::{Deserialize, Serialize};
use url::Url;

const MAX_INPUT: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NavigationMode {
    Normal,
    Private,
    Tor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NavigationKind {
    Url,
    Search,
    Internal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub kind: NavigationKind,
    pub url: String,
    pub display_url: String,
    pub provider_name: Option<String>,
    pub is_local: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveRequest {
    pub input: String,
    #[serde(default = "default_mode")]
    pub mode: NavigationMode,
}

fn default_mode() -> NavigationMode {
    NavigationMode::Normal
}

pub fn resolve(settings: &Settings, input: &str, _mode: NavigationMode) -> CoreResult<Resolution> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(CoreError::invalid_params(
            "Enter an address or search query",
        ));
    }
    if trimmed.len() > MAX_INPUT {
        return Err(CoreError::invalid_params("Address is too long"));
    }
    if trimmed.chars().any(|character| character.is_control()) {
        return Err(CoreError::invalid_params(
            "Address contains unsupported control characters",
        ));
    }

    if trimmed.starts_with("xuvon://") {
        if !is_internal_url(trimmed) {
            return Err(CoreError::invalid_url("Unknown Xuvon internal page"));
        }
        let route = trimmed
            .trim_start_matches("xuvon://")
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("newtab");
        let url = format!("xuvon://{route}");
        return Ok(Resolution {
            kind: NavigationKind::Internal,
            display_url: url.clone(),
            url,
            provider_name: None,
            is_local: true,
        });
    }

    if let Some((scheme, _)) = explicit_scheme(trimmed) {
        if scheme == "http" || scheme == "https" {
            let url = Url::parse(trimmed)
                .map_err(|_| CoreError::invalid_url("This address is not a valid URL"))?;
            if url.host_str().is_none() {
                return Err(CoreError::invalid_url("This address is missing a host"));
            }
            tor::ensure_no_onion(url.host_str())?;
            return Ok(Resolution {
                display_url: url.to_string(),
                url: url.to_string(),
                kind: NavigationKind::Url,
                provider_name: None,
                is_local: is_local_host(url.host_str().unwrap_or_default()),
            });
        }
        return Err(CoreError::unsupported_scheme(&scheme));
    }

    // Bare host:port or a conventional domain is navigated to directly.
    if looks_like_host(trimmed) {
        let candidate = prepare_host_candidate(trimmed);
        let (host, is_local) = candidate_host(&candidate);
        tor::ensure_no_onion(Some(&host))?;
        if let Ok(url) = Url::parse(&candidate) {
            if url.host_str().is_some() {
                return Ok(Resolution {
                    display_url: url.to_string(),
                    url: url.to_string(),
                    kind: NavigationKind::Url,
                    provider_name: None,
                    is_local,
                });
            }
        }
    }

    let providers = settings::providers_for(settings);
    let provider = settings::provider_for(&providers, &settings.search_provider);
    let url = settings::search_url(settings, trimmed)?;
    Ok(Resolution {
        kind: NavigationKind::Search,
        display_url: url.clone(),
        url,
        provider_name: provider.map(|provider| provider.name.clone()),
        is_local: false,
    })
}

pub fn validate_web_url(input: &str) -> CoreResult<Url> {
    let trimmed = input.trim();
    if trimmed.len() > MAX_INPUT {
        return Err(CoreError::invalid_url("URL is too long"));
    }
    let url = Url::parse(trimmed).map_err(|_| CoreError::invalid_url("URL is invalid"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CoreError::invalid_url(
            "Only HTTP and HTTPS URLs are supported",
        ));
    }
    if url.host_str().is_none() {
        return Err(CoreError::invalid_url("URL is missing a host"));
    }
    tor::ensure_no_onion(url.host_str())?;
    Ok(url)
}

pub fn is_persistable_web_url(input: &str) -> bool {
    validate_web_url(input).is_ok()
}

fn explicit_scheme(input: &str) -> Option<(String, bool)> {
    let colon = input.find(':')?;
    if colon == 0 || colon > 32 {
        return None;
    }
    let candidate = &input[..colon];
    if !candidate
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        || !candidate.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
        })
    {
        return None;
    }
    let has_authority = input[colon + 1..].starts_with("//");
    let known_bare = matches!(
        candidate.to_ascii_lowercase().as_str(),
        "about"
            | "javascript"
            | "data"
            | "file"
            | "mailto"
            | "tel"
            | "chrome"
            | "view-source"
            | "blob"
            | "ftp"
            | "ws"
            | "wss"
    );
    if has_authority || known_bare {
        Some((candidate.to_ascii_lowercase(), has_authority))
    } else {
        None
    }
}

fn looks_like_host(input: &str) -> bool {
    if input.contains(char::is_whitespace) {
        return false;
    }
    let candidate = input.split(['/', '?', '#']).next().unwrap_or(input).trim();
    if candidate.is_empty() {
        return false;
    }
    let lower = candidate.to_ascii_lowercase();
    if lower == "localhost"
        || lower.starts_with("localhost:")
        || lower.starts_with("127.")
        || lower == "[::1]"
        || lower.starts_with("[::1]:")
    {
        return true;
    }
    if candidate.starts_with('[') {
        return candidate.contains("]:") || candidate.ends_with(']');
    }
    let host = host_without_port(candidate);
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    if host.parse::<std::net::Ipv6Addr>().is_ok() {
        return true;
    }
    host.contains('.') && !host.starts_with('.') && !host.ends_with('.')
}

fn host_without_port(candidate: &str) -> &str {
    if let Some((host, port)) = candidate.rsplit_once(':') {
        if !port.is_empty() && port.chars().all(|character| character.is_ascii_digit()) {
            return host;
        }
    }
    candidate
}

fn prepare_host_candidate(input: &str) -> String {
    let mut candidate = input.trim().to_string();
    let lower_host = candidate
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(&candidate)
        .to_ascii_lowercase();
    if lower_host == "localhost"
        || lower_host.starts_with("localhost:")
        || lower_host.starts_with("127.")
        || lower_host.starts_with("[::1]")
    {
        candidate = format!("http://{candidate}");
    } else {
        candidate = format!("https://{candidate}");
    }
    candidate
}

fn candidate_host(candidate: &str) -> (String, bool) {
    if let Ok(url) = Url::parse(candidate) {
        let host = url.host_str().unwrap_or_default().to_string();
        let is_local = is_local_host(&host);
        (host, is_local)
    } else {
        (String::new(), false)
    }
}

pub fn is_local_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return true;
    }
    if let Ok(address) = host.parse::<std::net::Ipv4Addr>() {
        return address.is_loopback() || address.is_private() || address.is_link_local();
    }
    if let Ok(address) = host.parse::<std::net::Ipv6Addr>() {
        return address.is_loopback() || address.is_unicast_link_local();
    }
    false
}

pub fn normalize_display_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.starts_with("xuvon://") {
        return trimmed.to_string();
    }
    if let Ok(parsed) = Url::parse(trimmed) {
        let mut display = parsed.to_string();
        if display.ends_with('/') && parsed.path() == "/" && parsed.query().is_none() {
            display.pop();
        }
        display
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{Settings, Theme};

    fn settings() -> Settings {
        Settings {
            search_provider: "duckduckgo".into(),
            ..Settings::default()
        }
    }

    #[test]
    fn resolves_https_and_search() {
        let settings = settings();
        let direct = resolve(&settings, "example.com", NavigationMode::Normal).unwrap();
        assert_eq!(direct.url, "https://example.com/");
        assert_eq!(direct.kind, NavigationKind::Url);

        let search = resolve(&settings, "privacy focused browser", NavigationMode::Normal).unwrap();
        assert_eq!(search.kind, NavigationKind::Search);
        assert!(search.url.contains("duckduckgo.com"));
        assert!(search.url.contains("privacy+focused+browser"));
    }

    #[test]
    fn resolves_localhost_over_http() {
        let settings = settings();
        let local = resolve(
            &settings,
            "localhost:4321/dashboard",
            NavigationMode::Normal,
        )
        .unwrap();
        assert_eq!(local.url, "http://localhost:4321/dashboard");
        assert!(local.is_local);

        let loopback = resolve(&settings, "127.0.0.1:8080", NavigationMode::Normal).unwrap();
        assert_eq!(loopback.url, "http://127.0.0.1:8080/");
    }

    #[test]
    fn resolves_explicit_http() {
        let settings = settings();
        let resolved = resolve(
            &settings,
            "http://example.com/a?b=c",
            NavigationMode::Normal,
        )
        .unwrap();
        assert_eq!(resolved.kind, NavigationKind::Url);
        assert_eq!(resolved.url, "http://example.com/a?b=c");
    }

    #[test]
    fn rejects_dangerous_schemes() {
        let settings = settings();
        for input in [
            "javascript:alert(1)",
            "data:text/html,hello",
            "file:///etc/passwd",
            "view-source:https://example.com",
        ] {
            assert!(
                resolve(&settings, input, NavigationMode::Normal).is_err(),
                "{input}"
            );
        }
    }

    #[test]
    fn blocks_onion_destinations() {
        let settings = settings();
        let error =
            resolve(&settings, "https://example.onion", NavigationMode::Normal).unwrap_err();
        assert_eq!(error.code, "blocked_onion");
        let error = resolve(&settings, "abc.onion", NavigationMode::Normal).unwrap_err();
        assert_eq!(error.code, "blocked_onion");
        let error = resolve(&settings, "http://abc.onion/path", NavigationMode::Tor).unwrap_err();
        assert_eq!(error.code, "blocked_onion");
    }

    #[test]
    fn internal_pages_are_allowlisted() {
        let settings = settings();
        let page = resolve(
            &settings,
            "xuvon://settings/appearance",
            NavigationMode::Normal,
        )
        .unwrap();
        assert_eq!(page.kind, NavigationKind::Internal);
        assert_eq!(page.url, "xuvon://settings");
        assert!(resolve(&settings, "xuvon://hack", NavigationMode::Normal).is_err());
    }

    #[test]
    fn search_provider_template_is_honored() {
        let mut settings = settings();
        settings.custom_search_name = "Test".into();
        settings.custom_search_url = "https://search.example/?q=%s".into();
        settings.search_provider = "custom".into();
        let resolved = resolve(&settings, "rust browser", NavigationMode::Normal).unwrap();
        assert_eq!(resolved.kind, NavigationKind::Search);
        assert_eq!(resolved.url, "https://search.example/?q=rust+browser");
        assert_eq!(resolved.provider_name.as_deref(), Some("Test"));
    }

    #[test]
    fn local_host_detection() {
        assert!(is_local_host("localhost"));
        assert!(is_local_host("192.168.1.1"));
        assert!(is_local_host("10.0.0.8"));
        assert!(is_local_host("::1"));
        assert!(!is_local_host("example.com"));
        assert!(!is_local_host("8.8.8.8"));
    }

    #[test]
    fn theme_enum_roundtrips() {
        let json = serde_json::to_string(&Theme::Dark).unwrap();
        assert_eq!(json, "\"dark\"");
    }
}
