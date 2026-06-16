import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../route';
import { getAdminDb } from '@/lib/firebase/admin';

// Mock the admin database initialization
vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(),
}));

describe('GET /api/health', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    // Reset env variables before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return 200 when all systems are healthy', async () => {
    // Set all required environment variables
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_clerk';
    process.env.CLERK_SECRET_KEY = 'sk_test_clerk';
    process.env.GEMINI_API_KEY = 'ai_key_gemini';
    process.env.BYOK_ENCRYPTION_KEY = 'byok_encryption_key_32_chars_long';
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'firebase_api_key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'firebase_project_id';

    // Mock Firestore Admin database instance and document get call
    const mockGet = vi.fn().mockResolvedValue({ exists: true });
    const mockDoc = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });
    const mockDb = { collection: mockCollection };

    vi.mocked(getAdminDb).mockReturnValue(mockDb as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.details.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe(true);
    expect(data.details.env.CLERK_SECRET_KEY).toBe(true);
    expect(data.details.env.GEMINI_API_KEY).toBe(true);
    expect(data.details.env.BYOK_ENCRYPTION_KEY).toBe(true);
    expect(data.details.env.NEXT_PUBLIC_FIREBASE_API_KEY).toBe(true);
    expect(data.details.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID).toBe(true);
    expect(data.details.database.connected).toBe(true);
    expect(mockGet).toHaveBeenCalled();
  });

  it('should return 503 when required environment variables are missing', async () => {
    // Set required environment variables but leave one missing
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_clerk';
    process.env.CLERK_SECRET_KEY = ''; // Missing clerk secret key
    process.env.GEMINI_API_KEY = 'ai_key_gemini';
    process.env.BYOK_ENCRYPTION_KEY = 'byok_encryption_key_32_chars_long';
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'firebase_api_key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'firebase_project_id';

    // Mock DB as working
    const mockGet = vi.fn().mockResolvedValue({ exists: true });
    const mockDoc = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });
    const mockDb = { collection: mockCollection };
    vi.mocked(getAdminDb).mockReturnValue(mockDb as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.details.env.CLERK_SECRET_KEY).toBe(false);
    expect(data.errors).toBeDefined();
    expect(data.errors[0]).toContain('CLERK_SECRET_KEY');
  });

  it('should return 503 when database is not configured', async () => {
    // Set environment variables
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_clerk';
    process.env.CLERK_SECRET_KEY = 'sk_test_clerk';
    process.env.GEMINI_API_KEY = 'ai_key_gemini';
    process.env.BYOK_ENCRYPTION_KEY = 'byok_encryption_key_32_chars_long';
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'firebase_api_key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'firebase_project_id';

    // getAdminDb returns null when database is not configured
    vi.mocked(getAdminDb).mockReturnValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.details.database.connected).toBe(false);
    expect(data.details.database.error).toBe('Not configured');
    expect(data.errors).toBeDefined();
    expect(data.errors[0]).toContain('Firebase Admin SDK is not initialized/configured');
  });

  it('should return 503 when database ping throws an error', async () => {
    // Set environment variables
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_clerk';
    process.env.CLERK_SECRET_KEY = 'sk_test_clerk';
    process.env.GEMINI_API_KEY = 'ai_key_gemini';
    process.env.BYOK_ENCRYPTION_KEY = 'byok_encryption_key_32_chars_long';
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'firebase_api_key';
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'firebase_project_id';

    // Mock DB ping failure
    const mockGet = vi.fn().mockRejectedValue(new Error('Firebase connection refused'));
    const mockDoc = vi.fn().mockReturnValue({ get: mockGet });
    const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });
    const mockDb = { collection: mockCollection };

    vi.mocked(getAdminDb).mockReturnValue(mockDb as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
    expect(data.details.database.connected).toBe(false);
    expect(data.details.database.error).toBe('Firebase connection refused');
    expect(data.errors).toBeDefined();
    expect(data.errors[0]).toContain('Database connection failed: Firebase connection refused');
  });
});
