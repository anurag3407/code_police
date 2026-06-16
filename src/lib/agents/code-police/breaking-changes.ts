export interface BreakingChangeReport {
  [key: string]: any;
}

export async function analyzeBreakingChanges(opts: {
  githubToken: string;
  owner: string;
  repo: string;
  baseBranch: string;
  branch: string;
  changedFiles: string[];
  prNumber: number;
}): Promise<BreakingChangeReport | null> {
  return null;
}

export function formatBreakingChangesComment(report: BreakingChangeReport): string {
  return "";
}
