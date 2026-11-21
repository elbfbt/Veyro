import { describe, expect, it } from 'vitest';
import { AuthService } from '../worker/services/auth/service';
import { ProviderCredentialCipher } from '../worker/services/iptv/credentials';
import { ProviderService } from '../worker/services/iptv/providerService';
import { createHarness } from './helpers/apiHarness';
import { MemoryAuthRepository, MemoryRateLimiter, TestPasswordHasher } from './helpers/memoryAuth';
import { MemoryProviderRepository } from './helpers/memoryProvider';

const CIPHER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function makeEntry(
  index: number,
  overrides: Partial<{ streamUrl: string; externalId: string; name: string }> = {},
) {
  return {
    externalId: overrides.externalId ?? `ext-${index}`,
    name: overrides.name ?? `Channel ${index}`,
    streamUrl: overrides.streamUrl ?? `https://stream.example.com/${index}.m3u8`,
    tvgId: null,
    tvgName: null,
    tvgLogo: null,
    groupTitle: null,
    country: null,
    language: null,
    channelNumber: null,
    kind: 'channel' as const,
  };
}

function setup() {
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    hasher: new TestPasswordHasher(),
    limiter: new MemoryRateLimiter(),
    clock: { now: () => 1_700_000_000 },
    ids: { newId: () => `auth-${Math.random()}` },
  });
  const repository = new MemoryProviderRepository();
  let counter = 0;
  const providers = new ProviderService({
    repository,
    cipher: new ProviderCredentialCipher(CIPHER_KEY),
    ids: { newId: () => `provider-${++counter}` },
    clock: { now: () => 1_700_000_000 },
    fetchPlaylist: async () => ({ text: '', bytes: 0 }),
  });
  const harness = createHarness(auth, 'https://veyro.test', providers);
  const other = createHarness(auth, 'https://veyro.test', providers);
  return { auth, repository, providers, harness, other };
}

async function register(harness: ReturnType<typeof setup>['harness'], email: string) {
  await harness.call('GET', '/api/auth/csrf');
  const response = await harness.call('POST', '/api/auth/register', {
    email,
    password: 'long-enough-password',
    displayName: email.split('@')[0],
  });
  expect(response.status).toBe(201);
  const me = await harness.call('GET', '/api/auth/me');
  const meBody = await me.json();
  return meBody.user.id as string;
}

async function initJob(
  harness: ReturnType<typeof setup>['harness'],
  totalEntries: number,
  totalChunks: number,
  name = 'Test Playlist',
) {
  const response = await harness.call('POST', '/api/providers/import-init', {
    name,
    totalEntries,
    totalChunks,
    chunkSize: 1000,
    fileSize: 1024,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { jobId: string; providerId: string };
}

async function submitChunk(
  harness: ReturnType<typeof setup>['harness'],
  jobId: string,
  chunkIndex: number,
  entries: unknown[],
  expectedStatus = 200,
) {
  const response = await harness.call(
    'POST',
    `/api/providers/import-chunk/${jobId}`,
    { chunkIndex, entries },
  );
  expect(response.status).toBe(expectedStatus);
  return response;
}

async function getProgress(
  harness: ReturnType<typeof setup>['harness'],
  jobId: string,
  expectedStatus = 200,
) {
  const response = await harness.call('GET', `/api/providers/import/${jobId}/progress`);
  expect(response.status).toBe(expectedStatus);
  if (expectedStatus === 200) {
    return (await response.json()) as {
      jobId: string;
      status: string;
      totalEntries: number;
      importedEntries: number;
      totalChunks: number;
      completedChunks: number;
      percentage: number;
      error: string | null;
      providerId: string;
    };
  }
  return null;
}

async function completeJob(
  harness: ReturnType<typeof setup>['harness'],
  jobId: string,
  expectedStatus = 200,
) {
  const response = await harness.call('POST', `/api/providers/import-complete/${jobId}`, undefined);
  expect(response.status).toBe(expectedStatus);
  if (expectedStatus === 200) {
    return (await response.json()) as { provider: { id: string; name: string } };
  }
  return null;
}

describe('chunked M3U import', () => {
  it('rejects unauthenticated requests (CSRF checked first)', async () => {
    const { harness } = setup();
    await harness.call('GET', '/api/auth/csrf');
    const response = await harness.call('POST', '/api/providers/import-init', {
      name: 'Test',
      totalEntries: 1,
      totalChunks: 1,
      chunkSize: 1,
      fileSize: 10,
    }, { cookie: false });
    // CSRF validation happens before authentication; both 401 and 403 reject unauthenticated access
    expect([401, 403]).toContain(response.status);
  });

  it('requires CSRF token', async () => {
    const { harness } = setup();
    await register(harness, 'csrf@example.com');
    const response = await harness.call('POST', '/api/providers/import-init', {
      name: 'Test',
      totalEntries: 1,
      totalChunks: 1,
      chunkSize: 1,
      fileSize: 10,
    }, { csrf: false });
    expect(response.status).toBe(403);
  });

  it('initializes a job and provider', async () => {
    const { harness, repository } = setup();
    const userId = await register(harness, 'owner@example.com');

    const { jobId, providerId } = await initJob(harness, 3, 1);

    const progress = await getProgress(harness, jobId);
    expect(progress!.status).toBe('importing');
    expect(progress!.totalEntries).toBe(3);
    expect(progress!.importedEntries).toBe(0);
    expect(progress!.totalChunks).toBe(1);
    expect(progress!.completedChunks).toBe(0);
    expect(progress!.percentage).toBe(0);
    expect(progress!.providerId).toBe(providerId);

    const provider = await repository.find(userId, providerId);
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('Test Playlist');
    expect(provider!.type).toBe('m3u_file');
  });

  it('rejects total entries over 100k', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const response = await harness.call('POST', '/api/providers/import-init', {
      name: 'Big',
      totalEntries: 100_001,
      totalChunks: 101,
      chunkSize: 1000,
      fileSize: 1024,
    });
    expect(response.status).toBe(413);
  });

  it('rejects zero entries', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const response = await harness.call('POST', '/api/providers/import-init', {
      name: 'Empty',
      totalEntries: 0,
      totalChunks: 0,
      chunkSize: 0,
      fileSize: 0,
    });
    expect(response.status).toBe(400);
  });

  it('submits chunks sequentially and tracks progress', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 3, 1);

    // Submit chunk 0 with 3 entries
    const entries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    const result = await submitChunk(harness, jobId, 0, entries);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.chunkIndex).toBe(0);
    expect(body.importedEntries).toBe(3);

    const progress = await getProgress(harness, jobId);
    expect(progress!.importedEntries).toBe(3);
    expect(progress!.completedChunks).toBe(1);
    expect(progress!.percentage).toBe(100);
    expect(progress!.status).toBe('completed');
  });

  it('enforces sequential chunk submission', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 2, 2);

    // Try chunk 1 before chunk 0
    const entries = [makeEntry(0)];
    const response = await submitChunk(harness, jobId, 1, entries, 409);
    const body = await response.json();
    expect(body.error).toBe('validation_error');
  });

  it('rejects chunk index out of range', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 3, 1);

    const entries = [makeEntry(0)];
    await submitChunk(harness, jobId, 5, entries, 400);
  });

  it('rejects chunks larger than 1000 entries', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 1001, 2);

    const entries = Array.from({ length: 1001 }, (_, i) => makeEntry(i));
    await submitChunk(harness, jobId, 0, entries, 400);
  });

  it('rejects unsafe stream URLs', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 1, 1);

    const badEntry = makeEntry(0, { streamUrl: 'javascript:alert(1)' });
    await submitChunk(harness, jobId, 0, [badEntry], 400);
  });

  it('rejects entries missing required fields', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 1, 1);

    const badEntry = { ...makeEntry(0), externalId: '' };
    await submitChunk(harness, jobId, 0, [badEntry], 400);
  });

  it('completes the job and returns the provider', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId, providerId } = await initJob(harness, 2, 1);
    await submitChunk(harness, jobId, 0, [makeEntry(0), makeEntry(1)]);

    const provider = await completeJob(harness, jobId);
    expect(provider!.provider.id).toBe(providerId);
    expect(provider!.provider.name).toBe('Test Playlist');

    const progress = await getProgress(harness, jobId);
    expect(progress!.status).toBe('completed');
  });

  it('rejects complete before all chunks are submitted', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 2, 2);
    // Only submit chunk 0 (1 entry), leaving chunk 1 pending
    await submitChunk(harness, jobId, 0, [makeEntry(0)]);

    await completeJob(harness, jobId, 400);
  });

  it('rejects operations on unknown job', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const response = await harness.call('GET', '/api/providers/import/unknown-job/progress');
    expect(response.status).toBe(404);

    await submitChunk(harness, 'unknown-job', 0, [], 404);
    await completeJob(harness, 'unknown-job', 404);
  });

  it('enforces ownership — other user cannot access job', async () => {
    const { harness, other } = setup();
    const ownerId = await register(harness, 'owner@example.com');
    await register(other, 'other@example.com');

    const { jobId } = await initJob(harness, 1, 1);

    const response = await other.call('GET', `/api/providers/import/${jobId}/progress`);
    expect(response.status).toBe(404);
  });

  it('handles small playlist — 3 requests total', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    // 1. init
    const { jobId } = await initJob(harness, 1, 1);

    // 2. chunk
    await submitChunk(harness, jobId, 0, [makeEntry(0)]);

    // 3. complete
    await completeJob(harness, jobId);

    const progress = await getProgress(harness, jobId);
    expect(progress!.status).toBe('completed');
    expect(progress!.percentage).toBe(100);
  });

  it('multi-chunk import — 3 entries across 2 chunks', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    // 2 chunks: chunk 0 has 2 entries, chunk 1 has 1 entry (chunk size = 1)
    const { jobId } = await initJob(harness, 3, 2);

    await submitChunk(harness, jobId, 0, [makeEntry(0), makeEntry(1)]);
    await submitChunk(harness, jobId, 1, [makeEntry(2)]);

    const progress = await getProgress(harness, jobId);
    expect(progress!.status).toBe('completed');
    expect(progress!.importedEntries).toBe(3);
    expect(progress!.completedChunks).toBe(2);
    expect(progress!.percentage).toBe(100);

    await completeJob(harness, jobId);
  });

  it('100k entry cap — accepts up to 100k entries', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const totalEntries = 100_000;
    const totalChunks = 100;

    const { jobId } = await initJob(harness, totalEntries, totalChunks);

    // Submit a few chunks to verify the mechanism works at scale
    for (let i = 0; i < 3; i++) {
      const entries = Array.from({ length: 1000 }, (_, j) =>
        makeEntry(i * 1000 + j),
      );
      await submitChunk(harness, jobId, i, entries);
    }

    const progress = await getProgress(harness, jobId);
    expect(progress!.importedEntries).toBe(3000);
    expect(progress!.completedChunks).toBe(3);
    expect(progress!.percentage).toBe(3);
  });
});
