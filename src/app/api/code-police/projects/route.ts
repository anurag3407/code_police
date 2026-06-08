import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getUserEmail, syncUserEmailToFirestore } from "@/lib/utils/clerk";
import { checkLimit, incrementUsage } from "@/lib/usage";

/**
 * GET /api/code-police/projects
 * List all projects for the authenticated user with their latest analysis runs
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminDb = getAdminDb();
    if (!adminDb) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const projectsSnapshot = await adminDb
      .collection("projects")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    let projects = projectsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        githubFullName: data.githubFullName,
        language: data.language,
        isActive: data.isActive ?? true,
        status: data.status || 'active',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    });

    const searchQuery = request.nextUrl.searchParams.get("search");
    if (searchQuery) {
      const lowerCaseSearchQuery = searchQuery.toLowerCase();
      projects = projects.filter(
        (project) =>
          project.name.toLowerCase().includes(lowerCaseSearchQuery) ||
          project.githubFullName.toLowerCase().includes(lowerCaseSearchQuery)
      );
    }

    // Fetch latest analysis run for each project
    const projectsWithRuns = await Promise.all(
      projects.map(async (project) => {
        let lastRun = null;
        try {
          const runsSnapshot = await adminDb
            .collection('analysis_runs')
            .where('projectId', '==', project.id)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

          if (!runsSnapshot.empty) {
            const runData = runsSnapshot.docs[0].data();
            lastRun = {
              id: runsSnapshot.docs[0].id,
              projectId: project.id,
              status: runData.status,
              issueCounts: runData.issueCounts || { critical: 0, high: 0, medium: 0 },
              createdAt: runData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            };
          }
        } catch (error) {
          // No runs found is fine
        }
        return { ...project, lastRun };
      })
    );

    return NextResponse.json({ projects: projectsWithRuns });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/code-police/projects
 * Create a new project with Code Police enabled
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { githubRepoId, githubFullName, name, defaultBranch, language } = body;

    if (!githubRepoId || !githubFullName || !name) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const adminDb = getAdminDb();
    if (!adminDb) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    // Check usage limit for free users
    const limitCheck = await checkLimit(userId, "codePoliceProjects");
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: "Project limit reached",
          message: `Free tier allows ${limitCheck.limit} Code Police project(s). Upgrade to Pro for unlimited projects.`,
          limit: limitCheck.limit,
          current: limitCheck.current,
          upgradeRequired: true,
        },
        { status: 403 }
      );
    }

    // Check if project already exists
    const existingProject = await adminDb
      .collection("projects")
      .where("githubRepoId", "==", githubRepoId)
      .limit(1)
      .get();

    if (!existingProject.empty) {
      return NextResponse.json(
        { error: "Project already connected" },
        { status: 409 }
      );
    }

    // Generate webhook secret
    const webhookSecret = crypto.randomUUID();

    // Get user email from Clerk (works for both Google and GitHub auth)
    const emailInfo = await getUserEmail(userId);
    let ownerEmail = emailInfo.email || "";

    // If email not available from Clerk, fallback to Firestore
    if (!ownerEmail) {
      const userDoc = await adminDb.collection("users").doc(userId).get();
      const userData = userDoc.data();
      ownerEmail = userData?.email || "";
    } else {
      // Sync email to Firestore for future use
      await syncUserEmailToFirestore(userId, ownerEmail, adminDb);
    }

    // Create project with Vercel-style status and custom rules
    const projectRef = adminDb.collection("projects").doc();
    const project = {
      id: projectRef.id,
      userId,
      name,
      githubRepoId,
      githubFullName,
      githubOwner: githubFullName.split("/")[0],
      githubRepoName: githubFullName.split("/")[1],
      defaultBranch: defaultBranch || "main",
      language: language || null,
      webhookSecret,
      // New Vercel-style fields
      status: "active" as const,
      customRules: [] as string[],
      ownerEmail,
      // Legacy field for backwards compatibility
      isActive: true,
      rulesProfile: {
        strictness: "moderate",
        categories: {
          security: true,
          performance: true,
          readability: true,
          bugs: true,
          tests: true,
          style: true,
        },
        ignorePatterns: ["node_modules/**", "*.min.js", "dist/**"],
        severityThreshold: "low",
      },
      notificationPrefs: {
        emailOnPush: true,
        emailOnPR: false, // PRs get comments, not emails
        minSeverity: "medium",
        additionalEmails: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await projectRef.set(project);

    // Increment usage counter
    await incrementUsage(userId, "codePoliceProjects");

    return NextResponse.json({
      project,
      webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/github`,
      webhookSecret,
    });
  } catch (error) {
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: "Failed to create project" },
      { status: 500 }
    );
  }
}
