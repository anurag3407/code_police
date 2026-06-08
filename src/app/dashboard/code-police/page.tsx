"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Shield,
  Plus,
  GitBranch,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Trash2,
  Loader2,
} from "lucide-react";
import { GhostfounderLoader } from "@/components/ui/ghostfounder-loader";

/**
 * ============================================================================
 * CODE POLICE - MAIN PAGE
 * ============================================================================
 * Lists all projects with Code Police enabled.
 * Fetches real data from Firestore via API.
 */

interface Project {
  id: string;
  name: string;
  githubFullName: string;
  language: string | null;
  isActive: boolean;
  status: 'active' | 'paused' | 'stopped';
  createdAt: string;
}

interface AnalysisRun {
  id: string;
  projectId: string;
  status: string;
  issueCounts: { critical: number; high: number; medium: number };
  createdAt: string;
}

export default function CodePolicePage() {
  const { userId } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<(Project & { lastRun: AnalysisRun | null })[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!userId) {
      router.push("/sign-in");
      return;
    }

    fetchProjects();
  }, [userId, router, searchQuery]); // Add searchQuery to dependency array

  const fetchProjects = async () => {
    try {
      const response = await fetch(`/api/code-police/projects?search=${searchQuery}`);
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[400px]">
        <GhostfounderLoader size="lg" text="Loading projects..." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-lg bg-red-500/10">
              <Shield className="w-5 h-5 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Code Police</h1>
          </div>
          <p className="text-zinc-400">
            AI-powered code review for your GitHub repositories
          </p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <Link
            href="/dashboard/code-police/connect"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            Connect Repository
          </Link>
        </div>
      </div>

      {/* Projects List */}
      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDisconnect={fetchProjects}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-12 text-center">
      <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <Shield className="w-8 h-8 text-red-400" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        No repositories connected
      </h2>
      <p className="text-zinc-400 mb-6 max-w-md mx-auto">
        Connect your GitHub repositories to enable AI-powered code review on every push and pull request.
      </p>
      <Link
        href="/dashboard/code-police/connect"
        className="inline-flex items-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl transition-colors"
      >
        <Plus className="w-4 h-4" />
        Connect Your First Repository
      </Link>
    </div>
  );
}

function ProjectCard({
  project,
  onDisconnect,
}: {
  project: Project & { lastRun: AnalysisRun | null };
  onDisconnect: () => void;
}) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDisconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setIsDisconnecting(true);
    try {
      const response = await fetch('/api/code-police/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          deleteAnalysisRuns: true,
        }),
      });

      if (response.ok) {
        onDisconnect();
      } else {
        alert('Failed to disconnect repository');
      }
    } catch (error) {
      console.error('Error disconnecting:', error);
      alert('Failed to disconnect repository');
    } finally {
      setIsDisconnecting(false);
      setShowConfirm(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case "running":
        return <Clock className="w-4 h-4 text-yellow-400 animate-pulse" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Clock className="w-4 h-4 text-zinc-400" />;
    }
  };

  const totalIssues = project.lastRun
    ? project.lastRun.issueCounts.critical +
    project.lastRun.issueCounts.high +
    project.lastRun.issueCounts.medium
    : 0;

  // Compute relative date client-side only to prevent hydration mismatch
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    if (project.lastRun?.createdAt) {
      const date = new Date(project.lastRun.createdAt);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) setDateLabel("Today");
      else if (days === 1) setDateLabel("Yesterday");
      else if (days < 7) setDateLabel(`${days} days ago`);
      else setDateLabel(date.toLocaleDateString());
    }
  }, [project.lastRun?.createdAt]);

  const getProjectStatusStyle = (status: 'active' | 'paused' | 'stopped') => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-400';
      case 'paused':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'stopped':
        return 'bg-red-500/10 text-red-400';
    }
  };

  return (
    <div className="group flex items-center justify-between p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-zinc-700 transition-all">
      <Link
        href={`/dashboard/code-police/${project.id}`}
        className="flex items-center gap-4 flex-1"
      >
        <div className="p-3 rounded-xl bg-zinc-800">
          <GitBranch className="w-5 h-5 text-zinc-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-white group-hover:text-red-400 transition-colors">
              {project.name}
            </h3>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${getProjectStatusStyle(project.status)}`}>
              {project.status}
            </span>
          </div>
          <p className="text-sm text-zinc-500">{project.githubFullName}</p>
        </div>
      </Link>

      <div className="flex items-center gap-6">
        {project.language && (
          <span className="text-sm text-zinc-400">{project.language}</span>
        )}
        {project.lastRun ? (
          <>
            <div className="flex items-center gap-2">
              {getStatusIcon(project.lastRun.status)}
              <span className="text-sm text-zinc-400 capitalize">
                {project.lastRun.status}
              </span>
            </div>
            {totalIssues > 0 && (
              <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-orange-500/10 text-orange-400 text-sm">
                <AlertTriangle className="w-3.5 h-3.5" />
                {totalIssues} issues
              </div>
            )}
            <span className="text-sm text-zinc-500" suppressHydrationWarning>
              {dateLabel}
            </span>
          </>
        ) : (
          <span className="text-sm text-zinc-500">No runs yet</span>
        )}

        {/* Disconnect Button */}
        <div className="flex items-center gap-2">
          {showConfirm ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="text-sm text-zinc-400">Confirm?</span>
              <button
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {isDisconnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Yes'
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConfirm(false);
                }}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors group/btn"
              title="Disconnect repository"
            >
              <Trash2 className="w-4 h-4 text-zinc-500 group-hover/btn:text-red-400 transition-colors" />
            </button>
          )}
        </div>

        <Link href={`/dashboard/code-police/${project.id}`}>
          <ArrowRight className="w-5 h-5 text-zinc-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
        </Link>
      </div>
    </div>
  );
}
