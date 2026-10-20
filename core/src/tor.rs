use crate::error::{CoreError, CoreResult};
use url::Url;

/// Validate and normalize a local SOCKS5 endpoint used for Tor routing.
/// Credentials and non-SOCKS5 schemes are rejected so the browser can apply a
/// single, predictable fail-closed proxy configuration.
pub fn normalize_proxy(input: &str) -> CoreResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(CoreError::invalid_params("A SOCKS5 proxy URL is required"));
    }
    let parsed =
        Url::parse(trimmed).map_err(|_| CoreError::invalid_params("Tor proxy URL is invalid"))?;
    if parsed.scheme() != "socks5" {
        return Err(CoreError::invalid_params(
            "Tor proxy must use the socks5:// scheme",
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(CoreError::invalid_params(
            "Authenticated SOCKS5 proxies are not supported",
        ));
    }
    if parsed.path() != "/" && !parsed.path().is_empty() {
        return Err(CoreError::invalid_params(
            "Tor proxy must not include a path",
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(CoreError::invalid_params(
            "Tor proxy must not include a query or fragment",
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| CoreError::invalid_params("Tor proxy host is missing"))?;
    let port = parsed
        .port()
        .ok_or_else(|| CoreError::invalid_params("Tor proxy port is required"))?;
    let bare_host = host.trim_start_matches('[').trim_end_matches(']');
    let host = if bare_host.contains(':') {
        format!("[{bare_host}]")
    } else {
        bare_host.to_string()
    };
    Ok(format!("socks5://{host}:{port}"))
}

/// Xuvon deliberately blocks onion destinations. The product routes eligible
/// clear-web traffic only; it is not an onion-service browser.
pub fn is_onion_host(host: &str) -> bool {
    let normalized = host.trim_end_matches('.').to_ascii_lowercase();
    normalized == "onion" || normalized.ends_with(".onion")
}

pub fn ensure_no_onion(host: Option<&str>) -> CoreResult<()> {
    if host.is_some_and(is_onion_host) {
        return Err(CoreError::blocked_onion());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_local_socks5() {
        assert_eq!(
            normalize_proxy(" socks5://127.0.0.1:9050 ").unwrap(),
            "socks5://127.0.0.1:9050"
        );
        assert_eq!(
            normalize_proxy("socks5://[::1]:9050").unwrap(),
            "socks5://[::1]:9050"
        );
    }

    #[test]
    fn rejects_unsafe_proxy_forms() {
        assert!(normalize_proxy("http://127.0.0.1:9050").is_err());
        assert!(normalize_proxy("socks5://127.0.0.1").is_err());
        assert!(normalize_proxy("socks5://user:pass@127.0.0.1:9050").is_err());
        assert!(normalize_proxy("socks5://127.0.0.1:9050/path").is_err());
    }

    #[test]
    fn detects_onion_destinations() {
        assert!(is_onion_host("abc.onion"));
        assert!(is_onion_host("ABC.ONION."));
        assert!(is_onion_host("onion"));
        assert!(!is_onion_host("notonion.com"));
        assert!(!is_onion_host("onion.example.com"));
        assert!(ensure_no_onion(Some("x.onion")).is_err());
        assert!(ensure_no_onion(Some("example.com")).is_ok());
    }
}
