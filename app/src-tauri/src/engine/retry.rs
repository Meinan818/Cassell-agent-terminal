//! Retry policy for provider requests.
//!
//! Retry only transient failures: rate limits and upstream 5xx responses, plus
//! connection/timeout errors. Never retry auth, validation or business errors.

use reqwest::{Client, Response, StatusCode};
use serde_json::Value;
use std::time::Duration;

pub const MAX_ATTEMPTS: u32 = 3;

pub fn is_retryable_status(status: StatusCode) -> bool {
    matches!(
        status.as_u16(),
        408 | 429 | 500 | 502 | 503 | 504
    )
}

fn retry_after(response: &Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
}

pub fn delay_for(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(delay) = retry_after {
        return delay.min(Duration::from_secs(30));
    }
    let exp = attempt.saturating_sub(1).min(4);
    Duration::from_millis(350 * 2u64.pow(exp)).min(Duration::from_secs(4))
}

/// Send a JSON request with bounded retries. Returns the last response even
/// when it is a retryable 5xx so the caller can surface the provider's real
/// error instead of a synthetic timeout message.
pub async fn post_json_with_retry<F>(
    client: &Client,
    url: &str,
    api_key: &str,
    body: &Value,
    mut on_retry: F,
) -> Result<Response, reqwest::Error>
where
    F: FnMut(u32, Option<u16>, Duration),
{
    let mut last_error = None;
    for attempt in 1..=MAX_ATTEMPTS {
        let response = client
            .post(url)
            .bearer_auth(api_key)
            .json(body)
            .send()
            .await;
        match response {
            Ok(resp) if is_retryable_status(resp.status()) && attempt < MAX_ATTEMPTS => {
                let status = resp.status();
                let delay = delay_for(attempt, retry_after(&resp));
                drop(resp);
                on_retry(attempt, Some(status.as_u16()), delay);
                tokio::time::sleep(delay).await;
            }
            Ok(resp) => return Ok(resp),
            Err(err) if attempt < MAX_ATTEMPTS && (err.is_timeout() || err.is_connect()) => {
                let delay = delay_for(attempt, None);
                last_error = Some(err);
                on_retry(attempt, None, delay);
                tokio::time::sleep(delay).await;
            }
            Err(err) => return Err(err),
        }
    }
    Err(last_error.expect("retry loop must return a response or error"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_transient_statuses_only() {
        assert!(is_retryable_status(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(StatusCode::BAD_GATEWAY));
        assert!(is_retryable_status(StatusCode::SERVICE_UNAVAILABLE));
        assert!(!is_retryable_status(StatusCode::UNAUTHORIZED));
        assert!(!is_retryable_status(StatusCode::BAD_REQUEST));
    }

    #[test]
    fn backoff_is_bounded_and_honours_retry_after() {
        assert_eq!(delay_for(1, None), Duration::from_millis(350));
        assert_eq!(delay_for(3, None), Duration::from_millis(1400));
        assert_eq!(
            delay_for(1, Some(Duration::from_secs(60))),
            Duration::from_secs(30)
        );
    }
}
