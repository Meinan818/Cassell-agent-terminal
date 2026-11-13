import type { GoalState } from "../types";

/**
 * P0-6 目标卡片 + P0-7 检查点列表。
 *
 * 目标进行中时钉在对话区顶部：用户一眼看到目标是什么、跑到哪了、
 * 改了哪些文件、卡没卡住。检查点是每回合的真实快照（消息 + 写前备份），
 * 不是摆设：三个粒度的倒带都是真动作。
 *
 * 样式纪律（FRONTEND-PHILOSOPHY.md）：无框线、柔和底色、细腻阴影、
 * 大圆角、出现/收起 300ms 过渡；不许金色、不许假数据。
 */
export default function GoalCard({
  goal,
  running,
  showCheckpoints,
  onToggleCheckpoints,
  onResume,
  onEnd,
  onRewind,
}: {
  goal: GoalState;
  running: boolean;
  showCheckpoints: boolean;
  onToggleCheckpoints: () => void;
  onResume: () => void;
  onEnd: () => void;
  onRewind: (turn: number, scope: "conversation" | "code" | "both") => void;
}) {
  const pct =
    goal.rounds_budget > 0
      ? Math.min(100, Math.round((goal.rounds_used / goal.rounds_budget) * 100))
      : 0;
  const active = goal.status === "running" || goal.status === "paused";
  const doneItems = goal.checklist.filter((c) => c.done).length;

  return (
    <div className="goal-card" role="status">
      <div className="goal-head">
        <span className="goal-label">目标</span>
        <span className={`goal-status goal-status-${goal.status}`}>
          {goal.status_label}
        </span>
        <span className="goal-rounds">
          {goal.rounds_used} / {goal.rounds_budget} 轮
          {goal.turns_used > 0 ? ` · ${goal.turns_used} 回合` : ""}
        </span>
        <span className="goal-spacer" />
        {goal.status === "paused" && !running && (
          <button type="button" className="btn-primary" onClick={onResume}>
            继续跑
          </button>
        )}
        {(goal.status === "stuck" || goal.status === "budget") && !running && (
          <button type="button" className="btn-primary" onClick={onResume}>
            继续跑
          </button>
        )}
        {!running && (
          <button type="button" className="btn-ghost" onClick={onEnd}>
            结束目标
          </button>
        )}
      </div>

      <div className="goal-text">{goal.text}</div>

      <div
        className="goal-bar"
        role="progressbar"
        aria-valuenow={goal.rounds_used}
        aria-valuemax={goal.rounds_budget}
      >
        <div className="goal-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {goal.checklist.length > 0 && (
        <ul className="goal-checklist">
          {goal.checklist.map((c, i) => (
            <li key={i} className={c.done ? "done" : ""}>
              <span aria-hidden="true">{c.done ? "✓" : "○"}</span> {c.text}
            </li>
          ))}
        </ul>
      )}
      {goal.checklist.length > 0 && (
        <div className="goal-check-meta">
          清单 {doneItems}/{goal.checklist.length} 项
        </div>
      )}

      {goal.files_changed.length > 0 && (
        <div className="goal-files">
          改了 {goal.files_changed.length} 个文件：
          {goal.files_changed.slice(0, 4).join("、")}
          {goal.files_changed.length > 4
            ? ` 等 ${goal.files_changed.length} 个`
            : ""}
        </div>
      )}

      {goal.status === "done" && goal.unverified_writes.length > 0 && (
        <div className="goal-warn">
          已收尾，但以下改动没有经过验证：
          {goal.unverified_writes.join("、")}——用之前最好先看一眼。
        </div>
      )}

      {goal.rewindNote && <div className="goal-note">{goal.rewindNote}</div>}

      <div className="goal-cps">
        <button
          type="button"
          className="btn-ghost goal-cps-toggle"
          onClick={onToggleCheckpoints}
          aria-expanded={showCheckpoints}
        >
          检查点（{goal.checkpoints.length}）
          <span aria-hidden="true">{showCheckpoints ? " ▴" : " ▾"}</span>
        </button>
        {showCheckpoints && (
          <div className="goal-cps-list">
            {goal.checkpoints.length === 0 && (
              <div className="goal-cps-empty">
                还没有检查点——跑完一回合就会记一个。
              </div>
            )}
            {goal.checkpoints.map((cp) => (
              <div key={cp.turn} className="goal-cp">
                <div className="goal-cp-main">
                  <span className="goal-cp-turn">第 {cp.turn} 回合</span>
                  <span className="goal-cp-time">
                    {new Date(cp.created_at * 1000).toLocaleTimeString(
                      "zh-CN",
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </span>
                  <span className="goal-cp-summary">{cp.summary}</span>
                </div>
                <div className="goal-cp-sub">
                  {cp.files_changed.length > 0
                    ? `改了 ${cp.files_changed.length} 个文件`
                    : "没改文件"}
                  {` · ${cp.rounds_used} 轮`}
                </div>
                <div className="goal-cp-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={running}
                    title="对话回到这一回合，代码不动"
                    onClick={() => onRewind(cp.turn, "conversation")}
                  >
                    回对话
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={running}
                    title="文件恢复到这一回合结束时的样子，对话不动"
                    onClick={() => onRewind(cp.turn, "code")}
                  >
                    回代码
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={running}
                    title="对话和代码一起回到这一回合"
                    onClick={() => onRewind(cp.turn, "both")}
                  >
                    都回
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {active && running && (
        <div className="goal-live">正在跑——不用点什么，等它做完。</div>
      )}
    </div>
  );
}
