//! P0-11③ 内置浏览器：Tauri 2 子 webview。
//!
//! 不要用 `<iframe>`：很多网站禁 framing（X-Frame-Options），
//! 而且 iframe 里的页面 agent 够不着。正确路线是原生子 webview：
//! `Window::add_child` + `WebviewBuilder`（`unstable` feature），
//! 和主界面同一个窗口，Windows 上就是 WebView2 控件。
//!
//! 关键点：
//! - 子 webview 是原生层、不是 DOM 孩子：位置/显隐/大小都要前端
//!   JS 手动同步（窗口 resize、Inspector 开关、页签切换时都要同步位置）。
//!   前端传 CSS 像素（getBoundingClientRect），这里用 LogicalPosition /
//!   LogicalSize，Tauri 自己按窗口缩放换算。
//! - Windows 上同步命令里创建 webview 会死锁，所以创建命令一律 async
//!   （Tauri 异步命令跑在 worker 线程，`add_child` 内部自己
//!   `run_on_main_thread` + 通道等待，不会卡主线程）。
//! - 独立 profile：`data_directory` 指向应用数据目录下的
//!   browser-profile，不带系统浏览器登录态。
//! - `target=_blank` 的链接：新窗口请求直接 Deny，URL 经通道发回，
//!   由后台线程在同一个子 webview 里打开——链接永远留在应用内。
//! - v1 不做：标注模式、CDP 驱动（见调研 §6.4）。

use serde::Serialize;
use std::sync::Mutex;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, Webview, WebviewUrl, Wry};

pub struct BrowserState {
    child: Mutex<Option<Webview<Wry>>>,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserInfo {
    pub open: bool,
    pub url: String,
}

fn normalize_url(raw: &str) -> Result<Url, String> {
    let u = raw.trim();
    if u.is_empty() {
        return Err("网址为空".to_string());
    }
    let with_scheme = if u.contains("://") {
        u.to_string()
    } else {
        format!("https://{u}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| format!("网址打不开：{u}"))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("只支持 http/https 网址，不支持 {other}")),
    }
}

fn profile_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("browser-profile"))
        .unwrap_or_else(|_| std::env::temp_dir().join("cassell-browser-profile"))
}

/// 打开（或复用）内置浏览器并导航到指定 URL。
/// x/y/width/height 是 CSS 像素（前端 getBoundingClientRect 的值）。
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    state: State<'_, BrowserState>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let url = normalize_url(&url)?;
    let mut guard = state.child.lock().map_err(|_| "浏览器状态锁坏了".to_string())?;
    if let Some(child) = guard.as_ref() {
        child
            .navigate(url.clone())
            .map_err(|e| format!("导航失败：{e}"))?;
        child
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("定位失败：{e}"))?;
        child
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| format!("改尺寸失败：{e}"))?;
        child.show().map_err(|e| format!("显示失败：{e}"))?;
        return Ok(url.to_string());
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<Url>();
    let app_load = app.clone();
    let builder = WebviewBuilder::new("inspector-browser", WebviewUrl::External(url.clone()))
        .data_directory(profile_dir(&app))
        // 导航一律放行（应用内浏览器，不做白名单）；地址栏靠下面的事件同步。
        .on_navigation(|_url| true)
        .on_page_load(move |_w, payload| {
            let loading = payload.event() == PageLoadEvent::Started;
            let _ = app_load.emit(
                "browser-event",
                serde_json::json!({
                    "kind": if loading { "loading" } else { "navigated" },
                    "url": payload.url().as_str(),
                    "loading": loading,
                }),
            );
        })
        .on_new_window(move |u, _features| {
            // 新窗口不开出去：URL 发回后台线程，在同一个子 webview 里打开。
            let _ = tx.send(u);
            NewWindowResponse::Deny
        });
    let child = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("创建内置浏览器失败：{e}"))?;
    // 后台线程：接新窗口请求的 URL，在子 webview 里打开。
    let child2 = child.clone();
    std::thread::spawn(move || {
        while let Ok(u) = rx.recv() {
            let _ = child2.navigate(u);
        }
    });
    *guard = Some(child);
    Ok(url.to_string())
}

/// 在已打开的内置浏览器里导航到新 URL。
#[tauri::command]
pub async fn browser_navigate(
    state: State<'_, BrowserState>,
    url: String,
) -> Result<String, String> {
    let url = normalize_url(&url)?;
    let guard = state.child.lock().map_err(|_| "浏览器状态锁坏了".to_string())?;
    let Some(child) = guard.as_ref() else {
        return Err("内置浏览器还没打开".to_string());
    };
    child
        .navigate(url.clone())
        .map_err(|e| format!("导航失败：{e}"))?;
    Ok(url.to_string())
}

#[tauri::command]
pub async fn browser_back(state: State<'_, BrowserState>) -> Result<(), String> {
    with_child(&state, |c| c.eval("history.back()"))?;
    Ok(())
}

#[tauri::command]
pub async fn browser_forward(state: State<'_, BrowserState>) -> Result<(), String> {
    with_child(&state, |c| c.eval("history.forward()"))?;
    Ok(())
}

#[tauri::command]
pub async fn browser_reload(state: State<'_, BrowserState>) -> Result<(), String> {
    with_child(&state, |c| c.reload())?;
    Ok(())
}

/// 前端窗口/面板尺寸变化时同步子 webview 的位置与大小（CSS 像素）。
#[tauri::command]
pub async fn browser_set_rect(
    state: State<'_, BrowserState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    with_child(&state, |c| {
        c.set_position(LogicalPosition::new(x, y))?;
        c.set_size(LogicalSize::new(width, height))?;
        Ok(())
    })
}

#[tauri::command]
pub async fn browser_show(state: State<'_, BrowserState>) -> Result<(), String> {
    with_child(&state, |c| c.show())
}

#[tauri::command]
pub async fn browser_hide(state: State<'_, BrowserState>) -> Result<(), String> {
    with_child(&state, |c| c.hide())
}

/// 彻底关掉子 webview（下次打开重新创建）。
#[tauri::command]
pub async fn browser_close(state: State<'_, BrowserState>) -> Result<(), String> {
    let child = {
        let mut guard = state.child.lock().map_err(|_| "浏览器状态锁坏了".to_string())?;
        guard.take()
    };
    if let Some(c) = child {
        c.close().map_err(|e| format!("关闭失败：{e}"))?;
    }
    Ok(())
}

/// 当前状态：开着没有、在看哪个 URL（前端重挂载时同步用）。
#[tauri::command]
pub async fn browser_current(state: State<'_, BrowserState>) -> Result<BrowserInfo, String> {
    let guard = state.child.lock().map_err(|_| "浏览器状态锁坏了".to_string())?;
    match guard.as_ref() {
        Some(c) => Ok(BrowserInfo {
            open: true,
            url: c.url().map(|u| u.to_string()).unwrap_or_default(),
        }),
        None => Ok(BrowserInfo {
            open: false,
            url: String::new(),
        }),
    }
}

fn with_child<F>(state: &State<'_, BrowserState>, f: F) -> Result<(), String>
where
    F: FnOnce(&Webview<Wry>) -> Result<(), tauri::Error>,
{
    let guard = state.child.lock().map_err(|_| "浏览器状态锁坏了".to_string())?;
    let Some(child) = guard.as_ref() else {
        return Err("内置浏览器还没打开".to_string());
    };
    f(child).map_err(|e| format!("浏览器操作失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_adds_https() {
        assert_eq!(
            normalize_url("github.com").unwrap().as_str(),
            "https://github.com/"
        );
        assert_eq!(
            normalize_url("http://localhost:3000").unwrap().as_str(),
            "http://localhost:3000/"
        );
        assert_eq!(
            normalize_url("  https://example.com/a?b=1  ").unwrap().as_str(),
            "https://example.com/a?b=1"
        );
    }

    #[test]
    fn normalize_url_rejects_non_http() {
        assert!(normalize_url("ftp://example.com").is_err());
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert!(normalize_url("").is_err());
        assert!(normalize_url("not a url at all :::").is_err());
    }
}
