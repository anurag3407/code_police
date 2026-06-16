import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';

// Force dynamic execution so the health check is not statically built or cached.
export const dynamic = 'force-dynamic';

/**
 * Health check endpoint
 * Verifies that all required API keys are loaded and the database connection is active.
 */
export async function GET() {
  const errors: string[] = [];
  const statusDetails: Record<string, any> = {};

  // 1. Check API Keys Loading
  const requiredEnvVars = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: !!process.env.CLERK_SECRET_KEY,
    GEMINI_API_KEY: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    BYOK_ENCRYPTION_KEY: !!process.env.BYOK_ENCRYPTION_KEY,
    NEXT_PUBLIC_FIREBASE_API_KEY: !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  };

  statusDetails.env = requiredEnvVars;

  // Identify any missing critical environment variables
  const missingVars = Object.entries(requiredEnvVars)
    .filter(([_, loaded]) => !loaded)
    .map(([name]) => name);

  if (missingVars.length > 0) {
    errors.push(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // 2. Check Database Connection
  try {
    const adminDb = getAdminDb();
    if (!adminDb) {
      errors.push('Firebase Admin SDK is not initialized/configured');
      statusDetails.database = { connected: false, error: 'Not configured' };
    } else {
      // Perform a ping / read test on the database
      await adminDb.collection('_health').doc('ping').get();
      statusDetails.database = { connected: true };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown database error';
    errors.push(`Database connection failed: ${msg}`);
    statusDetails.database = { connected: false, error: msg };
  }

  const isHealthy = errors.length === 0;

  const responseBody = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    details: statusDetails,
    ...(errors.length > 0 && { errors }),
  };

  if (!isHealthy) {
    return NextResponse.json(responseBody, { status: 503 });
  }

  return NextResponse.json(responseBody, { status: 200 });
}
