# Source 02 — Official Anthropic announcement: Introducing dynamic workflows
URL: https://claude.com/resources/articles/introducing-dynamic-workflows-in-claude-code
Read: 2026-11-12, verified live via browser_open
Published: 2026-05-28. Update note on page: "Dynamic workflows are now generally available." (Originally research preview — status changed; page does not give GA date in text extracted)
Status: OFFICIAL / PRIMARY

Key facts:
- "Claude dynamically writes orchestration scripts that run tens to hundreds of parallel subagents in a single session, checking its work before anything reaches you."
- Use cases: bug hunt across service, migration touching hundreds of files, plan stress-tested from every angle.
- GA surfaces: CLI, Desktop, VS Code extension for Pro, Max, Ultra, Team, Enterprise, plus Claude API, Amazon Bedrock, Vertex AI, Microsoft Foundry.
- "Dynamic workflows can consume substantially more tokens than a typical Claude Code session, so we recommend starting on a scoped task"
- Two ways to start: 1) Ask Claude to create a workflow directly ("Create a workflow"), 2) Switch on new Claude Code-specific setting `ultracode`, accessible through effort menu, "it sets the effort level to xhigh, while letting Claude decide automatically when to use a workflow" — NOTE: this was original (pre-v2.1.284) definition; current docs say ultracode no longer forces xhigh except via --effort ultracode.
- "For the best experience, turn on auto mode when using dynamic workflows."
- How it works: "When a workflow kicks off, Claude plans dynamically based on your prompt, breaks it into subtasks, and fans the work out across subagents running in parallel. Results are checked before they're folded in, and you come back to a single, coordinated answer. Agents address the problem from independent angles, other agents try to refute what they found, and the run keeps iterating until the answers converge—which is how a workflow reaches results a single pass can't."
- "built for parallel and long-running work that can extend into hours and days... Progress is saved as the run goes, so a job that's interrupted picks up where it left off instead of starting over. Because the coordination happens outside the conversation, the plan stays on track no matter how big the task gets."
- First time a workflow triggers, Claude Code shows what's about to run and asks you to confirm. Admins can disable via managed settings.
- Bun example: Jarred Sumner ported Bun Zig->Rust, 99.8% existing test suite passing, ~750,000 lines Rust, 11 days first commit to merge. One workflow mapped Rust lifetime for every struct field; next wrote every .rs file as behaviour-identical port, hundreds of agents in parallel with two reviewers on each file; fix loop drove build/test until clean; overnight workflow addressed unnecessary copies, opened PR each for final review. "While not yet in production" — vendor-reported example, not independent benchmark.
- Defaults: on by default for Max, Ultra, Team, Enterprise and via API; Pro can enable in /config.
