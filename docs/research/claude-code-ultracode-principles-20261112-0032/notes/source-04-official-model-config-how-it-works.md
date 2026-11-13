# Source 04 — Official Docs: Model configuration + How Claude Code works + Sandbox/Security/Subagents
URLs:
- https://code.claude.com/docs/en/model-config (read 2026-11-12, verified live, 1426 lines; ultracode/effort section not re-read line-by-line in full — definition corroborated via search snippet quoting same page + workflows docs)
- https://code.claude.com/docs/en/how-claude-code-works (read 2026-11-12, verified live, updated 2026-10-30)
- https://code.claude.com/docs/en/sandboxing (search snippet, index only — not opened in full)
- https://code.claude.com/docs/en/sub-Agents (search snippet, index only)
Status: OFFICIAL, mixed verified-live / index

Model config / effort (current, post-v2.1.284):
- Quote (current docs, via search + secondary quoting it verbatim): "Ultracode is a Claude Code setting rather than a model effort level: with it on, Claude orchestrates dynamic workflows for substantive tasks, at whichever effort level the session runs at."
- Older quote (pre-v2.1.284, now superseded): "it sends xhigh to the model and additionally has Claude orchestrate dynamic workflows for substantive tasks. It applies to the current session only."
- Effort levels: low, medium, high, xhigh, max. xhigh = "Deeper reasoning at higher token spend"; max = deepest reasoning level. Defaults vary by model: e.g. Opus 5.5/Sonnet 5.5/Haiku 5.5 default medium; Opus 4.8 / Opus 5 default high (secondary sources; official page lists per-model matrix — not fully extracted here).
- Ultracode availability: only when workflows enabled and model supports xhigh; Opus 4.6 / Sonnet 4.6 do NOT support xhigh, so no ultracode on them. Org effort cap below xhigh: pre-284 kept ultracode off; post-284 cap lowers effort level without turning ultracode off (per workflows doc).
- Settings: `ultracode` boolean in any settings file, default unset/off, Claude reads but never writes it; /effort ultracode is per-session only. `workflowKeywordTriggerEnabled` false disables keyword. Persisted `effortLevel` setting and CLAUDE_CODE_EFFORT_LEVEL env do NOT accept `ultracode`; use `"ultracode": true`.
- `claude --effort ultracode` requires v2.1.203+; /effort ultracode off, slider toggle, keeping ultracode on at levels other than xhigh require v2.1.284+.
- VS Code: Ultracode switch appears under Effort row when workflows enabled and model supports it, v2.1.284+; while on, model button shows "· Ultracode".
- ultrathink: keyword for one turn deeper reasoning; since v2.1.311 typing in terminal prompt can raise that turn to xhigh on Opus 5.5/Sonnet 5.5/Haiku 5.5/Fable 5.1 via Anthropic API, rainbow highlight, saved level unchanged. (Secondary: DevelopersDigest / ClaudeWorld, quoting changelog + model-config docs — flag as second-hand corroborated, not directly opened in model-config full text.)

How Claude Code works (base):
- Agentic loop: gather context -> take action -> verify results, repeat; interrupt at any point (Esc stops, or queue correction). Claude decides steps based on previous step, chaining dozens of actions, course-correcting.
- Models: Sonnet most tasks, Opus stronger reasoning for complex architecture; switch /model.
- Tools categories: file ops, search, execution (shell, servers, tests, git), web, code intelligence (type errors after edits, jump to definition — requires plugins). Plus spawning subagents, asking user questions, orchestration.
- Extensions on top of base: skills, MCP, hooks, subagents.
- Access: project files, terminal, git state, CLAUDE.md, auto memory (first 200 lines / 25KB MEMORY.md), extensions (MCP, skills, subagents, Claude in Chrome).
- Sessions: saved locally as plaintext JSONL under ~/.claude/projects/, enables rewinding/resuming/forking; before code changes snapshots affected files. Sessions independent, fresh context each; resume --continue/--resume same ID, fork --fork-session//branch copies history new ID. Parallel sessions via git worktrees.
- Context: holds conversation, file contents, outputs, CLAUDE.md, auto memory, loaded skills, system instructions; auto-compacts into summary when approaching limit (early instructions may be lost; put persistent rules in CLAUDE.md; /compact with focus); /context shows usage; MCP tool definitions deferred, loaded on demand via tool search.
- Skills load on demand (descriptions at start, full content only when used; disable-model-invocation keeps descriptions out until needed).
- Subagents: own context window, start fresh unless fork (copy of conversation so far); tool calls stay out of main context, Claude gets summary back.
- Checkpoints/permissions (safety): "Claude has two safety mechanisms: checkpoints let you undo file changes, and permissions control what Claude can do without asking." File edits reversible: snapshot before edit, Esc twice to rewind, or ask to undo; separate from git, remain on resume; only file changes, skips symlinked/hard-linked; remote actions (DB/API/deploy) can't be checkpointed — control via permission mode/rules.
- Permission modes (Shift+Tab cycle): Auto (classifier reviews most actions in background, blocks risky; built-in starting mode v2.1.283+ for interactive terminal/VS Code, earlier only Pro/Max/Ultra/Team), Manual (asks before file edits and shell), Accept edits (edits + common filesystem commands without asking, still asks other commands), Plan (explores/proposes plan without editing source). Allow specific commands in .claude/settings.json; scoped org -> personal.
- /rewind: rolls code+conversation back to checkpoint (per commands doc search snippet).

Sandbox (index/search snippet from official docs):
- Bash sandbox is OS-enforced boundary around shell commands; set which files/network domains commands can reach; limits apply to Bash/PowerShell/Monitor + child processes; OS applies limits while command runs, so sandboxed commands can run without per-command approval. Covers shell commands ONLY; file tools, MCP, hooks run outside it. Runs macOS, Linux, WSL2; native Windows unsandboxed. Off by default; /sandbox or sandbox.enabled=true. macOS Seatbelt, Linux/WSL2 bubblewrap+socat. Sandbox runtime (@anthropic-ai/sandbox-runtime) wraps whole process incl file tools/MCP/hooks, beta research preview.
- Note: sandbox detail is index-only in this research (search result text), not full-page verified live — flag as such, though official domain.

Subagents (index/search snippet):
- Agent tool spawns subagent in separate context window, works autonomously, returns result to parent; parent doesn't see intermediate tool calls/outputs, only final result. Can also launch teammate (if named + teams enabled) or fork.
- Custom subagents: specialised assistants, own context, custom system prompt, specific tool access, independent permissions; description decides delegation; built-in Explore/Plan are read-only (Write/Edit denied), start without CLAUDE.md/git snapshot for speed; maxTurns cap.
