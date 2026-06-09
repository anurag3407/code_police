/**
 * ============================================================================
 * CODE POLICE - MERGE CONFLICT PRE-DETECTOR
 * ============================================================================
 * Surfaces likely merge conflicts *before* a maintainer attempts the merge.
 *
 * Strategy (no local checkout required, works purely over the GitHub API):
 *  1. Read the PR's mergeable state directly from GitHub when available.
 *  2. Independently compute "overlap risk": files changed by the PR that have
 *     ALSO changed on the base branch since the PR's merge-base. Overlapping
 *     line ranges are the strongest predictor of a textual conflict.
 *  3. Produce a maintainer-friendly, terminal-styled report and an optional
 *     AI-assisted resolution suggestion.
 *
 * This dramatically reduces the DevOps burden of "merge, see it break, undo".
 */

const GITHUB_API_BASE = "https://api.github.com";

export interface ConflictFile {
  path: string;
  /** Line ranges touched by the PR head. */
  prRanges: Array<[number, number]>;
  /** Line ranges touched on the base branch since merge-base. */
  baseRanges: Array<[number, number]>;
  /** True when PR and base edits touch overlapping line ranges. */
  overlapping: boolean;
}

/**
 * A symbol (function / class / variable) that was removed or renamed on the
 * base branch since the PR branched, but is still referenced in the PR's
 * changed files. This is a semantic conflict: the code compiles on each branch
 * individually but will break when merged.
 */
export interface SemanticConflict {
  /** The declared symbol name removed from base. */
  symbol: string;
  /** File on the base branch where the symbol's definition was removed. */
  removedInBaseFile: string;
  /** Changed PR file where a reference to the symbol still appears. */
  referencedInPrFile: string;
  /** Representative patch line from the PR file containing the reference. */
  snippet: string;
}

export interface ConflictReport {
  /** GitHub's own assessment: true, false, or null (still computing). */
  mergeable: boolean | null;
  mergeableState?: string;
  /** Files both sides touched (potential conflicts). */
  contestedFiles: ConflictFile[];
  /** Subset of contestedFiles with overlapping line ranges (likely conflicts). */
  likelyConflicts: ConflictFile[];
  /**
   * Symbols removed or renamed on base that are still referenced in the PR.
   * These are "silent" conflicts: no textual overlap, but the merged code
   * will call a symbol that no longer exists on the base side.
   */
  semanticConflicts: SemanticConflict[];
  riskLevel: "none" | "low" | "high";
  summary: string;
}

interface GitHubFile {
  filename: string;
  status: string;
  patch?: string;
}

async function ghJson<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

/**
 * Parse a unified-diff patch into the set of line ranges it modifies on the
 * "new" side of the file (the `+` hunks).
 */
export function parsePatchRanges(patch?: string): Array<[number, number]> {
  if (!patch) return [];
  const ranges: Array<[number, number]> = [];
  const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let match: RegExpExecArray | null;
  while ((match = hunkHeader.exec(patch)) !== null) {
    const start = parseInt(match[1], 10);
    const count = match[2] ? parseInt(match[2], 10) : 1;
    if (count > 0) ranges.push([start, start + count - 1]);
  }
  return ranges;
}

function rangesOverlap(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  for (const [aStart, aEnd] of a) {
    for (const [bStart, bEnd] of b) {
      if (aStart <= bEnd && bStart <= aEnd) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Semantic conflict detection
// ---------------------------------------------------------------------------
//
// A *textual* conflict is when both branches edit the same lines. A *semantic*
// conflict is subtler and invisible to line-range overlap: the base branch
// removed or renamed a symbol (a function, class, or top-level binding) while
// this PR still references it. Each branch compiles in isolation, but the merge
// breaks because the PR calls something that no longer exists.
//
// We work purely from the patches already fetched by `detectConflicts`:
//   - `baseFiles` patches  → what base removed/added since the PR branched
//                            (`-` lines = base removals).
//   - `prFiles` patches    → the PR's own diff (`+`/context lines = PR head).
// No extra GitHub calls are required.

interface DiffLines {
  /** Content of `+` (added) lines, prefix stripped. */
  added: string[];
  /** Content of `-` (removed) lines, prefix stripped. */
  removed: string[];
  /** Content of unchanged context lines, prefix stripped. */
  context: string[];
}

/** Split a unified-diff patch body into added / removed / context line content. */
function splitPatch(patch?: string): DiffLines {
  const added: string[] = [];
  const removed: string[] = [];
  const context: string[] = [];
  if (!patch) return { added, removed, context };
  for (const raw of patch.split("\n")) {
    // Skip file headers and hunk headers.
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("@@")) continue;
    if (raw.startsWith("+")) added.push(raw.slice(1));
    else if (raw.startsWith("-")) removed.push(raw.slice(1));
    else if (raw.startsWith(" ")) context.push(raw.slice(1));
    // "\ No newline at end of file" and blank separators are ignored.
  }
  return { added, removed, context };
}

/**
 * Regexes recognising a *named top-level declaration* in a single line of
 * JS/TS or Python source, capturing the identifier in group 1. Deliberately
 * limited to forms that introduce a referenceable top-level symbol.
 */
const DECLARATION_RES: RegExp[] = [
  // function NAME / async function NAME / function* NAME / export [default] ...
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  // class NAME / export [default] [abstract] class NAME  (also matches Python `class NAME`)
  /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  // const/let/var NAME  (optionally exported)
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  // Python: def NAME( / async def NAME(
  /\b(?:async\s+)?def\s+([A-Za-z_$][\w$]*)\s*\(/,
];

/** Extract the names of top-level symbols declared on a single source line. */
function declaredSymbolsInLine(line: string): string[] {
  const out: string[] = [];
  for (const re of DECLARATION_RES) {
    const m = re.exec(line);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;

/**
 * Identify symbols whose top-level declaration was removed on the base branch:
 * declared on a `-` line and NOT declared on any `+` line of the same file's
 * patch (so a moved/reformatted declaration is not mistaken for a removal).
 * Returns symbol → the base file it was removed from. Names shorter than three
 * characters are skipped to avoid matching trivial identifiers.
 */
export function collectRemovedBaseSymbols(
  baseFiles: Array<{ filename: string; patch?: string }>
): Map<string, string> {
  const removed = new Map<string, string>();
  for (const file of baseFiles) {
    const { added, removed: removedLines } = splitPatch(file.patch);
    const addedDecls = new Set<string>();
    for (const line of added) for (const s of declaredSymbolsInLine(line)) addedDecls.add(s);
    for (const line of removedLines) {
      for (const s of declaredSymbolsInLine(line)) {
        if (s.length < 3) continue;
        if (addedDecls.has(s)) continue; // reformatted/kept on base, not removed
        if (!removed.has(s)) removed.set(s, file.filename);
      }
    }
  }
  return removed;
}

/** Symbols the PR itself declares (re-introduces) — these aren't conflicts. */
function collectPrDeclaredSymbols(prFiles: Array<{ filename: string; patch?: string }>): Set<string> {
  const declared = new Set<string>();
  for (const file of prFiles) {
    const { added } = splitPatch(file.patch);
    for (const line of added) for (const s of declaredSymbolsInLine(line)) declared.add(s);
  }
  return declared;
}

/** True when `line` itself declares/defines `symbol` (so it's not a reference). */
function lineDeclaresSymbol(line: string, symbol: string): boolean {
  if (declaredSymbolsInLine(line).includes(symbol)) return true;
  const esc = escapeRe(symbol);
  // Method or arrow-property definition: `name(...) {` or `name = (...) =>`.
  if (new RegExp(`\\b${esc}\\s*\\([^)]*\\)\\s*(?::[^={]+)?\\s*\\{`).test(line)) return true;
  if (new RegExp(`\\b${esc}\\s*[:=]\\s*(?:async\\s*)?\\(?[^)=]*\\)?\\s*=>`).test(line)) return true;
  return false;
}

/**
 * True when `line` references `symbol` as a call, construction, or import —
 * the high-confidence signals that the PR actually uses the symbol (rather
 * than a coincidental word match). Comment lines are ignored.
 */
function lineReferencesSymbol(line: string, symbol: string): boolean {
  if (COMMENT_LINE.test(line)) return false;
  const esc = escapeRe(symbol);
  if (!new RegExp(`\\b${esc}\\b`).test(line)) return false;
  // import / export-from / require naming the symbol.
  if (
    /^\s*import\b/.test(line) ||
    /^\s*export\b/.test(line) ||
    /\brequire\s*\(/.test(line) ||
    /^\s*from\s+\S+\s+import\b/.test(line)
  ) {
    return true;
  }
  // Construction or call.
  if (new RegExp(`\\bnew\\s+${esc}\\b`).test(line)) return true;
  if (new RegExp(`\\b${esc}\\s*\\(`).test(line)) return true;
  return false;
}

/**
 * Detect semantic conflicts: symbols removed/renamed on base that this PR still
 * references. Pure and deterministic over the supplied patches.
 *
 * Heuristic and regex-based (consistent with the dependency graph's extractors)
 * — it does not perform full symbol resolution. Documented limits: it only
 * considers top-level declarations (not object methods or members), requires a
 * call/construction/import reference (a bare value mention of a removed
 * `const` may be missed), skips symbols the PR re-declares, and ignores names
 * shorter than three characters.
 */
export function detectSemanticConflicts(
  baseFiles: Array<{ filename: string; patch?: string }>,
  prFiles: Array<{ filename: string; patch?: string }>
): SemanticConflict[] {
  const removed = collectRemovedBaseSymbols(baseFiles);
  if (removed.size === 0) return [];
  const prDeclared = collectPrDeclaredSymbols(prFiles);

  const conflicts: SemanticConflict[] = [];
  const seen = new Set<string>();

  for (const file of prFiles) {
    const { added, context } = splitPatch(file.patch);
    const headLines = [...added, ...context];
    for (const line of headLines) {
      for (const [symbol, baseFile] of removed) {
        if (prDeclared.has(symbol)) continue; // PR re-introduces it → no conflict
        if (lineDeclaresSymbol(line, symbol)) continue;
        if (!lineReferencesSymbol(line, symbol)) continue;
        const key = `${symbol}|${file.filename}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          symbol,
          removedInBaseFile: baseFile,
          referencedInPrFile: file.filename,
          snippet: line.trim().slice(0, 200),
        });
      }
    }
  }

  conflicts.sort(
    (a, b) =>
      a.symbol.localeCompare(b.symbol) ||
      a.referencedInPrFile.localeCompare(b.referencedInPrFile)
  );
  return conflicts;
}

/**
 * Detect likely conflicts for a pull request.
 *
 * @param token   GitHub access token
 * @param owner   repo owner
 * @param repo    repo name
 * @param prNumber pull request number
 * @param baseRef base branch name (e.g. "main")
 * @param headRef head branch name
 */
export async function detectConflicts(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  baseRef: string,
  headRef: string
): Promise<ConflictReport> {
  // 1. Ask GitHub directly. `mergeable` may be null while GitHub computes it.
  const pr = await ghJson<{ mergeable: boolean | null; mergeable_state: string }>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`,
    token
  );

  // 2. Files changed by the PR (head side).
  const prFiles =
    (await ghJson<GitHubFile[]>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
      token
    )) ?? [];

  // 3. What changed on base since the merge-base of head and base.
  //    `compare/base...head` reports commits unique to head; we instead want
  //    base changes the PR doesn't know about, so compare head...base.
  const baseComparison = await ghJson<{ files?: GitHubFile[] }>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/compare/${encodeURIComponent(headRef)}...${encodeURIComponent(baseRef)}`,
    token
  );
  const baseFiles = baseComparison?.files ?? [];

  const prByPath = new Map(prFiles.map((f) => [f.filename, f]));
  const baseByPath = new Map(baseFiles.map((f) => [f.filename, f]));

  const contestedFiles: ConflictFile[] = [];
  for (const [path, prFile] of prByPath) {
    const baseFile = baseByPath.get(path);
    if (!baseFile) continue; // only one side touched it
    const prRanges = parsePatchRanges(prFile.patch);
    const baseRanges = parsePatchRanges(baseFile.patch);
    const overlapping = rangesOverlap(prRanges, baseRanges);
    contestedFiles.push({ path, prRanges, baseRanges, overlapping });
  }

  const likelyConflicts = contestedFiles.filter((f) => f.overlapping);

  // Semantic conflicts: symbols base removed/renamed that the PR still uses.
  const semanticConflicts = detectSemanticConflicts(baseFiles, prFiles);

  let riskLevel: ConflictReport["riskLevel"] = "none";
  if (pr?.mergeable === false || likelyConflicts.length > 0 || semanticConflicts.length > 0) {
    riskLevel = "high";
  } else if (contestedFiles.length > 0) {
    riskLevel = "low";
  }

  const summary = buildSummary(pr?.mergeable ?? null, contestedFiles, likelyConflicts, semanticConflicts);

  return {
    mergeable: pr?.mergeable ?? null,
    mergeableState: pr?.mergeable_state,
    contestedFiles,
    likelyConflicts,
    semanticConflicts,
    riskLevel,
    summary,
  };
}

function buildSummary(
  mergeable: boolean | null,
  contested: ConflictFile[],
  likely: ConflictFile[],
  semantic: SemanticConflict[]
): string {
  const parts: string[] = [];
  if (mergeable === false) parts.push("GitHub reports this PR is NOT mergeable.");
  if (likely.length > 0) {
    parts.push(`${likely.length} file(s) have overlapping edits on both branches.`);
  }
  if (semantic.length > 0) {
    parts.push(
      `${semantic.length} reference(s) to symbol(s) removed or renamed on the base branch.`
    );
  }
  if (parts.length > 0) return parts.join(" ") + " Manual review recommended.";
  if (contested.length > 0) {
    return `${contested.length} file(s) changed on both branches, but in different regions. Likely auto-mergeable.`;
  }
  return "No competing changes detected. This PR should merge cleanly.";
}

/**
 * Render a conflict report as a Markdown PR comment with a terminal aesthetic.
 */
export function formatConflictComment(report: ConflictReport): string {
  const icon = { none: "🟢", low: "🟡", high: "🔴" }[report.riskLevel];
  const lines = [
    "## 🔀 Merge Conflict Pre-Check",
    "",
    `${icon} **${report.riskLevel === "none" ? "CLEAN" : report.riskLevel.toUpperCase()}** — ${report.summary}`,
  ];

  if (report.likelyConflicts.length > 0) {
    lines.push("", "```diff");
    for (const f of report.likelyConflicts.slice(0, 10)) {
      lines.push(`! ${f.path}`);
    }
    lines.push("```");
    lines.push("", "_These files were edited in the same regions on both branches._");
  }

  if (report.semanticConflicts.length > 0) {
    lines.push(
      "",
      "### 🔍 Semantic conflicts",
      "",
      "These symbols were removed or renamed on the **base** branch but are still " +
        "referenced by this PR. They produce no textual overlap, yet the merged code will fail:"
    );
    for (const c of report.semanticConflicts.slice(0, 15)) {
      const snip = c.snippet.replace(/`/g, "'");
      lines.push(
        `- \`${c.symbol}\` — removed in \`${c.removedInBaseFile}\`, still referenced in \`${c.referencedInPrFile}\``
      );
      lines.push(`  - \`${snip}\``);
    }
    if (report.semanticConflicts.length > 15) {
      lines.push("", `_…and ${report.semanticConflicts.length - 15} more._`);
    }
  }

  return lines.join("\n");
}
