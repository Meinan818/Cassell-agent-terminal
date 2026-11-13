mod agent;
mod codex;
mod fsutil;
mod settings;
mod shell;

use codex::RunState;
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
            child: tokio::sync::Mutex::new(None),
            native_cancel: std::sync::atomic::AtomicBool::new(false),
            native_running: std::sync::atomic::AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            codex::run_agent,
            codex::cancel_run,
            codex::check_codex,
            codex::test_connection,
            agent::run_agent_native,
            agent::test_provider,
            agent::list_models,
            agent::pick_folder,
            fsutil::list_files,
            fsutil::read_file,
            fsutil::get_review,
            fsutil::revert_file,
            shell::run_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
