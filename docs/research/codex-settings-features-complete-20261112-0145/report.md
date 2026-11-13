# OpenAI Codex — Complete Settings & Features Inventory

## Summary

**Answer, verified 2026-11-12 (all official pages read live that day):** Codex is no longer a standalone app — since 9 July 2026 it is **Codex mode inside the ChatGPT desktop app** (alongside Chat and Work), sharing one agent, one `~/.codex/config.toml`, and one ChatGPT account with the CLI, IDE extension, web (`chatgpt.com/codex`) and Codex Cloud. There is **no separate in-app provider/API-key settings UI** in the desktop app: model/provider selection is done via the in-app model picker + `config.toml` (`model`, `model_provider`, `[model_providers.<id>]` with `base_url`/`wire_api="responses"`/`env_key`), opened from Settings → Configuration → Open config.toml. The authoritative settings surface is `config.toml` — the official Configuration Reference (3,289 lines, read in full) lists ~200 keys; this report inventories them all, grouped below, plus the desktop Settings pages, CLI flags/subcommands, env vars, `requirements.toml` (admin), and every slash command (CLI: 60+; desktop app: 28) and feature.

**Confidence:** High for `config.toml`, CLI slash commands, desktop slash commands, desktop Settings, env vars, and IDE `chatgpt.*` settings — all read verbatim from official OpenAI/ChatGPT Learn pages on 2026-11-12. Medium for CLI flags/subcommands: the official `developer-commands` page is JS/interactive tables whose text extraction returned only a stub, so flags/subcommands were verified against two verbatim mirrors of that page (Arantic, `docs.arantic.com/codex/flags`; and the `use-codex` GitHub mirror of the official page) — flagged `†mirror` below. **Two mission-named items do NOT exist as named Codex features:** there is no `/rewind` slash command and no file-state checkpoint/restore, and no named "context dashboard" — context is shown via `/status`, the TUI status line, and `/usage` (see §5).

**Current model names in the docs read:** `gpt-6.1-sol` (example/default in sample config), `gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-terra`; reasoning effort levels `low | medium | high | xhigh | max | ultra` (model-dependent). Model names change frequently — verify against `codex debug models` / the in-app picker at build time.

---

## Findings

### 0. How Codex is organised (needed to place every setting)

| Surface | What it is | Settings live in |
|---|---|---|
| ChatGPT desktop app — Codex mode (macOS, Windows, Linux preview) | Parallel threads, worktrees, visual review, automations, cloud tasks | App Settings pages (§1) + shared `config.toml` (§2) |
| Codex CLI (`@openai/codex`, Rust, Apache-2.0) | Terminal TUI + `codex exec` headless | `config.toml` (§2), flags (§2.4), env vars (§2.5) |
| IDE extension (`openai.chatgpt`: VS Code/Cursor/Windsurf; JetBrains/Xcode native, no install) | Sidebar agent, editor context | `config.toml` + `chatgpt.*` editor keys (§4.1) |
| Web / Codex Cloud (`chatgpt.com/codex`) | Cloud containers from published GitHub environments | Web Codex settings (code review, environments) (§4.2) |
| Mobile / Remote | ChatGPT iOS/Android controlling a Mac/Windows host; SSH hosts | Remote-connections settings (§4.3) |
| SDK / app-server | TS `@openai/codex-sdk`, Python `openai-codex`, JSON-RPC app-server (experimental) | Programmatic (§4.4) |

**Config file locations & precedence (official, `config-basic`):** 1. CLI flags / `-c` overrides → 2. trusted project `.codex/config.toml` (root→cwd, closest wins) → 3. profile `$CODEX_HOME/<name>.config.toml` (`--profile`) → 4. user `~/.codex/config.toml` (`$CODEX_HOME` defaults to `~/.codex`; Windows `%USERPROFILE%\.codex`) → 5. cloud-managed defaults → 6. system `/etc/codex/config.toml` (Unix; `%ProgramData%\OpenAI\Codex\config.toml` on Windows per secondary source) → 7. built-in defaults. Project config is **ignored when the project is untrusted**, and project files **cannot** set provider/auth/notify/profile/telemetry keys: `openai_base_url`, `chatgpt_base_url`, `apps_mcp_product_sku`, `model_provider`, `model_providers`, `notify`, `profile`, `profiles`, `experimental_realtime_ws_base_url`, `otel`. Auth: ChatGPT OAuth (browser/device code) or API key; `codex login` / `logout`. `approval_policy="untrusted"` is retired — remove it; `trust_level="untrusted"` per project remains.

---

### 1. SETTINGS — Codex desktop experience (Codex mode in ChatGPT desktop app)

Source: https://learn.chatgpt.com/docs/reference/settings (read fully) and https://learn.chatgpt.com/docs/developer-settings (read fully). Open via app menu or `Cmd+,` / `Ctrl+,`. **Note:** most agent behaviour is *not* a GUI toggle — the app exposes common controls in-app and defers the rest to `config.toml` (Settings → Configuration → Open config.toml). Where a GUI control maps to a `config.toml` key, the key is given.

#### 1A. General
- **Enter sends prompts** — `Enter` sends, or require `Cmd`/`Ctrl+Enter` (multiline-only or for every prompt). *(Settings)*
- **Prevent sleep while running** — macOS/Linux; local chats continue while away. Maps to `[features] prevent_idle_sleep`. *(Settings)*
- **Follow-up behavior** — message sent while the agent works: **steer** the current run vs **queue** for the next run. *(Settings; IDE: `chatgpt.followUpQueueMode`)*
- **Model picker** — choose model for current chat (in-app; `/model`, `/reasoning` slash commands; `model` in config). *(composer / slash)*
- **Reasoning effort picker** — choose effort for current chat (`/reasoning`; `model_reasoning_effort` in config). *(slash)*
- **Permissions control under composer** — approval presets: **Ask for approval / Auto / Read Only / Approve for me** (auto-review); per-chat. Maps to `approval_policy` + `approvals_reviewer`. *(composer; /permissions in CLI)*
- **IDE context toggle** — turn shared IDE context (open files/selection) on/off from the app composer when desktop app + IDE extension share a project. *(Developer settings; `/ide-context`)*
- **File opener** — choose where file citations open (VS Code etc.; `file_opener`). *(Developer settings)*
- **Command-output amount in chats** — how much command output appears in chats. *(Developer settings)*
- **Terminal-tab default location** — where terminal tabs open by default. *(Developer settings)*

#### 1B. Profile
- **Profile details** — picture, display name, username. *(Settings > Profile)*
- **Activity insights** — lifetime tokens, peak tokens, streaks, longest task, token activity; save/share a profile card with usage highlights (consumer plans). *(Settings > Profile)*
- **Invite a friend / Invite a coworker** — eligible personal plans / Business workspaces; rewards/limits per Invite page. *(Settings > Profile)*

#### 1C. Keyboard shortcuts
- **Keyboard Shortcuts** — review/change/reset bindings; search by command name or by keystroke. *(Settings > Keyboard Shortcuts; full list at Commands page — see §3.5)*

#### 1D. Notifications
- **Turn-completion notifications** — choose when they appear; prompt for notification permission. *(Settings > Notifications; TUI equivalent: `[tui] notifications`, `notification_condition`, `notification_method`)*

#### 1E. Appearance
- **Base theme, accent / background / foreground colours, UI font, code font** — customise app appearance; **share a custom theme** with friends. *(Settings > Appearance)*

#### 1F. Pets
- **Pets** — choose a built-in or custom pet; `/pet`, Show/Hide pet; **Mini** keeps chat controls visible without a pet. *(Settings > Pets)*

#### 1G. Browser
- **Bundled Browser plugin** — install/enable; **browser extension** setup (Chrome/Chromium). *(Settings > Browser)*
- **Agent permissions (per site)** — defaults + per-site exceptions for **Browse / Download / Upload**, each **Requires approval / Always allow / Block**; removing a site resets it to defaults; org-restrictable. Maps to `[browser_use]` config. *(Settings > Browser)*

#### 1H. Computer Use
- **Computer Use settings** — review desktop-app access and preferences; on macOS revoke system access via Screen Recording / Accessibility in macOS Privacy & Security. Includes **Always-allowed apps** list (Windows `computer_use.windows.always_allowed_app_ids`). *(Settings > Computer Use)*

#### 1I. Personalization & Memories
- **Personal instructions (`AGENTS.md`)** — edit personal instructions for the selected machine; repo `AGENTS.md` also applies. *(Settings > Personalization)*
- **Enable Codex memories** — toggle (where available) to carry context from past chats into future work. Maps to `[features] memories=true` + `[memories]`. Not available in EEA/UK/CH at launch. *(Settings > Personalization > Memories)*
- **Suggested prompts** — context-aware follow-ups / tasks to resume on start/return. *(Settings)*

#### 1J. Git (Settings > Git)
- **Review delivery** — **Inline** (run `/review` in current chat when possible) vs **Detached** (separate review chat). *(Developer settings)*
- **Branch naming** — standardise branch names Codex uses. *(Developer settings)*
- **Force pushes** — choose whether Codex uses force pushes. *(Developer settings)*
- **Commit-message prompts / PR-description prompts** — prompts Codex uses to generate commit messages and pull-request descriptions. *(Developer settings)*

#### 1K. MCP, Plugins, Developer mode
- **MCP servers** — enable recommended servers or add your own; OAuth flow starts in-app if required; shared with CLI/IDE via `config.toml` `[mcp_servers]`. *(Developer settings)*
- **Developer mode — Enable full CDP access** — let ChatGPT use Chrome DevTools Protocol for profiling/deeper browser debugging; org-disableable. *(Developer settings)*
- **Plugins** — Plugins tab: install/enable plugins from marketplaces (incl. Computer Use, OpenAI Developers). *(app sidebar; `[plugins]` config)*
- **Skills** — Skills in sidebar: view/explore team skills across projects. *(app sidebar; `/skills`, `$skill-name`)*

#### 1L. Scheduled (Automations), Archived chats, Windows
- **Scheduled** — sidebar inbox for scheduled tasks: active/paused/completed, recent runs, unread indicator; create via chat or `codex://automations`. *(see §3.2)*
- **Archived chats** — list with dates/project context; **Unarchive** restores. *(Settings > Archived chats)*
- **Pop-out chat window + Always on top** — pop a chat into a separate window; keep visible over other apps. *(Settings)*
- **Codex Micro (hardware)** — Settings > Codex Micro: what Agent Keys follow/trigger, Command Keys, analog stick, dial (4 dial modes), lighting/voice, Brightness, Auto-dim 30 s–1 h/off; long-press dial opens settings. *(Codex Micro docs, official)*

#### 1M. Model-provider configuration in the desktop app (mission §1 core)
- **There is no in-app "add provider / base URL / API key" form.** Provider config is `config.toml` only (Settings → Configuration → Open config.toml): `model_provider`, `[model_providers.<id>] name/base_url/wire_api="responses"/env_key[/env_key_instructions]`, plus `model`, `model_reasoning_effort`, `model_catalog_json` (to make custom models appear in the picker). API key is supplied via the env var named by `env_key` (or `~/.codex/auth.json` / command-backed `[model_providers.<id>.auth]`), **not** pasted into `config.toml`. Sign-in choice at first launch: **ChatGPT account** (full features, plan allowance) vs **API Key** (some features restricted/unavailable). Restart the app after editing `config.toml`; existing threads keep their original model/provider. Built-in provider IDs are reserved: `openai`, `ollama`, `lmstudio`, `amazon-bedrock`, `amazon-bedrock-runtime`, `gcp`. *(Config basics/sample/reference; corroborated by multiple first-hand provider guides.)*
- **Cloud settings (web, `chatgpt.com/codex/settings/*`)** — Code Review: per-repo **Automatic review** on/off, **Review trigger**, **Personal preferences → Automatic review**; Security Review: **Auto security review**, **Review** (Follow personal preferences / All PRs), **Trigger** (On PR open / On every push / Whenever code review runs), threat-model context, auto/manual severity thresholds (auto High+Critical, manual Medium+), path overrides; Environments: publish/manage cloud environments from GitHub repos. *(GitHub/Security Review official pages)*

---

### 2. SETTINGS — Codex CLI: `config.toml` (full reference)

Source: https://developers.openai.com/codex/config-reference (3,289 lines, read in full 2026-11-12) and https://developers.openai.com/codex/config-sample (1,344 lines, read in full). Schema: `#:schema https://developers.openai.com/codex/config-schema.json`. One line per key; values in brackets. `[features]` defaults are in §2.3.

#### 2.1 Core model / reasoning / output
| Key | Values / default | What it controls |
|---|---|---|
| `model` | string, e.g. `"gpt-6.1-sol"` | Default model for new sessions |
| `model_provider` | string, default `"openai"` | Provider ID from `[model_providers]` |
| `model_reasoning_effort` | `low\|medium\|high\|xhigh\|max\|ultra` (model-dependent; sample: `"medium"`) | Reasoning effort |
| `plan_mode_reasoning_effort` | string (level) | Reasoning-effort override for Plan mode |
| `model_reasoning_summary` | `auto\|concise\|detailed\|none` | Reasoning-summary detail |
| `model_verbosity` | `low\|medium\|high` | Text verbosity (GPT-5 family, Responses API) |
| `review_model` | string, unset = session model | Model override for `/review` / `codex review` |
| `service_tier` | string, e.g. `"fast"` | Preferred service tier for new turns (`fast` → `priority`) |
| `oss_provider` | `lmstudio\|ollama`, unset = prompt | Default local provider for `--oss` |
| `model_context_window` | number (tokens) | Manual model context-window metadata |
| `model_auto_compact_token_limit` | number (tokens) | Token threshold triggering auto-compaction |
| `model_auto_compact_token_limit_scope` | `total` (default) `\| body_after_prefix` | Whether threshold counts full context or growth after compaction prefix |
| `model_post_turn_compact_threshold_percent` | integer 0–100 (80 in sample; 0/unset = off) | Compact after a final response at this % of usable context |
| `model_catalog_json` | string (path) | Startup-only JSON model-catalog override |
| `tool_output_token_limit` | number (sample 12000) | Tokens stored per tool output |
| `background_terminal_max_timeout` | number ms, default 300000 | Max empty `write_stdin` poll window |
| `thread_unload_delay_secs` | integer ≥0, default 60 | Unload inactive thread after N s with no activity/subscribers |
| `personality` | `none\|friendly\|pragmatic` — **deprecated**; friendly/pragmatic no-op | `none` omits built-in Personality section; `/personality` command removed |
| `developer_instructions` | string | Extra instructions injected before `AGENTS.md` |
| `model_instructions_file` | string (path) | Replace built-in base instructions (renamed from `experimental_instructions_file`) |
| `instructions` | string — reserved, prefer `model_instructions_file`/`AGENTS.md` | (Reserved for future use) |
| `compact_prompt` | string | Inline override of history-compaction prompt |
| `experimental_compact_prompt_file` | string (path) | Load compaction-prompt override from file |
| `project_doc_max_bytes` | number, default 32768 | Max bytes from `AGENTS.md` embedded in first-turn instructions |
| `project_doc_fallback_filenames` | array<string>, default `[]` | Fallbacks when `AGENTS.md` missing |
| `project_root_markers` | array<string>, default `[".git"]` | Filenames marking project root when searching parents |
| `file_opener` | `vscode` (default) `\| vscode-insiders\|windsurf\|cursor\|none` | URI scheme for clickable citations |
| `hide_agent_reasoning` | boolean, default false | Suppress reasoning events (TUI + `exec`) |
| `show_raw_agent_reasoning` | boolean, default false | Surface raw reasoning content when available |
| `check_for_update_on_startup` | boolean, default true | Check for updates on startup |
| `web_search` | `disabled\|cached` (default) `\|indexed\|live` | Web-search mode (cached = OpenAI index, no live fetch; live = `--search`; full-access sandbox defaults to live) |
| `notify` | array<string> (argv) | External notifier program; receives JSON payload |
| `log_dir` | string (path), default `$CODEX_HOME/log` | Log directory; setting it also enables plaintext `codex-tui.log` |
| `sqlite_home` | string (path) | SQLite-backed runtime-state directory |
| `suppress_unstable_features_warning` | boolean | Suppress warning when under-development flags are on |
| `allow_login_shell` | boolean, default true | Allow login-shell semantics for shell tools |
| `allow_symlinked_codex_home` | boolean, default false (macOS) | Allow writable roots under `$CODEX_HOME` to follow symlinks (startup-only, execution host) |
| `goals.max_goal_token_budget` | integer (positive) | Default + max token budget for new goals |
| `auto_review.policy` | string (Markdown) | Replaces default Auto-review policy (managed `guardian_policy_config` wins; blank ignored) |

#### 2.2 Approvals, sandbox, permissions profiles, shell env
| Key | Values / default | What it controls |
|---|---|---|
| `approval_policy` | `on-request` (default) `\| never \| { granular = {...} }` | When Codex pauses for approval (`untrusted` retired; `on-failure` deprecated) |
| `approval_policy.granular.sandbox_approval` | boolean | Allow sandbox-escalation prompts to surface |
| `approval_policy.granular.rules` | boolean | Allow execpolicy `prompt`-rule approvals to surface |
| `approval_policy.granular.mcp_elicitations` | boolean | Allow MCP elicitation prompts to surface |
| `approval_policy.granular.request_permissions` | boolean | Allow `request_permissions` tool prompts to surface |
| `approval_policy.granular.skill_approval` | boolean | Allow skill-script approval prompts to surface |
| `approvals_reviewer` | `user` (default) `\| auto_review` | Who reviews eligible prompts (user vs reviewer subagent = "Approve for me") |
| `sandbox_mode` | `read-only \| workspace-write \| danger-full-access` | Filesystem/network sandbox for commands (sample default shown `read-only`; CLI interactive default is workspace-write per secondary guides — **flag: docs differ by surface**) |
| `default_permissions` | string: `:read-only \| :workspace \| :danger-full-access` or custom name | Named permission profile to apply by default; do not combine with `sandbox_mode`/`[sandbox_workspace_write]` |
| `[sandbox_workspace_write] writable_roots` | array<string>, default `[]` | Extra writable roots beyond cwd |
| `[sandbox_workspace_write] network_access` | boolean, default false | Outbound network inside workspace-write sandbox |
| `[sandbox_workspace_write] exclude_tmpdir_env_var` | boolean, default false | Exclude `$TMPDIR` from writable roots |
| `[sandbox_workspace_write] exclude_slash_tmp` | boolean, default false | Exclude `/tmp` from writable roots |
| `[windows] sandbox` | `mxc \| elevated \| unelevated` | Native Windows sandbox implementation (explicit `mxc` fails if unavailable) |
| `[permissions.<name>] description` | string | Human-readable profile description (not inherited via `extends`) |
| `[permissions.<name>] extends` | string (profile, `:read-only`, `:workspace`; not `:danger-full-access`) | Parent profile applied first; cycles rejected |
| `[permissions.<name>.] filesystem` | table: path/glob → `read\|write\|deny\|table`; `:workspace_roots`, `:minimal` tokens | Filesystem rules for the profile |
| `…filesystem.":workspace_roots".<subpath-or-glob>` | `read\|write\|deny` | Access relative to each workspace root (`"."` = root; `**/*.env` deny) |
| `…filesystem.glob_scan_max_depth` | number ≥1 | Depth for expanding deny-read globs |
| `[permissions.<name>.] workspace_roots.<path>` | boolean | Opt a path into the profile's workspace-root set |
| `[permissions.<name>.] network.enabled` | boolean | Network access for commands in this profile (proxy needed to enforce domain rules) |
| `…network.mode` | `limited \| full` | Network-proxy mode for subprocess traffic |
| `…network.proxy_url` / `socks_url` | string | HTTP / SOCKS5 listener URLs for the profile |
| `…network.enable_socks5` / `enable_socks5_udp` | boolean | SOCKS5 / UDP over SOCKS5 |
| `…network.allow_upstream_proxy` | boolean | Chain through an upstream proxy |
| `…network.allow_local_binding` | boolean | Broader local/private-network access |
| `…network.dangerously_allow_non_loopback_proxy` / `dangerously_allow_all_unix_sockets` | boolean | Non-loopback listeners / arbitrary Unix sockets (tightly controlled envs only) |
| `…network.domains` / `domains.<pattern>` | map `allow\|deny` (exact, `*.`, `**.`, `*`; deny wins) | Domain rules for sandboxed commands |
| `…network.unix_sockets` / `unix_sockets.<path>` | map `allow\|deny` | Unix-socket allowlist overrides |
| `[shell_environment_policy] inherit` | `all` (default) `\| core \| none` | Baseline env inheritance for spawned processes |
| `…ignore_default_excludes` | boolean, default true | Keep KEY/SECRET/TOKEN-named vars (false = auto-filter them) |
| `…set` | map<string,string> | Explicit env values injected after exclusions |
| `…filters` | map pattern → `include\|exclude` | Canonical case-insensitive filters; include = allowlist (don't combine with legacy arrays in same layer) |
| `…exclude` / `…include_only` | array<string> — **legacy** | Old exclusion / allowlist patterns |
| `…experimental_use_profile` | boolean, default false | Run via user shell profile |

#### 2.3 Feature flags `[features]` (toggle via config, `codex --enable/--disable`, or `codex features`)
`apps` true/stable (connectors) · `goals` true/stable (persisted goals + auto-continuation) · `hooks` true/stable (lifecycle hooks; alias `codex_hooks` deprecated) · `fast_mode` true/stable · `ultrafast_mode` true/stable (independent of fast) · `memories` **false**/stable · `multi_agent` true/stable (spawn/send_input/resume/wait/close_agent) · `remote_plugin` true/stable · `shell_snapshot` true/stable · `shell_tool` true/stable · `unified_exec` true/stable (resumable exec; only managed requirements can disable) · `enable_request_compression` true/stable (zstd) · `view_image` true (local image viewer) · `skill_mcp_dependency_install` true/stable · `prefer_mxc` false in CLI (Windows MXC; desktop may enable via rollout) · `prevent_idle_sleep` false/experimental · `code_mode.enabled` false/under development + `code_mode.excluded_tool_namespaces` / `direct_only_tool_namespaces` arrays · `context_management.experimental_mode` boolean (feature not currently available) · `network_proxy` bool|table: `enabled` false, `domains` map, `allow_local_binding` false, `allow_upstream_proxy` true, `dangerously_allow_all_unix_sockets` false, `dangerously_allow_non_loopback_proxy` false, `enable_socks5` true, `enable_socks5_udp` true, `proxy_url` `http://127.0.0.1:3128`, `socks_url` `http://127.0.0.1:8081`, `unix_sockets` map · `rollout_budget` (under development, off): `enabled`, `limit_tokens` (required if on), `reminder_at_remaining_tokens` array, `sampling_token_weight` 1.0, `prefill_token_weight` 1.0 · `web_search` / `web_search_cached` / `web_search_request` **deprecated legacy toggles** · `personality` removed/ignored.

#### 2.4 Other `config.toml` tables
- **Agents `[agents]`:** `enabled` true; `max_concurrent_threads_per_session` number (unset = Codex default); `max_threads` legacy alias; `default_subagent_model` string; `default_subagent_reasoning_effort` string; `interrupt_message` true (record model-visible message on interrupt); `agents.<name>.config_file` path (role TOML layer, relative to declaring file); `agents.<name>.description` string (guidance shown when choosing/spawning that role).
- **Skills `[skills]`:** `max_context_tokens` int (default 2% of context window, cap 10000); `include_instructions` true; `bundled.enabled` true (set false in trusted project config to disable bundled skills there); `config[]` entries `{name|path, enabled}` — last matching rule wins.
- **History `[history]`:** `persistence` `save-all` (default) `| none`; `max_bytes` number (cap, oldest trimmed).
- **TUI `[tui]`:** `animations` true; `auto_recap` true; `disable_paste_burst` false (overrides legacy top-level `disable_paste_burst`); `keymap.<context>.<action>` string|array (contexts: `global, chat, composer, editor, vim_normal, vim_operator, vim_text_object, pager, list, approval`; `[]` unbinds); `model_availability_nux.<model>` int (internal tooltip state); `notification_condition` `unfocused` (default) `| always`; `notification_method` `auto` (default) `| osc9 | bel`; `notifications` bool|array<string> (e.g. `["agent-turn-complete","approval-requested"]`); `presets.<0–9>.input` string (≤8000 UTF-8 bytes, no `!` shell commands) + `.label`; `raw_output_mode` false; `resume_cwd` `current|session` (unset = ask); `show_server_version_notice` true; `show_tooltips` true; `status_line` array<string>|null (default `["model-with-reasoning","context-remaining","current-dir"]`; `[]`/null hides); `terminal_title` array<string>|null (default `["spinner","project"]`; IDs: app-name, project, spinner, status, thread, git-branch, model, task-progress); `theme` string kebab-case (custom `.tmTheme` under `$CODEX_HOME/themes`); `vim_mode_default` false.
- **Memories `[memories]`:** `version` `v1|v2` (fresh home → v2; existing `memories/` → v1); `dual_write` bool; `consolidation_model` string; `consolidation_service_tier` string, default `"default"`; `generate_memories` true; `use_memories` true; `disable_on_external_context` false (alias `no_memories_if_mcp_or_web_search`); `extract_model` string; `max_raw_memories_for_consolidation` 256 (cap 4096); `max_rollout_age_days` 30 (0–90); `max_rollouts_per_startup` 16 (cap 128); `max_unused_days` 30 (0–365); `min_rate_limit_remaining_percent` 25 (0–100); `min_rollout_idle_hours` 6 (1–48).
- **Hooks `[hooks]`:** events `PreModelRequest, PostModelRequest, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, SubagentStart, SubagentStop, UserPromptSubmit, Stop, Interrupt`; per matcher `matcher` (regex); per handler `type="command"`, `command`, `commandWindows` (alias `command_windows`), `timeout`, `statusMessage`, `async` false (SessionEnd always sync), `additionalContextLimit` 2500 (0 = full context). Command + MCP hooks supported; prompt/agent handlers parsed but skipped. Also `hooks.json` sibling file.
- **MCP `[mcp_servers.<id>]`:** `command` (stdio) / `url` (streamable HTTP); `args`, `cwd`, `env` map, `env_vars` array<string|{name, source local|remote}>, `environment_id` default `"local"`; `bearer_token_env_var`; `http_headers` map, `env_http_headers` map, `http_headers_helper` command (prints JSON headers); `auth` `oauth|chatgpt`; `oauth.client_id`, `oauth.client_secret` (needs client_id), `oauth.callback_url`, `oauth.callback_port`, `oauth.scopes`, `oauth_resource`; `enabled` true; `required` false; `startup_timeout_sec` 10.0 (`startup_timeout_ms` alias); `tool_timeout_sec` 60.0; `supports_parallel_tool_calls` false; `enabled_tools` / `disabled_tools` arrays; `startup_readiness` `connection` (default) `| catalog`; `tool_input_schema_max_bytes` 5000; `omit_tools_from` (`direct|deferred|code_mode`); `default_tools_approval_mode` `auto|prompt|writes|approve`; `tools.<tool>.approval_mode`, `tools.<tool>.output_token_limit` (positive, +20% serialisation allowance).
- **Model providers `[model_providers.<id>]`:** `name`; `base_url`; `wire_api` — `"responses"` is the only supported value; `env_key` (env-var *name* holding the key), `env_key_instructions`; `experimental_bearer_token` (discouraged); `requires_openai_auth` false; `request_max_retries` 4 (max 100); `stream_max_retries` 5 (max 100); `stream_idle_timeout_ms` 300000; `supports_websockets`; `supports_standalone_web_search` false (under development); `model_catalog_url` (full Codex-native catalog URL); `query_params` map; `http_headers` / `env_http_headers` maps; `auth.command` (prints token to stdout) + `auth.args`, `auth.cwd`, `auth.timeout_ms` 5000, `auth.refresh_interval_ms` 300000 (0 = refresh only after auth retry) — do not combine with `env_key`/`experimental_bearer_token`/`requires_openai_auth`; `capabilities.external_web_access` bool; `capabilities.remote_compaction` `unsupported|v2`. Built-ins: `openai` (override via `openai_base_url`), `ollama`, `lmstudio`, `amazon-bedrock` (`aws.profile`, `aws.region`), `amazon-bedrock-runtime`, `gcp` (`project_id`, `location` default `global`, `credential_file` ADC path, `base_url`).
- **Auth/login:** `cli_auth_credentials_store` `file` (default) `| keyring | auto | ephemeral`; `chatgpt_base_url` (`https://chatgpt.com/backend-api/`); `openai_base_url`; `forced_chatgpt_workspace_id` UUID; `forced_login_method` `chatgpt|api`; `mcp_oauth_credentials_store` `auto` (default) `| file | keyring`; `mcp_optional_startup_grace_ms` 1000 (0 = per-server timeout); `mcp_oauth_callback_port` int; `mcp_oauth_callback_url` string.
- **Apps/connectors `[apps]`:** per `_default` / `<id>`: `enabled` true, `destructive_enabled`, `open_world_enabled`, `approvals_reviewer` (`user|auto_review`), `default_tools_approval_mode` (`auto|prompt|writes|approve`), `default_tools_enabled`, `omit_tools_from` (`direct|deferred|code_mode`); per tool `apps.<id>.tools.<tool>.enabled`, `.approval_mode`.
- **Plugins `[plugins]`:** `_default.enabled`; `<plugin>.enabled` (`name@marketplace` key); `<plugin>.mcp_servers.<server>.{enabled, enabled_tools, disabled_tools, default_tools_approval_mode, tools.<tool>.approval_mode}`.
- **Marketplaces `[marketplaces.<name>]`: `source` string (git repo / local root), `source_type` `git|local`, `ref` (branch/tag/commit), `sparse_paths` array.
- **Projects `[projects.<path>]`:** `trust_level` `trusted|untrusted`.
- **OTel `[otel]`:** `environment` `"dev"`; `exporter` / `trace_exporter` `none` (default) `| otlp-http | otlp-grpc`; `metrics_exporter` `none|statsig` (default, follows `analytics.enabled`) `| otlp-http | otlp-grpc`; `exporter.<id>.endpoint`, `.protocol` `binary|json`, `.headers`, `.tls.ca-certificate`, `.tls.client-certificate`, `.tls.client-private-key` (same under `trace_exporter.<id>`); `log_agent_responses` false (≤64 KiB), `log_guardian_assessments` false (≤64 KiB), `log_user_prompt` false; `span_attributes` map; `tracestate` map; `tool_result.max_bytes` 2048.
- **Analytics/feedback/notices:** `[analytics] enabled` (false disables built-in Statsig exporter; explicit OTLP exporters stay on); `[feedback] enabled` true (controls `/feedback`); `[notice] hide_full_access_warning, hide_world_writable_warning, hide_rate_limit_model_nudge, hide_gpt5_1_migration_prompt, hide_gpt-5.1-codex-max_migration_prompt, model_migrations` map (old→new).
- **Browser/Computer Use (config):** `[browser_use] allow_history_access`; `browser_use.default_origin_policy` + `browser_use.origins.<origin>` tables with `access|uploads|downloads|full_cdp_access` (`allow|deny`); `[computer_use] default_app_access` `allow|deny`; `computer_use.macos.bundle_ids` map; `computer_use.windows.always_allowed_app_ids` array; `computer_use.windows.aumids` map; `computer_use.windows.exes[]` `{publisher_name, product_name, access, binary_name?}`.
- **Desktop:** `[desktop.custom_file_handlers.<id>]` `command` (required), `args` (default `[]`), `icon` (bundled path / base64 data-URL / file URI / absolute path), `input` `path` (default) `| json_argument | json_stdin`, `label`, `supports_ssh` false — defines an extra **Open in** target in the desktop app (user-level only).
- **Tools:** `tools.web_search` bool | `{context_size low|medium|high, allowed_domains[], location{country,region,city,timezone}}`; `[tool_suggest] discoverables[]` / `disabled_tools[]` (`{type connector|plugin, id}`).

#### 2.4 CLI flags & subcommands †mirror
Source: official `developer-commands` page is JS tables (text extraction returned a stub); the following is verified against Arantic's verbatim mirror (https://docs.arantic.com/codex/flags, read fully) and the `use-codex` GitHub mirror of the official page (https://github.com/hqy-debug/use-codex/blob/HEAD/docs/official/en/developer-commands.md, prose read). Treat as **mirror-verified, not direct-official-text**.
- **Global flags (base `codex`, propagate to most subcommands):** `PROMPT` (optional first instruction); `--cd/-C <path>` (working dir; decides `AGENTS.md` chain + `.codex/` layers); `--add-dir <path>` (repeatable extra writable dir); `--no-alt-screen`; `--remote <ws://|wss://|unix://[PATH]>` + `--remote-auth-token-env <VAR>`; `--model/-m`; `--oss`; `--local-provider lmstudio|ollama`; `--search` (live web search); `--image/-i <path[,…]>`; `--ask-for-approval/-a on-request|never`; `--sandbox/-s read-only|workspace-write|danger-full-access`; `--dangerously-bypass-approvals-and-sandbox` / `--yolo`; `--dangerously-bypass-hook-trust`; `--approve-for-me` / `--not-so-yolo` (auto-review, `on-request` + `workspace-write`); `--config/-c key=value` (repeatable, TOML-parsed); `--profile/-p`; `--enable/--disable <feature>` (repeatable); `--strict-config` (fail on unknown keys — CI); `--no-daemon` (no shared background server; incompatible with `--remote`/`codex agents`).
- **Subcommands:** `codex` (TUI, Stable) · `exec`/`e` (Stable) · `resume` · `fork` · `archive`/`unarchive` · `delete` · `review` · `login`/`logout` · `mcp` · `plugin` + `plugin marketplace` · `features` · `completion` (bash/zsh/fish/power-shell/elvish) · `doctor` · `sandbox` · `update` · `app` (open ChatGPT desktop app, macOS/Windows) · `apply`/`a` (apply latest cloud-chat diff locally) · `cloud`/`cloud-tasks` (Experimental) · `execpolicy` (Experimental) · `remote-control` (Experimental) · `app-server` (Experimental) · `debug models` / `debug prompt-input` / `debug app-server send-message-v2` (Experimental). **Removed in 0.154.0:** `codex mcp-server` + standalone `codex-mcp-server` binary (use app-server instead).
- **`codex exec` flags:** `--json` (JSONL events), `--output-last-message/-o`, `--output-schema`, `--ephemeral` (no session files), `--skip-git-repo-check`, `--ignore-user-config`, `--ignore-rules`, `--color always|never|auto`, `--full-auto` (deprecated alias for `--sandbox workspace-write`); `exec resume [--last|--all] [SESSION_ID] [PROMPT]`; exec runs with approval `never` by default (no prompts).
- **`codex review`:** exactly one of `--uncommitted | --base <branch> | --commit <SHA> [--title] | PROMPT` (or `-` = stdin).
- **`codex login`:** (none) = browser ChatGPT OAuth; `--device-auth`; `--with-api-key` (stdin); `--with-access-token` (stdin); `login status` (exit 0 = logged in). `logout` clears both auth types.
- **`codex mcp`:** `add` (stdio `-- cmd…` or `--url`, `--env KEY=VALUE`, `--bearer-token-env-var`, `--oauth-client-id`, `--oauth-resource`), `list [--json]`, `get`, `remove`, `login [--scopes]`, `logout`.
- **`codex cloud`:** picker; `cloud exec --env <ENV_ID> [--attempts 1–4] "task"`; `cloud list [--env] [--limit 1–20] [--cursor] [--json]`; `codex apply <TASK_ID>` (non-zero if `git apply` fails).
- **`codex sandbox`:** run a command under Codex's sandbox (macOS Seatbelt / Linux Landlock / Windows); `--permission-profile/-P`, `--cd`, `--config`, `--profile`, `--include-managed-config`, macOS `--log-denials`, `--allow-unix-socket <path>`.
- **`codex app-server`:** `--listen stdio://` (default; `--stdio` alias) `| ws://IP:PORT | unix://[PATH]`; `--experimental` (include gated fields in generated schemas); `--code-mode-host wss://…`; `generate-ts` / `generate-json-schema` (secondary source — flag).
- **`codex remote-control`:** `start`/`stop`/`pair` (+`--json`; pair returns `pairingCode`, `manualPairingCode`, `environmentId`, `expiresAt`).
- **`codex features`:** `list` / `enable <name>` / `disable <name>` (persistent in config; does not accept `--profile`). **`codex execpolicy check --rules <file> [--pretty]`** (preview). **`codex doctor`** (install/config/auth/runtime/Git/terminal/app-server/thread health). **`codex update`** (self-update when supported).

#### 2.5 Environment variables (official: https://learn.chatgpt.com/docs/config-file/environment-variables)
`CODEX_HOME` (default `~/.codex`; must already exist) · `CODEX_SQLITE_HOME` (SQLite state; `sqlite_home` config wins) · `CODEX_API_KEY` (non-interactive `exec`/`review`/SDK/remote exec-server; set inline per job) · `CODEX_ACCESS_TOKEN` (ChatGPT/Codex token for trusted automation; pipe to `codex login --with-access-token`) · `OPENAI_FEDERATION_RULE_ID` · `OPENAI_IDENTITY_TOKEN_FILE` (OIDC/SPIFFE JWT-SVID path) · `OPENAI_WORKLOAD_IDENTITY_CONTEXT` (bounded JSON audit identifiers) · `CODEX_CA_CERTIFICATE` (PEM CA bundle; beats `SSL_CERT_FILE`) · `SSL_CERT_FILE` (fallback PEM CA) · `RUST_LOG` (`error|warn|info|debug|trace`, e.g. `codex_core=debug`; `exec` defaults to `error`) · installer-only: `CODEX_NON_INTERACTIVE` (`1|true|yes`), `CODEX_INSTALL_DIR` (default `~/.local/bin`; Windows `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`). Provider keys are **not** fixed vars — each provider names its own via `env_key` (e.g. `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`). Also (mirror only): `VISUAL`/`EDITOR` = editor opened by `Ctrl+G`.

#### 2.6 Admin / managed configuration — `requirements.toml`
Admin-enforced, user-unoverridable; locations: system file (`/etc/codex/requirements.toml`, Windows `%ProgramData%\OpenAI\Codex\requirements.toml`), MDM, or cloud-managed (Agent Security UI / policy API / self-hosted config server `config_server.base_url` + OAuth). Keys (full list in official Configuration Reference, lines 1980–3289): `allowed_approval_policies`, `allowed_approvals_reviewers`, `allowed_chatgpt_workspaces`, `allowed_login_methods` (`chatgpt|api`), `allowed_permission_profiles` (+ `.<name>` bool), `allowed_sandbox_modes`, `allowed_web_search_modes`, `additional_developer_instructions` (≤10,000 tokens), `allow_appshots`, `allow_browser_and_computer_use`, `allow_login_shell`, `allow_managed_hooks_only`, `allow_remote_control`, `application.network.{enabled,domains}`, `application.storage.{default_project_parent, projectless_workspace_root}`, `auto_review.{ignore_rules, required_on_models}`, `browser_use.{allow_global_persistent_approval, allow_history_access, allow_webmcp, default_origin_policy.{access, access_approval_lifetime turn|thread, auto_review, downloads, full_cdp_access, persistent_approval, uploads}, disable_auto_review, extension.request_headers[]}`, `computer_use.{allow_locked_computer_use, allow_persistent_approval, default_app_access, macos.bundle_ids, windows.{aumids, exes[]}}`, `config_server.{base_url, oauth.{authorization_url, token_url, client_id, device_authorization_url, resource, scopes, redirect_port}}`, `enforce_residency` (`us`), `features.*` app-only pins (`api_key_cyber_access_programs, browser_annotation_api, browser_use, browser_use_external, browser_use_full_cdp_access, computer_use, fast_mode, guardian_approval, in_app_browser, in_app_chat, in_app_dictation, in_app_local_automation, in_app_updates, in_app_voice, memories, multi_agent, plugin_sharing, plugins, realtime_conversation, remote_plugin, standalone_web_search, ultrafast_mode, workspace_dependencies`), `guardian_policy_config`, `hooks` (+ `hooks.managed_dir`, `hooks.windows_managed_dir`), `in_app_browser.allow_external_browser_settings_import`, `marketplaces.{allowed_sources.<name>.{source git|host_pattern|local, url, host_pattern, path, ref}, restrict_to_allowed_sources}`, `mcp_servers.<id>.identity.{command.{executable, args[].{match exact|prefix|regex, value, expression}}, url.{…}}`, `models.new_thread.{model, model_reasoning_effort, service_tier}` (managed defaults, not enforcement), `network_proxy` (alias `experimental_network`) `.{enabled, allow_local_binding, allow_upstream_proxy, allowed_domains, denied_domains, domains, review_domains, http_port, socks_port, unix_sockets, dangerously_allow_all_unix_sockets, dangerously_allow_non_loopback_proxy, managed_allowed_domains_only}`, `permissions.filesystem.deny_read`, `permissions.<name>` (admin profiles), `plugins.<plugin>.mcp_servers.<server>.identity`, `remote_sandbox_config[].{hostname_patterns, allowed_sandbox_modes}`, `rules.prefix_rules[].{pattern[].{token|any_of}, decision prompt|forbidden, justification}`, `unsafe_enforce_sqlite_journal_mode`, `windows.{allow_mxc, allowed_sandbox_implementations, require_mxc}`. Precedence: MDM/legacy managed-device > Agent Security > device system requirements file; higher-priority policy wins even if less specific.

---

### 3. FEATURES & SLASH COMMANDS

#### 3.1 CLI slash commands — complete (official: https://learn.chatgpt.com/docs/cli/slash-commands, read in full)
Type `/` in the composer; Tab while running queues a command for the next turn. One line each:
- `/permissions` — set what Codex can do without asking (Auto / Read Only presets, custom profiles; `/permissions <id> [--approval-policy=…] [--reviewer=user|auto_review]`).
- `/ide` — include open files/selection/IDE context in next prompt.
- `/config` — search & change terminal preferences (theme, notifications, shortcuts, text selection); auto-saved.
- `/keymap` — remap TUI keyboard shortcuts; persists to `tui.keymap`.
- `/vim` — toggle Vim mode for composer (`tui.vim_mode_default` for default).
- `/setup-default-sandbox` — set up elevated agent sandbox (Windows only, degraded sandbox).
- `/agents` — agent command center: browse chats, switch agents on connected server (`codex agents` from shell).
- `/subagents` — switch active subagent thread.
- `/apps` — browse apps/connectors, insert as `$app-slug`.
- `/plugins` — browse installed/discoverable plugins (Space toggles an installed plugin).
- `/hooks` — view/manage lifecycle hooks (trust/disable non-managed hooks).
- `/clear [name]` — clear terminal + start fresh chat (unlike `Ctrl+L`, which only clears view).
- `/rename [name]` — rename current chat.
- `/archive` — archive current session (transcript kept; `codex unarchive <SESSION>` restores).
- `/delete` — permanently delete session + descendants (unavailable while running / in side chat).
- `/compact` — summarise visible chat to free tokens (also auto-compacts).
- `/copy` — copy latest response / code block / quote (`Ctrl+O` = latest response).
- `/diff` — show Git diff incl. untracked files.
- `/exit` / `/quit` — exit CLI (aliases).
- `/experimental` — toggle experimental features (e.g. Network proxy, Prevent sleep).
- `/approve` — approve one retry of a recent auto-review denial.
- `/memories` — configure memory use/generation for the chat.
- `/skills` — browse/use skills.
- `/import` — import Claude Code or Cursor setup/projects/chats (≤50 chats, last 30 days).
- `/feedback` — send logs/diagnostics to maintainers (disableable via `feedback.enabled`).
- `/init` — generate `AGENTS.md` scaffold in current directory.
- `/logout` — sign out, clear local credentials.
- `/mcp [verbose]` — list configured MCP tools; `/mcp login <name>` signs in to a server.
- `/mention <path>` — attach a file/folder to the chat.
- `/model [model] [--reasoning=<level>] [--speed=<tier>]` — choose model + reasoning effort.
- `/presets` — save/run prompts or slash commands in numbered slots (`n` save, `s` snapshot model/permissions/title/status-line).
- `/fast [on|off|status]` — toggle model's Fast service tier (catalog-driven; hidden if model has none).
- `/daybreak` — toggle Daybreak cyber-access program (eligible account/model only).
- `/voice [mute|stop|settings]` — start/stop voice conversation (`F8`); choose voice.
- `/plan [prompt]` — switch to plan mode (unavailable while working).
- `/goal [objective]` — set/edit/pause/resume/view/clear persistent goal (≤4,000 chars).
- `/ps` — show background terminals + recent output.
- `/stop` — stop all background terminals (`/clean` alias).
- `/fork` — fork current chat into a new chat (fresh ID; `codex fork` forks a saved session).
- `/app` — continue session in ChatGPT desktop app (macOS/Windows).
- `/side [prompt]` / `/btw` — ephemeral side chat (unavailable inside a side chat / in review mode).
- `/raw [on|off]` — toggle raw scrollback mode (copy-friendly; `Alt+R`, `tui.raw_output_mode`).
- `/resume` — resume saved chat (scopes: Cwd / Repo / All).
- `/new [name]` — start new chat in same CLI session (does not clear terminal).
- `/review` — review working tree (uses `review_model` if set).
- `/status` — session config + token usage (model, approval policy, writable roots, context left; remote address/version if remote).
- `/usage [daily|weekly|cumulative]` — account token usage; redeem an available earned rate-limit reset.
- `/debug-config` — print config-layer + requirements diagnostics.
- `/statusline [items…|--clear]` — configure TUI footer items (model, context, limits, git branch, tokens, session, dir, version).
- `/title [items…|--clear]` — configure terminal title items.
- `/theme` — choose syntax-highlighting theme (persists to `tui.theme`).
- `/pets` / `/pet [off]` — choose/hide terminal pet (built-in or custom).
- `/tui` — choose terminal mode for next launch (scrollback vs fullscreen).
- `/export [file]` — export conversation as Markdown (copy or save).
- `/recap` — generate a summary without compacting context (`tui.auto_recap` controls automatic recaps while unfocused).
- `/cd <path>` — change session working directory (idle primary chat only).
- `/pwd` / `/cwd` — show working directory.
- `/worktree` — start/continue chat in a managed Git worktree.
- `/daemon` — background-server controls (connection, install/update server, restart server).
- `/warnings` — view retained warnings/diagnostics.
- **Composer sigils/shortcuts (not slash):** `@` file search/attach · `!` run shell command · `Tab` queue follow-up while running · `Enter` steer/inject into running turn · `Esc` interrupt · `Esc Esc` (empty composer) backtrack: edit an earlier message and fork from there · `Ctrl+O` copy · `Ctrl+R` prompt-history search · `Ctrl+G` open external editor (`VISUAL`/`EDITOR`) · `Ctrl+L` clear view only.

#### 3.2 Desktop app slash commands — complete, 28 (official: https://learn.chatgpt.com/docs/reference/slash-commands)
`/approve` retry auto-review denial · `/archive` archive chat · `/chat` choose a projectless chat before a new chat · `/cloud` run chat in the cloud (when available) · `/cloud-environment` choose cloud environment · `/compact` compact context · `/fast` toggle Fast tier (when available) · `/feedback` open feedback dialog (logs optional) · `/fork` copy local chat into new local chat or worktree · `/goal` set persistent goal (use `/plan` first) · `/ide-context` turn shared IDE context on/off · `/init` generate `AGENTS.md` · `/local` run chat in selected local project · `/mcp` open MCP status · `/memories` configure memory use/generation (when available) · `/model` choose model · `/new` blank chat in same local workspace (when available) · `/pet` wake/tuck away desktop pet · `/pin` pin/unpin chat (when available) · `/plan` toggle plan mode · `/project` choose project for new chats · `/reasoning` choose reasoning effort · `/rename` rename chat · `/review` code-review mode (uncommitted or vs base branch) · `/side` temporary side chat · `/status` chat ID, context usage, rate limits · `/usage` open usage/billing settings (ChatGPT sign-in) · `/worktree` run chat in a new Git worktree. Plus: `$skill-name` explicitly invokes a skill; enabled skills appear in the slash list; custom prompts appear as `/prompts:<name>`.

#### 3.3 Features — complete inventory (one line each; source in brackets)
- **Parallel threads** — run several Codex chats at once, switch between them (pinned chats `Cmd/Ctrl+1–9`). [App/CLI docs]
- **Run modes: Local / Worktree / Cloud** — local checkout, isolated Git worktree, or OpenAI cloud container; `/local`, `/cloud`, `/worktree`, `/cloud-environment`. [Slash-commands docs; Arantic cloud]
- **Git worktrees** — managed + permanent worktrees; multiple chats in same repo without interfering; Handoff moves work between local checkout and worktree; scheduled tasks can run on dedicated background worktrees. [Automations; Arantic]
- **Visual review / diff pane** — in-thread diff review, inline annotation, per-block accept/revert, commit/push/open PR from the app; `/diff`, `/review`, `codex review`. [App features via secondary; slash docs]
- **Review queue / Scheduled inbox** — finished automations land in a review queue with unread indicators. [Automations]
- **Plan mode** — `/plan`: propose a reviewable multi-step plan + clarifying questions before editing; `plan_mode_reasoning_effort`. [Slash docs]
- **Goal mode** — `/goal`: persistent objective (≤4,000 chars) Codex works toward until verified/paused/needs input; progress row above composer (pause/resume/edit/clear); `goals.max_goal_token_budget`; `[features] goals`. [Slash docs; config]
- **Side chat** — `/side`/`/btw` (CLI) and `/side` (app): ephemeral focused follow-up, main transcript untouched. [Slash docs]
- **Fork** — `/fork` / `codex fork`: branch a chat (new ID), original untouched. [Slash docs]
- **Resume / new / clear / rename / archive / delete** — session lifecycle (see §3.1). [Slash docs]
- **Steer + queue** — Enter while running steers the current turn (0.163+ immediate steering); Tab queues a follow-up for the next turn; Follow-up behavior setting (steer/queue). [Slash docs; Settings; Harness Notes — secondary]
- **Queue/steer in IDE** — `chatgpt.followUpQueueMode` (`queue`/`steer`); `Cmd/Ctrl+Shift+Enter` inverts for one message. [Developer settings]
- **Automations / Scheduled tasks** — standalone (new chat per run) vs in-chat (same context, minute/daily/weekly, custom schedule, RRULE e.g. `RRULE:FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0`); model/reasoning selectable; local project or background worktree; multi-project; skills + plugins usable; `$skill-name` in task prompt; runs unattended under default sandbox (`approval_policy="never"` if allowed, else permission-mode fallback); test runs; natural-language edit; Scheduled sidebar inbox. Local tasks need computer on + app running. **Not** in CLI/IDE management UI. [Automations — official, read fully]
- **Event-triggered scheduled tasks** — Gmail/Slack/GitHub events trigger tasks (web + mobile, eligible plans only; **not** desktop app/CLI/IDE). **Team Tasks** — recurring/event work shared by a team, cloud via service account + app connections (workspace admins). [Automations]
- **Skills** — reusable bundles: `SKILL.md` + optional `scripts/`, `references/`, `assets/`; progressive disclosure (names/descriptions first, full file on selection); invoke via `$skill-name`, `/skills`, or auto-selection; locations `~/.codex/skills` (personal), `.agents/skills` / `.codex/skills` (project); bundled system skills include plan/skill-creator/skill-installer (2025 announcement — date-flagged); `[skills]` config; skills can create/update scheduled tasks. [Skills docs via search; config]
- **Custom prompts** — saved prompts appear as `/prompts:<name>` in the app slash list. [App slash docs]
- **Subagents / multi-agent** — spawn specialised agents in parallel, collect results; tools `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`; custom roles via `[agents.<name>]`; `/agents` command center, `/subagents`, `codex agents`; `[features] multi_agent`. [Config; slash docs]
- **AGENTS.md** — persistent project instructions, read before every session; `/init` scaffolds it; `project_doc_*` controls; Code Review Rules heading steers PR reviews. [Config; slash docs]
- **Memories** — durable cross-thread memory (SQLite-backed, `~/.codex/memories/`); off by default; `/memories`; Personalization toggle. [Config; Memories docs]
- **Context management** — auto-compaction (`model_auto_compact_token_limit`, turn-end `%`), manual `/compact`, `/recap` (summary without compacting), `tui.auto_recap`; context shown via `/status` + status-line items; experimental context management for GPT-6 Astra (Plus/Pro opt-in, notes across windows, not Business/Enterprise/API-key at launch — Arantic, secondary). **No named "context dashboard"** in official docs. [Config; slash docs]
- **Rewind / checkpoints — NOT a named feature:** no `/rewind` command and no file-state checkpoint/restore in the official slash list; the equivalent is `Esc Esc` backtrack (edit an earlier message, fork from there) + Git as undo. One secondary table claimed "`/rewind` restores conversation and file state" — **conflicts with the official list; do not build to it.** [Official slash list; Arantic context]
- **MCP (client)** — connect external tools via stdio/HTTP MCP servers, OAuth login, per-tool approvals; `/mcp`, `codex mcp`, `[mcp_servers]`; Docs MCP (`https://developers.openai.com/mcp`); OpenAI Developers plugin. **Codex as an MCP server was removed in 0.154.0** (use app-server). [Config; slash docs; Developers Digest — secondary]
- **Plugins & marketplaces** — install/manage plugins from Git/local marketplaces (`[marketplaces]`, `codex plugin marketplace add/list/upgrade/remove`); `/plugins`; remote plugin catalog; plugin-bundled MCP servers + hooks; workspace sharing controls (`features.plugin_sharing` in requirements). IDE extension does **not** support plugins. [Config; developer-commands mirror]
- **Apps / connectors** — `$app-slug` attaches an app (Google Drive, Gmail, Calendar, Slack, Figma, GitHub, Linear, etc.); `/apps`; per-app/per-tool enable + approval modes (`auto|prompt|writes|approve`), destructive/open-world hints. [Config; slash docs]
- **Hooks** — scripts at 14 lifecycle events (see §2.4); `hooks.json` or inline `[hooks]`; `/hooks` browser to trust/disable; managed hooks via requirements; `--dangerously-bypass-hook-trust`. [Config]
- **Rules / execpolicy** — `.rules` files (prefix rules: allow/prompt/forbid); `codex execpolicy check`; managed `rules.prefix_rules` (prompt/forbidden only). [Config; developer-commands mirror]
- **Permissions & sandbox** — approval policies, granular approvals, auto-review ("Approve for me"), permission profiles, sandbox modes (Seatbelt macOS / Landlock Linux / Windows MXC|elevated|unelevated), protected paths (`.git`, `.agents`, `.codex`, `.aws` read-only in writable roots), network proxy + domain rules. [Config]
- **Web search** — cached (default, OpenAI index) / indexed / live / disabled; `--search`; `tools.web_search` context size, allowed domains, location. [Config]
- **Built-in browser + Browser Use** — browser pane, agent-driven browsing with per-origin allow/deny (access/uploads/downloads/full CDP), browser extension for existing signed-in tabs, Appshots (`Cmd+Cmd`, `allow_appshots`), Developer mode full CDP. [Settings; config; Commands]
- **Computer Use** — agent operates native desktop apps you allow (macOS bundle IDs, Windows AUMIDs/exes, always-allowed list, Locked Use on macOS); install via Computer Use plugin. [Settings; config]
- **Voice** — `/voice` in CLI (mute/stop/settings, `F8`); ChatGPT Voice + in-app dictation in desktop app (`features.in_app_voice`, `in_app_dictation`); Codex Micro voice controls. [Slash docs; requirements]
- **Image generation / image input** — ask in natural language or `$imagegen` skill; `--image/-i` attachments; `view_image` tool for local images. [App features search; config]
- **Code review (local)** — `/review`, `codex review` (uncommitted / base branch / commit / custom prompt), review_model override, P0/P1-style prioritised findings. [Slash docs]
- **Code review (GitHub cloud)** — connect repo in Codex Cloud; `@codex review` (P0/P1 only), `@codex security review`, `@codex fix the P1 issue`; Automatic review (repo + personal), Review trigger; Code Review Rules in `AGENTS.md`; Security Review (Enterprise/Business/Edu/Pro only, not Plus; auto High+Critical, manual Medium+; threat model; path overrides; triggers On PR open / On every push / Whenever code review runs). [GitHub + Security Review official pages]
- **Codex Cloud** — tasks in OpenAI-hosted containers from published environments (GitHub repos + setup script); start from web/desktop/CLI (`codex cloud exec/list`)/phone/Slack/Teams (`@ChatGPT`, Enterprise Cloud delegation)/Linear/GitHub; `codex apply` pulls the diff locally; per-task own workspace; container-state retention reported as 12 h (Arantic) vs 7 days (Boxes.dev) — **conflicting secondary claims, unverified**. No local files/processes/VPN/browser sign-ins in cloud. [Arantic cloud; agentbuildershq — secondary]
- **Remote / mobile** — Codex Remote: ChatGPT mobile (iOS/Android) starts/steers/approves/reviews work running on a connected Mac/Windows host (host must stay awake, online, signed in); desktop app connects to SSH hosts with chat handoff; `codex remote-control start/stop/pair`; `--remote` to an app-server. [Arantic cloud; agentastic — secondary]
- **Import from other agents** — `/import` (Claude Code / Cursor setup, projects, chats). [Slash docs]
- **Presets** — `/presets`: save prompts/slash commands in slots 0–9 (`tui.presets.<n>`). [Slash docs]
- **Status line / terminal title / theme / pets** — `/statusline`, `/title`, `/theme`, `/pets`; `tui.*` config. [Slash docs]
- **Daemon / app-server** — shared local background server (`/daemon`, `codex agents`); app-server JSON-RPC (thread/turn/item; experimental, not for production workloads); SDKs: TS `@openai/codex-sdk`, Python `openai-codex` (spawn `codex exec`, thread start/resume, event stream). [Slash docs; SDK secondary]
- **Background terminals** — long-running commands in background (`/ps`, `/stop`); unified exec (resumable). [Slash docs]
- **GitHub Action / CI** — `openai/codex-action@v1` runs `codex exec` in workflows (API-key auth, per-token billing — secondary, Continuum). [Continuum — secondary]
- **Pets / Codex Micro** — terminal + desktop pets (built-in/custom, `/pet`); Codex Micro hardware keyboard/dial integration. [Slash docs; Settings]
- **Daybreak** — `/daybreak` cyber-access-program toggle (eligible accounts/models). [Slash docs]

#### 3.4 IDE extension — features & commands
Extension `openai.chatgpt` (VS Code, Cursor, Windsurf); JetBrains + Xcode native. Modes **Chat / Agent / Agent (Full Access)**; editor context (`/ide`, open files/selection); TODO CodeLens (`chatgpt.commentCodeLensEnabled`) + `chatgpt.implementTodo` command; delegate to Codex Cloud from the IDE; open app chat from IDE and vice versa (shared project/chats); Command Palette commands incl. **Codex: Open Codex Sidebar**; slash subset: `/plan, /goal, /compact, /status, /review, /init, /mcp, /memories, /approve, /feedback, /project`. No plugins; profiles (`--profile`) not supported in the IDE (secondary — Daniel Vaughan). [Developer settings; IDE docs via search]

#### 3.5 Desktop app keyboard shortcuts & deep links (official: https://learn.chatgpt.com/docs/reference/commands)
Key macOS defaults (Windows/Linux equivalents in the page): command menu `Cmd+Shift+P`/`Cmd+K`; Settings `Cmd+,`; Open folder (Codex/Work) `Cmd+O`; sidebar `Cmd+B`; bottom panel (Codex) `Cmd+J`; terminal (Codex) `Ctrl+\``; new chat `Cmd+N`; new standalone chat (Codex) `Cmd+Opt+O`; side chat (Codex) `Cmd+Opt+S`; next chat needing attention (Codex) `Cmd+Opt+A`; go to chat 1–9 `Cmd+1–9`; model picker `Ctrl+Shift+M`; switch Chat/Work/Codex `Ctrl+1/2/3`; search files (Codex) `Cmd+P`; file tree (Codex) `Cmd+Shift+E`; review tab (Codex) `Ctrl+Shift+G`; browser tab `Cmd+T`; Appshot `Cmd+Cmd` (simultaneous); copy chat deep link `Cmd+Opt+L`; copy working directory (Codex) `Cmd+Shift+C`; copy conversation path (Codex) `Cmd+Opt+Shift+C`. **Deep links (`codex://`):** `threads/new`, `threads/<thread-id>`, `new?prompt|path|originUrl`, `settings`, `settings/browser-use`, `settings/computer-use/google-chrome`, `settings/connections[/computer|/devices|/ssh|/ssh/add?name=]`, `skills`, `automations`, `plugins/install/<name>?marketplace=`, `plugins/<plugin-id>`, `plugins/<name>?marketplacePath=`, `pets/install?name=&imageUrl=&description=&spriteVersionNumber=`.

---

### 4. Other settings / capabilities — summary table

| Area | Setting / capability | Source |
|---|---|---|
| IDE editor keys (`chatgpt.*`, VS Code settings, never in `config.toml`) | `commentCodeLensEnabled` true · `openOnStartup` false · `followUpQueueMode` `queue\|steer` · `composerEnterBehavior` `enter\|cmdIfMultiline\|cmdAlways` · `runCodexInWindowsSubsystemForLinux` false (Windows) · `cliExecutable` unset (dev only) · `localeOverride` (mirror only — flag) · honours VS Code `chat.fontSize`, `chat.editor.fontSize` | Developer settings (official) |
| Web (chatgpt.com/codex) | Code review + Security Review settings, cloud-environment publish/manage, start/follow tasks, Slack/Teams/Linear entry | GitHub/Security Review pages |
| Mobile/Remote | Codex Remote (phone → Mac/Windows host), SSH hosts + handoff, `codex remote-control`, `--remote` | Arantic cloud (secondary) |
| SDK / app-server | TS + Python SDKs; app-server JSON-RPC experimental; `codex app-server` flags | Developer-commands mirror; SDK secondary |
| Auth | ChatGPT OAuth / device code / API key / access token; `forced_login_method`, `forced_chatgpt_workspace_id`, `allowed_login_methods`, `cli_auth_credentials_store` | Config reference |
| Telemetry | `[otel]`, `[analytics]`, `RUST_LOG`, `log_dir`/`codex-tui.log`, `codex doctor` | Config reference; env page |
| Storage (managed) | `application.storage.default_project_parent`, `application.storage.projectless_workspace_root` (requirements only); state under `CODEX_HOME` (`config.toml`, `auth.json`, `history.jsonl`, `sessions/`, `skills/`, `memories/`, `themes/`, `log/`, `automations/`) | Config reference |

---

## Could not verify / Open questions

1. **`/rewind` / checkpoints:** No `/rewind` in the official CLI slash-command list and no file-state checkpoint feature documented; only `Esc Esc` backtrack + Git. One secondary table claims `/rewind` restores conversation+file state — treat as **unverified/conflicting; do not implement as a Codex feature**.
2. **"Context dashboard":** No such named UI in official docs; context is exposed via `/status`, status-line items, `/usage`. May be a misnomer for the status line / `/status` output.
3. **CLI flags/subcommands:** Official `developer-commands` page is JS/interactive — text extraction returned a stub. Flags/subcommands above are from two verbatim mirrors of that page (Arantic; `use-codex` GitHub mirror). Spot-check with `codex --help` / `codex <cmd> --help` on a real install before treating any single flag as certain.
4. **Desktop app GUI completeness:** The official Settings page is a summary, not an exhaustive screenshot inventory; in-app-only toggles added after 2026-11-12, exact labels in Settings → Configuration / Git / MCP panels, and the full `chatgpt.*` table (the official table was truncated in extraction — `localeOverride` is mirror-only) could not be fully verified without a live signed-in app session. The app is closed-source; no live UI verification was possible (signed-out browsing only).
5. **Sandbox default discrepancy:** Sample config shows `sandbox_mode = "read-only"` while secondary guides describe the interactive default as `workspace-write` ("Auto"). The reference does not state a single global default in the lines read — verify per surface.
6. **Cloud retention:** 12 h container cache (Arantic) vs 7-day saved state (Boxes.dev) — conflicting secondary claims.
7. **Model catalog:** Model IDs (`gpt-6.1-sol` etc.) and effort levels are catalog/plan-dependent and change frequently; the in-app picker / `codex debug models` is the source of truth at build time. GPT-5.5 retirement (14 Oct 2026) and GPT-5.4/5.4-mini retirement (31 Aug 2026) were noted in the docs read.
8. **A failed fetch:** One mirror URL (a proxy of the old `codex/app/features` page) failed to load in `browser_open` and was not retried per runtime instruction; its search-snippet content (automations in background worktrees, skills, image generation, `~/.codex/threads`) is corroborated by the official Automations page read in full, so no material gap remains.

## Sources

**Official — read in full, 2026-11-12 (verified live):**
- https://developers.openai.com/codex/config-reference — Configuration Reference (3,289 lines)
- https://developers.openai.com/codex/config-sample — Sample Configuration (1,344 lines)
- https://developers.openai.com/codex/config-basic — Config basics (precedence, project-trust rules)
- https://learn.chatgpt.com/docs/cli/slash-commands — Slash commands in Codex CLI (868 lines)
- https://learn.chatgpt.com/docs/reference/slash-commands — Slash commands (desktop app, 28)
- https://learn.chatgpt.com/docs/reference/commands — Commands (shortcuts + `codex://` deep links)
- https://learn.chatgpt.com/docs/reference/settings — Settings (desktop app)
- https://learn.chatgpt.com/docs/developer-settings — Developer settings (app + IDE; `?surface=ide` variant also read)
- https://learn.chatgpt.com/docs/automations — Scheduled tasks
- https://learn.chatgpt.com/docs/config-file/environment-variables — Environment variables
- https://learn.chatgpt.com/docs/app — ChatGPT desktop app overview
- https://learn.chatgpt.com/docs/security/security-review — Security Review (via search result)
- https://learn.chatgpt.com/docs/third-party/github — Review GitHub pull requests with Codex (via search result)

**Official — attempted, text extraction limited (JS/interactive tables):**
- https://learn.chatgpt.com/docs/developer-commands?surface=cli — Developer commands / CLI reference (stub only; see §2.4 note)

**Mirrors of official pages (flagged †mirror):**
- https://docs.arantic.com/codex/flags — CLI Flags & Configuration (verbatim mirror of official developer-commands; read fully)
- https://github.com/hqy-debug/use-codex/blob/HEAD/docs/official/en/developer-commands.md — mirror of official developer-commands (prose read)
- https://docs.arantic.com/codex/context — Managing Context (experimental context management, Esc Esc rewind note)
- https://docs.arantic.com/codex/cloud — Codex Cloud & Remote

**First-hand / reputable secondary (used only where flagged):**
- https://www.agentastic.dev/compare/codex-app-vs-cli — app/CLI/cloud/remote comparison (reviewed against official docs 2026-10-05)
- https://codex.danielvaughan.com/2026/04/01/codex-ide-extension-vs-code-jetbrains/ — IDE settings incl. `localeOverride`, profiles gap
- https://www.developersdigest.tech/blog/codex-mcp-server-removed — `codex mcp-server` removal in 0.154.0
- https://learn.chatgpt.com/docs/features/codex-micro — Codex Micro settings (via search result)

**Working notes:** `notes/01-official-config.md`, `notes/02-slash-cli-features.md` (per-source line-level extracts).
