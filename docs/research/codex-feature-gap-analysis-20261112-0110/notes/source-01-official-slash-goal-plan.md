# Source 01 — Official slash commands + Goal/Plan (verified live 2026-11-12)
- URL: https://learn.chatgpt.com/codex/reference/slash-commands (via https://developers.openai.com/codex/cli/slash-commands redirect stub)
- Read: 2026-11-12, browser_open, verified live.
- Desktop app slash list (28): /approve /archive /chat /cloud /cloud-environment /compact /fast /feedback /fork /goal /ide-context /init /local /mcp /memories /model /new /pet /pin /plan /project /reasoning /rename /review /side /status /usage /worktree. Availability varies by environment/access. Skills via `$`, custom prompts as `/prompts:<name>`.
- /goal: "Set a persistent goal for ChatGPT to work toward; use /plan first to shape it." Goal mode: progress row above composer with pause/resume/edit/clear buttons; follow-ups allowed while goal runs.
- /plan: "Toggle plan mode for multi-step planning."
- /fork: "Copy a local chat into a new local chat or worktree." /side: temporary side chat. /compact, /status (chat ID, context usage, rate limits), /review (uncommitted or vs base branch), /init (AGENTS.md scaffold), /mcp (MCP status), /memories, /pet (wake/tuck desktop pet), /fast (catalog Fast tier), /feedback (dialog + optional logs).
- Goal mode detail page: https://learn.chatgpt.com/codex/prompting#goal-mode — "/plan first, then /goal"; Steer vs Queue; default follow-up in Settings > General > Follow-up behavior; queued messages editable/reorderable/deletable above composer; CLI Enter=steer, Tab=queue; Dictate in composer; project chats share files/sources/local folder.

# Source 02 — Using Goals in Codex (official cookbook, verified live 2026-11-12)
- URL: https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- Goals = persistent objectives, thread-scoped persisted state (not global memory, not project instructions). States: active/paused/complete/budget-limited. Continuation only when thread idle, no queued input, no other work pending; plan-only work does NOT trigger continuation; no-tool-call continuation suppresses next auto-continuation. Budget reached -> stop substantive work, summarize + blockers. Model may start a goal and mark complete only with evidence; pause/resume/clear/budget transitions user/system-controlled.
- Lifecycle: /goal <objective>, /goal (view), /goal pause, /goal resume, /goal clear. Available from Codex 0.128.0. Good goal = outcome + verification surface + constraints + boundaries + iteration policy + blocked stop condition.
- Note: /goal edit mentioned in secondary sources; official cookbook lists pause/resume/clear/view only (edit via progress-row button in app per slash page).

# Source 03 — Remote / mobile (official blog, verified live 2026-11-12)
- URL: https://developers.openai.com/blog/mastering-codex-remote-for-engineering
- Remote = ChatGPT mobile app controlling Mac/Windows host: host/workspace/branch/worktree choice, env setup, Queue vs Steer, side chats (/side, Ask in side chat from selected text), Plan vs Goal ("Plans answer How, Goals answer What must be true"), inline diff review + inline comments, permissions (once / chat-scoped / broader), /status (session, workspace, context usage, rate limits), optional context indicator in composer, /compact, /fork, pin/rename/archive chats, notifications open chat, Spotlight/Shortcuts, Face ID, edit latest sent prompt, queued prompts visible, save/copy rendered images, wrap long diff lines.
