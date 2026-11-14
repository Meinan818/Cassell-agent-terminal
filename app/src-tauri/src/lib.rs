mod agent;
mod browser;
mod run_state;
mod dsml;
mod engine;
mod frozen;
mod fsutil;
mod goal;
mod lore;
mod models;
mod pty;
mod sandbox;
mod settings;
mod shell;
mod text;
mod usage;

use run_state::RunState;
use settings::Settings;
use tauri::AppHandle;

/// Windows 上 spawn 子进程时不弹控制台窗口（CREATE_NO_WINDOW）。
/// 不加这个 flag 时，Windows 会为每个子进程（cmd /C、git、codex CLI）
/// 短暂弹出一个终端窗口。Linux 上是空操作。
#[cfg(windows)]
pub(crate) fn hide_console(cmd: &mut tokio::process::Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW = 0x08000000
    cmd.as_std_mut().creation_flags(0x08000000);
}

#[cfg(not(windows))]
pub(crate) fn hide_console(_cmd: &mut tokio::process::Command) {}

#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    settings::load_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings::save_settings(&app, &settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(RunState {
            native_cancel: std::sync::atomic::AtomicBool::new(false),
            native_running: std::sync::atomic::AtomicBool::new(false),
            approvals: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            session_approvals: tokio::sync::Mutex::new(std::collections::HashSet::new()),
            goals: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            session_usage: tokio::sync::Mutex::new(crate::usage::UsageStats::default()),
        })
        .manage(browser::BrowserState::default())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            run_state::cancel_run,
            agent::run_agent_native,
            agent::resolve_approval,
            agent::test_provider,
            agent::list_models,
            agent::pick_folder,
            agent::get_usage_stats,
            goal::list_checkpoints_cmd,
            goal::rewind_checkpoint_cmd,
            goal::clear_goal_cmd,
            goal::purge_goal_data_cmd,
            fsutil::list_files,
            fsutil::read_file,
            fsutil::read_file_base64,
            fsutil::get_review,
            fsutil::revert_file,
            fsutil::commit_files,
            shell::run_shell,
            browser::browser_open,
            browser::browser_navigate,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_set_rect,
            browser::browser_show,
            browser::browser_hide,
            browser::browser_close,
            browser::browser_current,
            browser::browser_screenshot,
            engine::journal::read_engine_journal,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_snapshot,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
