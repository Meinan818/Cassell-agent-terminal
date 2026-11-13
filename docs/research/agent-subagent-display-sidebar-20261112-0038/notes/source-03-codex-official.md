# Codex — official docs (via mirror + learn.chatgpt.com, index 2026-11-12)
## Subagents doc (mirror of official OpenAI docs)
URL: https://github.com/hqy-debug/use-codex/blob/HEAD/docs/official/en/agent-configuration/subagents.md
Note: GitHub mirror of learn.chatgpt.com docs (page itself says complete index at learn.chatgpt.com llms.txt, .md twins). Treat as second-hand copy of official text, not openai.com itself.
- Subagent activity appears in ChatGPT desktop app, Codex CLI, IDE extension. Enabled by default in current Codex releases; consumes more tokens.
- App chat: "app surfaces each subagent thread so you can inspect its work and the summary returned to the main chat."
- IDE: "When the background-agent UI is available, active subagents appear above the composer. Expand the panel to see their status, stop all active subagents, or open an individual subagent thread."
- Managing subagents: "Open Subagents to see read-only Active and Done lists. Select a completed subagent to inspect its details and result. The web sidebar reports subagent activity; it doesn't provide controls to stop or steer an individual subagent." / "Open a subagent thread from the activity shown in the main thread to inspect its work." / "Ask Codex directly to steer a running subagent, stop it, or close completed subagent threads." / CLI: /agent to inspect/switch between agent threads.
- Illustrations (not visible in text fetch): "Codex desktop chat showing two subagents working in parallel" and "Codex desktop Subagents panel with no active subagents and three completed audits."
- Subagents inherit parent model/reasoning effort unless configured; custom agents in ~/.codex/agents/ or .codex/agents/ with name/description/developer_instructions, model, model_reasoning_effort, sandbox_mode. Built-ins: default, worker, explorer. [agents] max_concurrent_threads_per_session etc.
- Approvals: approval overlay shows source thread label, press o to open that thread before approve/reject.
- No per-subagent token/cost display documented here; usage via /status (context fullness, rate limits) and /usage (billing) per secondary meowdoro guide.

## Code review — official learn.chatgpt.com (index)
URL: https://learn.chatgpt.com/docs/code-review?surface=app
- Desktop app includes Code Review; pin it to app sidebar from installed plugins.
- View a PR: open Code Review from sidebar; Summary = description, activity, comments, checks; Changes = changed files + comments alongside diff; Stack = dependent PRs; Threads = linked chats; Pinned section in sidebar.
- Review pane: reflects Git repo state, not just Codex edits. Scopes: Unstaged (default), Staged, Commit, Branch (vs base), Last turn. Multi-repo selector in review header. Findings as inline comments. Stage/unstage/revert at whole-diff (Stage all/Revert all), per-file, per-hunk. Inline comment: hover line, + button, submit, then send follow-up message. /review: Review against base branch / Review uncommitted changes; findings without changing working tree. Reviews run in current chat by default; Settings > General > Code review > Detached = separate review chat.
- Summary pane (OpenAI launch post, official): "new summary pane to track agent plans, sources, and artifacts" — https://openai.com/index/codex-for-almost-everything/ ; also files in sidebar with rich previews for PDFs/spreadsheets/slides/docs, multiple terminal tabs, SSH remote devboxes (alpha), in-app browser.

## ChatGPT desktop sidebar — official skills doc + secondary
- developers.openai.com/codex/skills: "In the ChatGPT desktop app, open Skills in the sidebar" — but later guides (tonyreviewsthings, brisk.vision, secondary) say current path is Sidebar > Plugins > Skills tab (moved July 2026). CONFLICT / version drift — flag.
- Codex merged into ChatGPT desktop app 2026-07-09 (v26.707): top-level switcher Chat / Work / Codex. Secondary research notes (Odex, 2026-10-04): sidebar Projects (local + ChatGPT projects), Recents, pinned projects/chats, collapsible sections, manual ordering; Activity view (bell) lists unread/running/waiting chats; subagent activity shown in chat with stable identicons per background subagent and subagent diff stats in composer; side chat /side ephemeral fork.
