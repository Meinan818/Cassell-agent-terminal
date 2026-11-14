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

#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
#[cfg(windows)]
use webview2_com::CapturePreviewCompletedHandler;

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

fn is_local_host(raw: &str) -> bool {
    let host_port = raw.split('/').next().unwrap_or("");
    let host = host_port
        .strip_prefix('[')
        .and_then(|s| s.split(']').next())
        .unwrap_or_else(|| host_port.split(':').next().unwrap_or(""));
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1" | "0.0.0.0"
    )
}

fn normalize_url(raw: &str) -> Result<Url, String> {
    let u = raw.trim();
    if u.is_empty() {
        return Err("网址为空".to_string());
    }
    // 本地 dev server 默认 http；外网默认 https。别把 localhost 补成
    // https://localhost，普通 Vite/Next dev server 没有 TLS，直接打不开。
    let with_scheme = if u.contains("://") {
        u.to_string()
    } else if is_local_host(u) {
        format!("http://{u}")
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
    // WebView2 的 user data folder 不能放网络路径；Windows 上 Roaming 可能被
    // 组策略重定向到网络共享，优先用 LocalAppData。
    app.path()
        .app_local_data_dir()
        .or_else(|_| app.path().app_data_dir())
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
        // target=_blank 只改成本页跳转：不新开窗口，也不跳系统浏览器。
        // on_new_window 仍保底处理 window.open；这里先处理普通链接。
        .initialization_script(
            r#"(function(){
              document.addEventListener('click', function(e){
                var a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
                if (a && a.href) { e.preventDefault(); window.location.href = a.href; }
              }, true);
            })();"#,
        )
        // 只允许网页导航；外站链接不能把子 webview 导航到 file://、mailto:
        // 或自定义协议。about:blank 留给正常页面的内部跳转。
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about"))
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
            // 新窗口不开出去：只把 http/https 链接发回后台线程，在同一个子
            // webview 里打开；file://、自定义协议一律拒绝。
            if matches!(u.scheme(), "http" | "https") {
                let _ = tx.send(u);
            }
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

/// P0-11③ autoVerify：截取当前内置浏览器页面为 PNG，返回保存路径。
/// Windows 走 WebView2 CapturePreview；其它平台先明确不支持。
#[tauri::command]
pub async fn browser_screenshot(app: AppHandle, state: State<'_, BrowserState>) -> Result<String, String> {
    let child = {
        let guard = state.child.lock().map_err(|_| "浏览器状态锁坏了".to_string())?;
        guard.as_ref().ok_or_else(|| "内置浏览器还没打开".to_string())?.clone()
    };
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    child
        .with_webview(move |webview| {
            #[cfg(windows)]
            {
                use windows::Win32::Foundation::HGLOBAL;
                use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
                use windows::Win32::System::Com::STREAM_SEEK_SET;

                let controller = webview.controller();
                let core = match unsafe { controller.CoreWebView2() } {
                    Ok(c) => c,
                    Err(e) => {
                        if let Some(tx) = tx.lock().unwrap().take() {
                            let _ = tx.send(Err(format!("拿不到 WebView2：{e}")));
                        }
                        return;
                    }
                };
                let stream = match unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true) } {
                    Ok(s) => s,
                    Err(e) => {
                        if let Some(tx) = tx.lock().unwrap().take() {
                            let _ = tx.send(Err(format!("创建截图流失败：{e}")));
                        }
                        return;
                    }
                };
                let read_stream = stream.clone();
                let tx_handler = tx.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |hr| {
                    if hr.is_err() {
                        if let Some(tx) = tx_handler.lock().unwrap().take() {
                            let _ = tx.send(Err(format!("截图失败：{hr:?}")));
                        }
                        return Ok(());
                    }
                    let mut bytes = Vec::new();
                    let mut buf = [0u8; 16 * 1024];
                    unsafe {
                        let _ = read_stream.Seek(0, STREAM_SEEK_SET, None);
                        loop {
                            let mut read: u32 = 0;
                            let r = read_stream.Read(
                                buf.as_mut_ptr() as *mut core::ffi::c_void,
                                buf.len() as u32,
                                Some(&mut read),
                            );
                            if r.is_err() || read == 0 {
                                break;
                            }
                            bytes.extend_from_slice(&buf[..read as usize]);
                        }
                    }
                    if let Some(tx) = tx_handler.lock().unwrap().take() {
                        let _ = tx.send(Ok(bytes));
                    }
                    Ok(())
                }));
                if let Err(e) = unsafe {
                    core.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )
                } {
                    if let Some(tx) = tx.lock().unwrap().take() {
                        let _ = tx.send(Err(format!("发起截图失败：{e}")));
                    }
                }
            }
            #[cfg(not(windows))]
            {
                let _ = webview;
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(Err("浏览器截图目前只支持 Windows".to_string()));
                }
            }
        })
        .map_err(|e| format!("截图调度失败：{e}"))?;
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(5), rx)
        .await
        .map_err(|_| "截图超时（5 秒）".to_string())?
        .map_err(|_| "截图回调丢失".to_string())??;
    if bytes.is_empty() {
        return Err("截图返回空数据".to_string());
    }
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("cassell-agent"))
        .join("verify");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建截图目录失败：{e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("verify-{stamp}.png"));
    std::fs::write(&path, bytes).map_err(|e| format!("写截图失败：{e}"))?;
    Ok(path.to_string_lossy().to_string())
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
            normalize_url("localhost:3000").unwrap().as_str(),
            "http://localhost:3000/"
        );
        assert_eq!(
            normalize_url("127.0.0.1:5173").unwrap().as_str(),
            "http://127.0.0.1:5173/"
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
