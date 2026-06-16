"use client";

import { useState, useEffect, use, useRef } from "react";
import Link from "next/link";
import {
  Shield,
  ArrowLeft,
  GitCommit,
  Clock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileCode,
  ChevronDown,
  ChevronUp,
  Settings,
  RefreshCw,
  Loader2,
  Play,
  Pause,
  Square,
  GitPullRequest,
  Wrench,
  ExternalLink,
  Code,
  BarChart3,
} from "lucide-react";

import { ProjectSettings } from "@/components/code-police/ProjectSettings";
import { DependencyImpact, type ImpactData } from "@/components/code-police/DependencyImpact";
import { toast } from "sonner";

/**
 * ============================================================================
 * CODE POLICE - PROJECT DETAIL PAGE
 * ============================================================================
 * Shows project analysis history with real Firestore data.
 */

interface Project {
  id: string;
  name: string;
  githubFullName: string;
  githubOwner?: string;
  githubRepoName?: string;
  language: string | null;
  defaultBranch: string;
  status: 'active' | 'paused' | 'stopped';
  customRules: string[];
  ownerEmail?: string;
  autoFixEnabled?: boolean;
  notificationPrefs?: {
    emailOnPush?: boolean;
    emailOnPR?: boolean;
    minSeverity?: string;
    additionalEmails?: string[];
  };
}

interface AnalysisRun {
  id: string;
  projectId: string;
  commitSha: string;
  branch: string;
  status: string;
  triggerType: 'push' | 'pull_request';
  prNumber?: number;
  author?: { name: string; email?: string; avatar?: string };
  issueCounts: { critical: number; high: number; medium: number; low: number; info: number };
  summary?: string;
  createdAt: string;
  completedAt?: string;
  // Auto-fix fields
  autoFixPrUrl?: string;
  autoFixPrNumber?: number;
  autoFixesGenerated?: number;
  autoFixFilesChanged?: number;
  autoFixError?: string;
  // Dependency-graph + merge-conflict impact (PR runs)
  impact?: ImpactData;
}

interface CodeIssue {
  id: string;
  filePath: string;
  line: number;
  endLine?: number;
  severity: string;
  category: string;
  message: string;
  explanation: string;
  suggestedFix?: string;
  codeSnippet?: string;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.id;

  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [issues, setIssues] = useState<Record<string, CodeIssue[]>>({});
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [isLoadingIssues, setIsLoadingIssues] = useState<string | null>(null);
  const [isCreatingPR, setIsCreatingPR] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // WebSocket progress state
  const [analysisProgress, setAnalysisProgress] = useState<{
    status: string;
    progress: number;
    details?: string;
    logs: string[];
  } | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [analysisProgress?.logs]);

  // WebSocket connection management
  useEffect(() => {
    if (!projectId) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? `${window.location.hostname}:3001`
          : window.location.host;

        const wsUrl = `${protocol}//${host}`;
        console.log(`[WebSocket] Connecting to ${wsUrl}`);
        
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log(`[WebSocket] Connected. Subscribing to project ${projectId}`);
          ws?.send(JSON.stringify({ type: "subscribe", projectId }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "progress" && data.projectId === projectId) {
              setIsAnalyzing(true);
              setAnalysisProgress((prev) => {
                const currentLogs = prev?.logs || [];
                const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const logEntry = `[${timestamp}] ${data.status}${data.details ? ` - ${data.details}` : ""}`;
                
                const isDuplicate = currentLogs.length > 0 && currentLogs[currentLogs.length - 1].includes(data.status);
                const nextLogs = isDuplicate ? currentLogs : [...currentLogs, logEntry];
                
                return {
                  status: data.status,
                  progress: data.progress,
                  details: data.details,
                  logs: nextLogs,
                };
              });

              if (data.progress === 100) {
                setTimeout(() => {
                  setAnalysisProgress(null);
                  setIsAnalyzing(false);
                  fetchData(true);
                }, 2000);
              }
            }
          } catch (e) {
            console.error("[WebSocket] Message parsing error:", e);
          }
        };

        ws.onclose = () => {
          console.log("[WebSocket] Connection closed");
          reconnectTimeout = setTimeout(() => {
            connect();
          }, 3000);
        };

        ws.onerror = (err) => {
          console.error("[WebSocket] Connection error:", err);
        };
      } catch (e) {
        console.error("[WebSocket] Connection setup failed:", e);
      }
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [projectId]);

  // Fetch project and analysis runs
  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    try {
      // Fetch project
      const projectRes = await fetch(`/api/code-police/projects/${projectId}`);
      const projectData = await projectRes.json();

      if (!projectRes.ok) {
        throw new Error(projectData.error || "Failed to fetch project");
      }

      setProject(projectData.project);

      // Fetch analysis runs
      const runsRes = await fetch(`/api/code-police/analyze?projectId=${projectId}&limit=20`);
      const runsData = await runsRes.json();

      if (runsRes.ok && runsData.runs) {
        setRuns(runsData.runs);
        // Expand first run by default
        if (runsData.runs.length > 0 && !expandedRun) {
          setExpandedRun(runsData.runs[0].id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [projectId]);

  // Auto-polling: refresh data every 30 seconds to see new webhook results
  useEffect(() => {
    const interval = setInterval(() => {
      // Only auto-fetch if not currently refreshing or analyzing
      if (!isRefreshing && !isAnalyzing) {
        fetchData(false); // Silent refresh (no loading indicator)
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [projectId, isRefreshing, isAnalyzing]);

  // Update project settings
  const handleUpdateProject = async (updates: Partial<Project>) => {
    const res = await fetch(`/api/code-police/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to update project");
    }

    setProject(data.project);
  };


  // Trigger manual analysis
  const runAnalysis = async () => {
    if (!project) return;
    setIsAnalyzing(true);

    const analysisPromise = new Promise(async (resolve, reject) => {
      try {
        // Get owner and repo - try individual fields first, then parse from fullName
        let owner = project.githubOwner;
        let repo = project.githubRepoName;

        if (!owner || !repo) {
          // Fallback to parsing githubFullName
          const parts = project.githubFullName?.split('/');
          if (parts && parts.length === 2) {
            owner = parts[0];
            repo = parts[1];
          }
        }

        console.log('[Code Police] Running analysis with:', { projectId: project.id, owner, repo });

        if (!owner || !repo) {
          throw new Error('Repository information not found. Please reconnect the repository.');
        }

        const res = await fetch('/api/code-police/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: project.id,
            owner,
            repo,
            sendEmail: true,
          }),
        });

        const data = await res.json();
        console.log('[Code Police] Analysis response:', data);

        if (!res.ok) {
          throw new Error(data.error || data.details || 'Analysis failed');
        }

        // Refresh data to show new run
        await fetchData(true);
        resolve(data);
      } catch (err) {
        console.error('[Code Police] Analysis error:', err);
        reject(err);
      } finally {
        setIsAnalyzing(false);
      }
    });

    toast.promise(analysisPromise, {
      loading: "Running code analysis...",
      success: (data: any) => `Analysis complete! Found ${data.issueCount} issues.`,
      error: (err) => err instanceof Error ? err.message : 'Analysis failed',
    });
  };
  // Simulate a PR Webhook
  const simulatePR = async () => {
    if (!project) return;
    setIsSimulating(true);

    const simulatePromise = new Promise(async (resolve, reject) => {
      try {
        const res = await fetch(`/api/code-police/projects/${project.id}/demo-pr`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error("Failed to simulate PR");
        await fetchData(true);
        resolve(true);
      } catch (err) {
        console.error(err);
        reject(err);
      } finally {
        setIsSimulating(false);
      }
    });

    toast.promise(simulatePromise, {
      loading: "Simulating Pull Request webhook...",
      success: "Demo PR simulated successfully!",
      error: "Failed to simulate PR webhook",
    });
  };
  // Fetch issues for a specific run
  const fetchIssuesForRun = async (runId: string) => {
    if (issues[runId]) return; // Already loaded

    setIsLoadingIssues(runId);
    try {
      const res = await fetch(`/api/code-police/issues?runId=${runId}`);
      const data = await res.json();

      if (res.ok) {
        setIssues(prev => ({ ...prev, [runId]: data.issues || [] }));
      }
    } catch (err) {
      console.error('[Code Police] Failed to fetch issues:', err);
    } finally {
      setIsLoadingIssues(null);
    }
  };

  // Create fix PR for issues
  const createFixPR = async (runId: string) => {
    if (!project) return;

    setIsCreatingPR(runId);
    const createPrPromise = new Promise(async (resolve, reject) => {
      try {
        const res = await fetch('/api/code-police/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, runId }),
        });

        const data = await res.json();

        if (res.ok && data.success) {
          window.open(data.prUrl, '_blank');
          await fetchData(true);
          resolve(data);
        } else if (data.message) {
          // Handle detailed error response
          let errorMessage = data.message;

          // Add details about what was attempted
          if (data.fixesGenerated !== undefined) {
            errorMessage += `\n\nDetails:\n`;
            errorMessage += `• Fixes generated: ${data.fixesGenerated}\n`;
            if (data.autoApplicableCount !== undefined) {
              errorMessage += `• Auto-applicable: ${data.autoApplicableCount}\n`;
            }
            if (data.lowConfidenceCount > 0) {
              errorMessage += `• Low confidence (needs review): ${data.lowConfidenceCount}\n`;
            }
            if (data.requiresManualReview > 0) {
              errorMessage += `• Requires manual review: ${data.requiresManualReview}\n`;
            }
            if (data.unfixableCount > 0) {
              errorMessage += `• Unfixable issues: ${data.unfixableCount}\n`;
            }
          }

          console.log('[Code Police] Fix PR response details:', data);
          reject(new Error(errorMessage));
        } else {
          reject(new Error(data.error || 'Failed to create PR'));
        }
      } catch (err) {
        console.error('[Code Police] Fix PR error:', err);
        reject(err);
      } finally {
        setIsCreatingPR(null);
      }
    });

    toast.promise(createPrPromise, {
      loading: "Generating fixes and creating PR...",
      success: (data: any) => `PR created successfully! PR #${data.prNumber || ''}`,
      error: (err) => err instanceof Error ? err.message : 'Failed to create PR',
    });
  };

  // Expand run and fetch issues
  const handleExpandRun = async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
    } else {
      setExpandedRun(runId);
      await fetchIssuesForRun(runId);
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "high":
        return <AlertCircle className="w-4 h-4 text-orange-500" />;
      case "medium":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-500/10 text-red-400 border-red-500/20";
      case "high":
        return "bg-orange-500/10 text-orange-400 border-orange-500/20";
      case "medium":
        return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
      case "low":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      default:
        return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    }
  };

  const getStatusIcon = (status: 'active' | 'paused' | 'stopped') => {
    switch (status) {
      case 'active':
        return <Play className="w-3 h-3" />;
      case 'paused':
        return <Pause className="w-3 h-3" />;
      case 'stopped':
        return <Square className="w-3 h-3" />;
    }
  };

  const getStatusColor = (status: 'active' | 'paused' | 'stopped') => {
    switch (status) {
      case 'active':
        return 'text-green-400 bg-green-500/10';
      case 'paused':
        return 'text-yellow-400 bg-yellow-500/10';
      case 'stopped':
        return 'text-red-400 bg-red-500/10';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-red-400 animate-spin" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-6 lg:p-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Error Loading Project</h2>
          <p className="text-zinc-400">{error || "Project not found"}</p>
          <Link
            href="/dashboard/code-police"
            className="inline-flex items-center gap-2 mt-4 text-red-400 hover:text-red-300"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Code Police
          </Link>
        </div>
      </div>
    );
  }

  const latestRun = runs[0];

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard/code-police"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Code Police
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <Shield className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">{project.name}</h1>
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                  {getStatusIcon(project.status)}
                  {project.status}
                </span>
              </div>
              <p className="text-zinc-400">{project.githubFullName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/code-police/${projectId}/analytics`}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-medium rounded-lg transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              Analytics
            </Link>
            <button
              onClick={simulatePR}
              disabled={isSimulating || project.status !== 'active'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isSimulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitPullRequest className="w-4 h-4" />}
              Demo PR Impact
            </button>
            <button
              onClick={runAnalysis}
              disabled={isAnalyzing || project.status !== 'active'}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Analysis
                </>
              )}
            </button>
            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 text-zinc-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              <Settings className="w-5 h-5 text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Custom Rules Display */}
        {project.customRules && project.customRules.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {project.customRules.slice(0, 3).map((rule, i) => (
              <span key={i} className="px-2 py-1 bg-zinc-800 text-zinc-400 text-xs rounded-lg">
                {rule}
              </span>
            ))}
            {project.customRules.length > 3 && (
              <span className="px-2 py-1 bg-zinc-800 text-zinc-500 text-xs rounded-lg">
                +{project.customRules.length - 3} more rules
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      {latestRun && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {(["critical", "high", "medium", "low", "info"] as const).map((severity) => (
            <div
              key={severity}
              className={`p-4 rounded-xl border ${getSeverityColor(severity)}`}
            >
              <p className="text-2xl font-bold">
                {latestRun.issueCounts[severity] || 0}
              </p>
              <p className="text-sm capitalize">{severity}</p>
            </div>
          ))}
        </div>
      )}

      {/* Analysis Runs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Analysis History</h2>
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Auto-refresh every 30s
          </span>
        </div>

        {/* Real-time WebSocket Progress Card */}
        {analysisProgress && (
          <div className="bg-zinc-950/80 border border-red-500/25 rounded-2xl p-6 space-y-4 shadow-xl shadow-red-950/10 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-red-500/10 animate-pulse">
                  <Shield className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    Analyzing Codebase...
                  </h3>
                  <p className="text-xs text-zinc-400">{analysisProgress.status}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-sm font-bold text-red-400">{analysisProgress.progress}%</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${analysisProgress.progress}%` }}
              />
            </div>

            {/* Terminal logs viewer */}
            {analysisProgress.logs && analysisProgress.logs.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Analysis Logs</span>
                  {analysisProgress.details && (
                    <span className="text-[10px] text-zinc-500 truncate max-w-[200px] font-mono">{analysisProgress.details}</span>
                  )}
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 h-36 overflow-y-auto font-mono text-xs text-zinc-300 space-y-1 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                  {analysisProgress.logs.map((log, index) => {
                    const isError = log.includes("Error:") || log.includes("failed");
                    const isSuccess = log.includes("complete") || log.includes("success");
                    return (
                      <div 
                        key={index} 
                        className={`leading-relaxed whitespace-pre-wrap select-all ${
                          isError ? "text-red-400 font-medium" : isSuccess ? "text-emerald-400 font-medium" : "text-zinc-300"
                        }`}
                      >
                        {log}
                      </div>
                    );
                  })}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        )}

        {runs.length === 0 ? (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 text-center">
            <Clock className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No Analysis Runs Yet</h3>
            <p className="text-zinc-400">
              Push code to your repository to trigger the first analysis.
            </p>
          </div>
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
              className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden"
            >
              {/* Run Header */}
              <button
                onClick={() => handleExpandRun(run.id)}
                className="w-full p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <GitCommit className="w-5 h-5 text-zinc-500" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-white">
                      {run.commitSha?.slice(0, 7) || 'Unknown'}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {run.branch} • {new Date(run.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Issue counts summary */}
                  <div className="flex gap-2">
                    {run.issueCounts?.critical > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">
                        {run.issueCounts.critical} critical
                      </span>
                    )}
                    {run.issueCounts?.high > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-400">
                        {run.issueCounts.high} high
                      </span>
                    )}
                    {(run.issueCounts?.medium > 0 || run.issueCounts?.low > 0) && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">
                        {(run.issueCounts?.medium || 0) + (run.issueCounts?.low || 0)} other
                      </span>
                    )}
                  </div>

                  {expandedRun === run.id ? (
                    <ChevronUp className="w-5 h-5 text-zinc-500" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-zinc-500" />
                  )}
                </div>
              </button>

              {/* Expanded Content */}
              {expandedRun === run.id && (
                <div className="border-t border-zinc-800 p-4 space-y-4">
                  {/* Summary */}
                  {run.summary && (
                    <p className="text-sm text-zinc-400">{run.summary}</p>
                  )}

                  {/* Dependency impact + merge-conflict pre-check (PR runs) */}
                  {run.impact && (
                    <DependencyImpact data={run.impact} />
                  )}

                  {/* Auto-fix PR (from webhook) or Manual Fix with PR Button */}
                  {run.status === 'completed' && (Object.values(run.issueCounts || {}).reduce((a, b) => a + b, 0) > 0) && (
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Show auto-fix PR if available */}
                      {run.autoFixPrUrl && (
                        <a
                          href={run.autoFixPrUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-lg hover:from-emerald-500 hover:to-green-500 transition-all"
                        >
                          <GitPullRequest className="w-4 h-4" />
                          Auto-fix PR #{run.autoFixPrNumber}
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}

                      {/* Manual Fix with PR button (only show if no auto-fix PR) */}
                      {!run.autoFixPrUrl && (
                        <button
                          onClick={() => createFixPR(run.id)}
                          disabled={isCreatingPR === run.id}
                          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-lg hover:from-emerald-500 hover:to-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {isCreatingPR === run.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <GitPullRequest className="w-4 h-4" />
                          )}
                          {isCreatingPR === run.id ? 'Creating PR...' : 'Fix with PR'}
                        </button>
                      )}

                      {/* Show auto-fix stats if available */}
                      {run.autoFixesGenerated !== undefined && run.autoFixesGenerated > 0 && (
                        <span className="text-xs text-zinc-500">
                          {run.autoFixesGenerated} fixes, {run.autoFixFilesChanged || 0} files changed
                        </span>
                      )}

                      {/* Show auto-fix error if it failed */}
                      {run.autoFixError && !run.autoFixPrUrl && (
                        <span className="text-xs text-amber-400">
                          Auto-fix: {run.autoFixError}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Detailed Issues List */}
                  {isLoadingIssues === run.id ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                      <span className="ml-2 text-zinc-400">Loading issues...</span>
                    </div>
                  ) : issues[run.id] && issues[run.id].length > 0 ? (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-white flex items-center gap-2">
                        <FileCode className="w-4 h-4" />
                        Detailed Issues ({issues[run.id].length})
                      </h4>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {issues[run.id].map((issue) => (
                          <div key={issue.id} className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700">
                            <div className="flex items-start gap-3">
                              {getSeverityIcon(issue.severity)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-white">{issue.filePath}</span>
                                  <span className="text-xs text-zinc-500">
                                    Line {issue.line}{issue.endLine && issue.endLine !== issue.line ? `-${issue.endLine}` : ''}
                                  </span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${issue.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                                    issue.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                      issue.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                        'bg-zinc-500/20 text-zinc-400'
                                    }`}>
                                    {issue.severity}
                                  </span>
                                  <span className="text-xs text-zinc-600">{issue.category}</span>
                                </div>
                                <p className="text-sm text-white mt-1">{issue.message}</p>
                                {issue.explanation && (
                                  <p className="text-xs text-zinc-400 mt-1">{issue.explanation}</p>
                                )}
                                {issue.codeSnippet && (
                                  <pre className="mt-2 p-2 bg-zinc-900 rounded text-xs text-zinc-300 overflow-x-auto">
                                    <code>{issue.codeSnippet}</code>
                                  </pre>
                                )}
                                {issue.suggestedFix && (
                                  <div className="mt-2 p-2 bg-emerald-900/20 border border-emerald-800/50 rounded">
                                    <p className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                                      <Wrench className="w-3 h-3" /> Suggested Fix:
                                    </p>
                                    <p className="text-xs text-emerald-300 mt-1">{issue.suggestedFix}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-5 gap-2">
                      {Object.entries(run.issueCounts || {}).map(([severity, count]) => (
                        <div key={severity} className={`p-2 rounded-lg text-center ${getSeverityColor(severity)}`}>
                          <p className="text-lg font-bold">{count}</p>
                          <p className="text-xs capitalize">{severity}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && project && (
        <ProjectSettings
          project={{
            id: project.id,
            status: project.status,
            customRules: project.customRules || [],
            ownerEmail: project.ownerEmail,
            autoFixEnabled: project.autoFixEnabled,
            notificationPrefs: project.notificationPrefs,
          }}
          onUpdate={handleUpdateProject}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
