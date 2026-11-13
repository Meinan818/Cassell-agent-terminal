# Agent View (Claude CLI), Codex /agents, Cursor Agents Window — secondary/official-mixed
## Claude Agent View — official
URL: https://code.claude.com/docs/en/agent-view (search snippet, index 2026-11-12)
- `claude agents` = one screen for all background sessions: what's running, what needs input, what's done. Dispatch new sessions, watch state at a glance, step in only when needed. Each background session is a full conversation, keeps running without terminal attached; open/reply/leave. Rows grouped by state, pinned + needs-you at top. Each row: session name, current activity, age (finished age freezes at run duration). States: Working (animated), Needs input (yellow — question/permission/other prompt), Idle (dimmed), plus completed/failed. Space = peek panel (recent output / question waiting on), Enter = attach, ← returns. Footer hint `← 2 agents` counts waiting. Research preview, v2.1.139+ (May 2026). Subagents/teammates a session spawns are NOT listed as separate rows (per ccdeck.dev comparison of docs, 2026-11-05).

## Codex /agents + agents dashboard — secondary (not official docs pages)
- https://codex.danielvaughan.com/2026/10/17/agents-view-parallel-task-management-codex-cli-tui/ and https://aq.dev/guides/codex-background-agents-and-the-agents-dashboard/ and https://hackernoon.com/the-terminal-tab-problem-codex-finally-solved-for-multi-agent-work
- `codex agents` (CLI 0.149.0, Aug 2026) / `/agents` in-session: fullscreen TUI, lists active/queued/completed tasks across sessions, grouped by project/status; states Need input / Working / Ready (Ready = something to review); unread results marked; arrow keys navigate, Enter expands full transcript, `i` sends steering message, `x` interrupts; `codex queue` sends message without opening session. v0.167.0 (Nov 6 2026) "Agent Command Center" adds sorting by recency within status groups, embedded sessions. Subagent status reflected under parent session. max_threads default 6, max_depth default 1 (config [agents]).

## Cursor Agents Window — secondary mirror of official docs
URL: https://docs.arantic.com/cursor/parallel-agents (Arantic docs, not cursor.com — flag second-hand)
- Agents Window (Cursor 3, Apr 2 2026, GA): agent-first interface, separate from classic editor; sidebar of running agents, diffs view for review/commit, one-click local/cloud handoff; manage agents across repos/environments (local/cloud/remote SSH); pin chats to top; multi-workspace; UI-native worktrees.
- Subagents: /multitask runs async subagents in parallel, own context window, shared checkout by default (ask for isolation → own worktree/cloud env + branch, parent merges results). /in-cloud = cloud subagent on own VM+branch; /autopilot on PR. Cloud agents attach screenshots/videos/logs to PR.
- Queue vs steer: Enter queues message (waits for current task), Send now / Cmd+Enter steers running agent at next tool call without cutting in-flight work.

## Claude thinking settings — official
URL: https://code.claude.com/docs/en/settings-reference
- showThinkingSummaries: false default; true = full thinking summaries when you expand thinking with Ctrl+O; false = API redacts thinking blocks, collapsed stub. alwaysThinkingEnabled: turn extended thinking off for every session (no effect on always-thinking models Opus 5.5/Sonnet 5.5/Haiku 5.5/Fable).
- Anthropic blog 2026-04-14: https://claude.com/blog/claude-code-desktop-redesign — "Three view modes—Verbose, Normal, and Summary—let you dial the interface from full transparency into Claude's tool calls to just the results." + "new usage button shows both your context window and session usage at a glance." Note: Summary mode later removed (desktop docs: pre-1.46388.1 only).
