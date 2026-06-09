/**
 * ============================================================================
 * CODE POLICE - PR IMPACT ORCHESTRATOR
 * ============================================================================
 * Ties together the dependency graph and conflict detector into a single,
 * maintainer-facing analysis for a Pull Request. This is the heart of the
 * open-source-maintainer experience:
 *
 *   "This PR changes files X and Y. Here is everything it affects, here is the
 *    merge-conflict risk, and here is a graph you can read at a glance."
 *
 * To keep GitHub API usage bounded we only fetch the contents of files that
 * are plausibly relevant: changed files plus the analyzable source tree
 * (JS/TS and Python, capped).
 */

import {
  buildDependencyGraph,
  computePrImpact,
  formatImpactComment,
  detectSourceLanguage,
  detectCycles,
  formatCyclesComment,
  type PrImpactReport,
} from "./dependency-graph";
import {
  detectConflicts,
  formatConflictComment,
  type ConflictReport,
} from "./conflict-detector";
import {
  analyzeBreakingChanges,
  formatBreakingChangesComment,
  type BreakingChangeReport,
} from "./breaking-changes";
import { fetchRepoTree, fetchFileContent } from "./github";

const MAX_TREE_FILES = 400; // cap to stay within API/time budgets
const MAX_FILE_BYTES = 200_000;

export interface PrImpactResult {
  impact: PrImpactReport;
  conflicts: ConflictReport | null;
  /** Circular import chains detected in the graph (each `[a, b, c]` = a→b→c→a). */
  cycles: string[][];
  /** Breaking changes to the public API surface (null if analysis failed). */
  breakingChanges: BreakingChangeReport | null;
  /** Combined Markdown comment ready to post on the PR. */
  comment: string;
}

function isAnalyzableSource(path: string): boolean {
  if (/^(node_modules|dist|build|\.next|out|coverage|vendor|__pycache__)\//.test(path)) return false;
  if (/\.(min|d)\.(js|ts)$/.test(path)) return false;
  return detectSourceLanguage(path) !== null;
}

/**
 * Run the full PR impact analysis.
 *
 * @param opts.changedFiles  files changed by the PR (head side)
 * @param opts.includeConflicts  whether to run merge-conflict pre-detection
 */
export async function analyzePrImpact(opts: {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  prNumber: number;
  changedFiles: string[];
  includeConflicts?: boolean;
}): Promise<PrImpactResult> {
  const { githubToken, owner, repo, branch, baseBranch, prNumber, changedFiles } = opts;

  // 1. Pull the repo tree at the PR head and select analyzable source files.
  let sourcePaths: string[] = [];
  try {
    const tree = await fetchRepoTree(githubToken, owner, repo, branch);
    sourcePaths = tree.tree
      .filter((node) => node.type === "blob" && isAnalyzableSource(node.path))
      .filter((node) => (node.size ?? 0) <= MAX_FILE_BYTES)
      .map((node) => node.path)
      .slice(0, MAX_TREE_FILES);
  } catch (err) {
    console.warn("[PR Impact] Failed to read repo tree:", err);
  }

  // Always include the changed files even if the tree was truncated.
  const allPaths = Array.from(new Set([...sourcePaths, ...changedFiles.filter(isAnalyzableSource)]));

  // 2. Fetch contents in bounded parallel batches.
  const files = await fetchFilesBatched(githubToken, owner, repo, branch, allPaths);

  // 3. Build the graph and compute blast radius.
  const graph = buildDependencyGraph(files);
  const impact = computePrImpact(graph, changedFiles);

  // 3b. Detect circular import chains. Surface the ones that involve a changed
  //     file in the PR comment (most relevant); return the full set for the
  //     dashboard. Swap the filter for `allCycles` to report every cycle.
  const allCycles = detectCycles(graph);
  const relevantCycles = allCycles.filter((cycle) =>
    cycle.some((file) => changedFiles.includes(file))
  );

  // 4. Optional conflict pre-detection.
  let conflicts: ConflictReport | null = null;
  if (opts.includeConflicts) {
    try {
      conflicts = await detectConflicts(githubToken, owner, repo, prNumber, baseBranch, branch);
    } catch (err) {
      console.warn("[PR Impact] Conflict detection failed:", err);
    }
  }

  // 5. Breaking-change detection: compare base vs head signatures of the
  //    changed files. Bounded to the changed-file set, so it stays cheap.
  let breakingChanges: BreakingChangeReport | null = null;
  try {
    breakingChanges = await analyzeBreakingChanges({
      githubToken,
      owner,
      repo,
      baseBranch,
      branch,
      changedFiles,
      prNumber,
    });
  } catch (err) {
    console.warn("[PR Impact] Breaking-change detection failed:", err);
  }

  const cyclesComment = formatCyclesComment(relevantCycles);
  const breakingComment = breakingChanges ? formatBreakingChangesComment(breakingChanges) : "";

  const comment = [
    formatImpactComment(impact),
    cyclesComment ? "\n\n" + cyclesComment : "",
    breakingComment ? "\n\n" + breakingComment : "",
    conflicts ? "\n\n" + formatConflictComment(conflicts) : "",
  ].join("");

  return { impact, conflicts, cycles: allCycles, breakingChanges, comment };
}

async function fetchFilesBatched(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  paths: string[],
  batchSize = 12
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = [];
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (path) => ({
        path,
        content: await fetchFileContent(token, owner, repo, path, ref),
      }))
    );
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
  return results;
}
