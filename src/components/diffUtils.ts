/** P0-11 diff 升级：统一格式 diff 的解析与并排配对。
 * 只解析 git diff 文本（审查队列里 `git diff HEAD` 的真实输出），
 * 不自己算 diff、不造假数据。 */

export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  /** 旧文件行号（新增行无）。 */
  oldNo: number | null;
  /** 新文件行号（删除行无）。 */
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  /** "@@ -12,7 +12,8 @@ func()" 整行原文。 */
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  totalLines: number;
}

/** 解析一段统一格式 diff 文本。`diff --git` / `---` / `+++` 行当元信息跳过；
 * 未追踪文件那种“全文都加 + 前缀”的合成 diff 也能解析（全是 add 行）。 */
export function parseUnifiedDiff(text: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let totalLines = 0;

  const flush = () => {
    if (current) hunks.push(current);
    current = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("Binary files")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      flush();
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldNo = m ? parseInt(m[1], 10) : 0;
      newNo = m ? parseInt(m[2], 10) : 0;
      current = { header: line, oldStart: oldNo, newStart: newNo, lines: [] };
      continue;
    }
    if (!current) {
      // hunk 头之前出现的孤行（比如未追踪文件合成 diff 的第一行说明）：
      // 没有 @@ 头就自成一个 hunk，行号从 1 开始。
      current = { header: "@@ -0,0 +1 @@", oldStart: 0, newStart: 1, lines: [] };
      oldNo = 0;
      newNo = 1;
    }
    if (line.startsWith("+")) {
      current.lines.push({ kind: "add", oldNo: null, newNo, text: line.slice(1) });
      newNo += 1;
      totalLines += 1;
    } else if (line.startsWith("-")) {
      current.lines.push({ kind: "del", oldNo, newNo: null, text: line.slice(1) });
      oldNo += 1;
      totalLines += 1;
    } else if (line.startsWith(" ") || line === "") {
      // 上下文行：前导空格是 diff 格式的一部分，去掉；空行当作空上下文行。
      const body = line.startsWith(" ") ? line.slice(1) : line;
      current.lines.push({ kind: "ctx", oldNo, newNo, text: body });
      oldNo += 1;
      newNo += 1;
      totalLines += 1;
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file"：不占行号，跳过。
      continue;
    } else {
      // 未知行：当作上下文行保底，不丢内容。
      current.lines.push({ kind: "ctx", oldNo, newNo, text: line });
      oldNo += 1;
      newNo += 1;
      totalLines += 1;
    }
  }
  flush();
  return { hunks, totalLines };
}

export interface SideRow {
  /** 左侧（旧文件）行；null = 这一行只有右侧（新增）。 */
  old: DiffLine | null;
  /** 右侧（新文件）行；null = 这一行只有左侧（删除）。 */
  next: DiffLine | null;
}

/** 把一个 hunk 的行配成并排表格：连续的删除行 + 随后连续的新增行按顺序
 * 一一配对，配不上的那一边留空；上下文行左右相同。 */
export function sideBySideRows(hunk: DiffHunk): SideRow[] {
  const rows: SideRow[] = [];
  let i = 0;
  const lines = hunk.lines;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === "ctx") {
      rows.push({ old: l, next: l });
      i += 1;
      continue;
    }
    if (l.kind === "del") {
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "del") {
        dels.push(lines[i]);
        i += 1;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].kind === "add") {
        adds.push(lines[i]);
        i += 1;
      }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k += 1) {
        rows.push({ old: dels[k] ?? null, next: adds[k] ?? null });
      }
      continue;
    }
    // 孤立的 add 行（前面没有 del）：右侧有内容，左侧留空。
    rows.push({ old: null, next: l });
    i += 1;
  }
  return rows;
}

/** 逐行评论在行上的定位键：新文件行优先用 newNo，删除行用 oldNo。 */
export function lineKey(l: DiffLine): string {
  return l.newNo !== null ? `n${l.newNo}` : `o${l.oldNo ?? 0}`;
}

/** 逐行评论在行上的显示用行号：新文件行显示新行号，删除行显示旧行号。 */
export function displayNo(l: DiffLine): number | null {
  return l.newNo !== null ? l.newNo : l.oldNo;
}
