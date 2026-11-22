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
    await register(harness, 'owner@example.com');
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

  /* ── Idempotency & retry ────────────────────────────────────── */

  it('rejects empty chunks', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 1, 1);
    await submitChunk(harness, jobId, 0, [], 400);
  });

  it('allows identical chunk retry without double-counting', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 2, 1);
    const entries = [makeEntry(0), makeEntry(1)];

    // First submission succeeds
    const first = await submitChunk(harness, jobId, 0, entries);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.importedEntries).toBe(2);

    // Identical retry (lost response scenario) — same chunkIndex, same payload
    const retry = await submitChunk(harness, jobId, 0, entries);
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.importedEntries).toBe(2); // not double-counted

    // Progress still shows 2 entries, 1 chunk
    const progress = await getProgress(harness, jobId);
    expect(progress!.importedEntries).toBe(2);
    expect(progress!.completedChunks).toBe(1);
  });

  it('rejects chunk retry with different payload', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 2, 1);
    const entriesA = [makeEntry(0, { externalId: 'id-a' })];
    const entriesB = [makeEntry(0, { externalId: 'id-b' })];

    await submitChunk(harness, jobId, 0, entriesA);

    // Same chunk index, different payload → conflict
    await submitChunk(harness, jobId, 0, entriesB, 409);
  });

  it('atomic updateImportJob prevents double-counting (repository level)', async () => {
    const { repository } = setup();
    const userId = 'test-user';
    const now = 1_700_000_000;

    // Create a job directly in the repository
    const jobId = await repository.createImportJob(userId, 'provider-1', 'test', 2, 1, now);
    await repository.updateImportJob(userId, jobId, { status: 'importing' }, now);

    // First update should succeed (expected CC=0, LPC=-1)
    const result1 = await repository.updateImportJob(
      userId, jobId,
      { importedEntries: 2, completedChunks: 1, lastProcessedChunk: 0, lastChunkHash: 'hash-1' },
      now, 0, -1,
    );
    expect(result1).toBe(true);

    // Verify state advanced
    const job = await repository.getImportJob(userId, jobId, now);
    expect(job!.completedChunks).toBe(1);
    expect(job!.importedEntries).toBe(2);

    // Second update with same expected position should fail (CC is now 1, not 0)
    const result2 = await repository.updateImportJob(
      userId, jobId,
      { importedEntries: 4, completedChunks: 2, lastProcessedChunk: 0, lastChunkHash: 'hash-2' },
      now, 0, -1,
    );
    expect(result2).toBe(false);

    // State should be unchanged
    const job2 = await repository.getImportJob(userId, jobId, now);
    expect(job2!.completedChunks).toBe(1);
    expect(job2!.importedEntries).toBe(2);
  });

  it('lost-response retry then continues to next chunk', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 4, 2);

    // Chunk 0 succeeds
    const chunk0 = [makeEntry(0), makeEntry(1)];
    await submitChunk(harness, jobId, 0, chunk0);

    // Lost response — retry chunk 0 with identical payload
    await submitChunk(harness, jobId, 0, chunk0);

    // Continue with chunk 1
    const chunk1 = [makeEntry(2), makeEntry(3)];
    await submitChunk(harness, jobId, 1, chunk1);

    const progress = await getProgress(harness, jobId);
    expect(progress!.status).toBe('completed');
    expect(progress!.importedEntries).toBe(4);
    expect(progress!.completedChunks).toBe(2);
  });

  /* ── Expiry ─────────────────────────────────────────────────── */

  async function createExpiredJob(
    harness: ReturnType<typeof setup>['harness'],
    repository: MemoryProviderRepository,
    _userId: string,
  ) {
    const { jobId, providerId } = await initJob(harness, 1, 1);
    // Manually expire the job by setting expiresAt to the past
    const job = repository.importJobs.get(jobId);
    if (job) {
      job.expiresAt = 1; // far in the past
      repository.importJobs.set(jobId, job);
    }
    return { jobId, providerId };
  }

  it('expired job cannot accept chunks', async () => {
    const { harness, repository } = setup();
    const userId = await register(harness, 'owner@example.com');

    const { jobId } = await createExpiredJob(harness, repository, userId);
    await submitChunk(harness, jobId, 0, [makeEntry(0)], 404);
  });

  it('expired job cannot be queried for progress', async () => {
    const { harness, repository } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await createExpiredJob(harness, repository, 'owner@example.com');
    await getProgress(harness, jobId, 404);
  });

  it('expired job cannot be completed', async () => {
    const { harness, repository } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await createExpiredJob(harness, repository, 'owner@example.com');
    await completeJob(harness, jobId, 404);
  });

  /* ── Provider visibility / state ───────────────────────────── */

  it('provider is not active before import completion', async () => {
    const { harness, repository } = setup();
    const userId = await register(harness, 'owner@example.com');

    const { jobId, providerId } = await initJob(harness, 2, 1);
    await submitChunk(harness, jobId, 0, [makeEntry(0), makeEntry(1)]);

    // Provider exists but is still in importing state (metadata has import_status)
    const provider = await repository.find(userId, providerId);
    expect(provider).not.toBeNull();
    expect(provider!.metadata.import_status).toBe('importing');
    expect(provider!.metadata.import_job_id).toBe(jobId);
  });

  it('provider becomes active only after importComplete', async () => {
    const { harness, repository } = setup();
    const userId = await register(harness, 'owner@example.com');

    const { jobId, providerId } = await initJob(harness, 1, 1);
    await submitChunk(harness, jobId, 0, [makeEntry(0)]);

    // Before completion: still importing
    let provider = await repository.find(userId, providerId);
    expect(provider!.metadata.import_status).toBe('importing');

    // After completion: active, metadata cleared
    await completeJob(harness, jobId);
    provider = await repository.find(userId, providerId);
    expect(provider!.metadata.import_status).toBeUndefined();
    expect(provider!.status).toBe('active');
  });

  it('incomplete import cannot be finalized', async () => {
    const { harness, repository } = setup();
    const userId = await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 2, 2);
    // Submit only chunk 0, leaving chunk 1 pending
    await submitChunk(harness, jobId, 0, [makeEntry(0)]);

    // importComplete should fail because not all chunks are done
    await completeJob(harness, jobId, 400);

    // Provider should not be active
    const allProviders = await repository.list(userId);
    expect(allProviders.length).toBeGreaterThan(0);
    const importedProvider = allProviders.find((p) => p.metadata.import_status === 'importing');
    expect(importedProvider).not.toBeUndefined();
  });

  it('chunk response status is importing for non-final chunks', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 2, 2);
    const result = await submitChunk(harness, jobId, 0, [makeEntry(0)]);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.status).toBe('importing');
  });

  it('chunk response status is completed for final chunk', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 1, 1);
    const result = await submitChunk(harness, jobId, 0, [makeEntry(0)]);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.status).toBe('completed');
  });

  /* ── Concurrency & recovery ─────────────────────────────────── */

  it('identical concurrent chunk submissions do not produce 500', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId } = await initJob(harness, 2, 1);
    const entries = [makeEntry(0), makeEntry(1)];

    // Submit the same chunk twice concurrently via raw harness calls
    const results = await Promise.all([
      harness.call('POST', `/api/providers/import-chunk/${jobId}`, {
        chunkIndex: 0,
        entries,
      }),
      harness.call('POST', `/api/providers/import-chunk/${jobId}`, {
        chunkIndex: 0,
        entries,
      }),
    ]);

    const statuses = results.map((r) => r.status);
    // No 500 errors allowed from concurrent submissions
    expect(statuses).not.toContain(500);
    // At least one request must succeed
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    // No request should get a server error
    expect(statuses.filter((s) => s >= 500).length).toBe(0);

    // No double-counting regardless of which request(s) succeeded
    const progress = await getProgress(harness, jobId);
    expect(progress!.importedEntries).toBe(2);
    expect(progress!.completedChunks).toBe(1);
  });

  it('provider has importing flag during chunked import', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId, providerId } = await initJob(harness, 2, 1);
    await submitChunk(harness, jobId, 0, [makeEntry(0)]);

    // Provider appears in list with importing=true
    const listResponse = await harness.call('GET', '/api/providers');
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    const providers = listBody.providers as { id: string; importing: boolean; status: string }[];
    const importedProvider = providers.find((p) => p.id === providerId);
    expect(importedProvider).not.toBeUndefined();
    expect(importedProvider!.importing).toBe(true);
    expect(importedProvider!.status).toBe('active');

    // Provider get also shows importing=true
    const getResponse = await harness.call('GET', `/api/providers/${providerId}`);
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.provider.importing).toBe(true);
  });

  it('provider is active and not importing after successful completion', async () => {
    const { harness } = setup();
    await register(harness, 'owner@example.com');

    const { jobId, providerId } = await initJob(harness, 1, 1);
    await submitChunk(harness, jobId, 0, [makeEntry(0)]);

    // Before completion: importing
    let getResponse = await harness.call('GET', `/api/providers/${providerId}`);
    expect((await getResponse.json()).provider.importing).toBe(true);

    // After completion: active, not importing
    await completeJob(harness, jobId);

    getResponse = await harness.call('GET', `/api/providers/${providerId}`);
    const provider = (await getResponse.json()).provider;
    expect(provider.importing).toBe(false);
    expect(provider.status).toBe('active');
  });

  it('expired import job does not appear as completed provider', async () => {
    const { harness, repository } = setup();
    await register(harness, 'owner@example.com');

    const { jobId, providerId } = await initJob(harness, 1, 1);

    // Expire the job
    const job = repository.importJobs.get(jobId);
    if (job) {
      job.expiresAt = 1;
      repository.importJobs.set(jobId, job);
    }

    // Cannot submit chunk
    await submitChunk(harness, jobId, 0, [makeEntry(0)], 404);

    // Provider appears but is NOT completed — it still has import_status='importing'
    const listResponse = await harness.call('GET', '/api/providers');
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    const providers = listBody.providers as { id: string; importing: boolean }[];
    const importedProvider = providers.find((p) => p.id === providerId);
    expect(importedProvider).not.toBeUndefined();
    expect(importedProvider!.importing).toBe(true);
  });

  /* ── Cancel endpoint ─────────────────────────────────────────── */

  async function cancelJob(
    harness: ReturnType<typeof setup>['harness'],
    jobId: string,
    expectedStatus = 200,
  ) {
    const response = await harness.call('DELETE', `/api/providers/import-cancel/${jobId}`);
    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) {
      return (await response.json()) as { ok: boolean };
    }
    return null;
  }

  it('cancels own active chunked import job', async () => {
    const { harness, repository } = setup();
    const userId = await register(harness, 'cancel-owner@example.com');

    // 3 entries across 2 chunks — submit only chunk 0, leaving job active
    const { jobId, providerId } = await initJob(harness, 3, 2);
    await submitChunk(harness, jobId, 0, [makeEntry(0), makeEntry(1)]);

    // Job exists and provider exists before cancel
    const jobBefore = await repository.getImportJob(userId, jobId, 1_700_000_000);
    expect(jobBefore).not.toBeNull();
    expect(jobBefore!.status).toBe('importing');
    const providerBefore = await repository.find(userId, providerId);
    expect(providerBefore).not.toBeNull();

    const result = await cancelJob(harness, jobId);
    expect(result!.ok).toBe(true);

    // Job is deleted
    const jobAfter = await repository.getImportJob(userId, jobId, 1_700_000_000);
    expect(jobAfter).toBeNull();

    // Temporary provider is deleted
    const providerAfter = await repository.find(userId, providerId);
    expect(providerAfter).toBeNull();

    // Catalogue entries are deleted
    expect(repository.catalog.get(providerId)).toBeUndefined();
  });

  it('cannot cancel another user’s job', async () => {
    const { harness, other, repository } = setup();
    const ownerId = await register(harness, 'cancel-owner@example.com');
    await register(other, 'cancel-other@example.com');

    const { jobId } = await initJob(harness, 1, 1);

    // Other user cannot access the job
    const response = await other.call('DELETE', `/api/providers/import-cancel/${jobId}`);
    expect(response.status).toBe(404);

    // Job still exists for the owner
    const job = await repository.getImportJob(ownerId, jobId, 1_700_000_000);
    expect(job).not.toBeNull();
  });

  it('cannot cancel a completed import job', async () => {
    const { harness } = setup();
    await register(harness, 'cancel-complete@example.com');

    const { jobId, providerId } = await initJob(harness, 1, 1);
    await submitChunk(harness, jobId, 0, [makeEntry(0)]);
    await completeJob(harness, jobId);

    // Cannot cancel a completed job
    const response = await harness.call('DELETE', `/api/providers/import-cancel/${jobId}`);
    expect(response.status).toBe(400);

    // Completed provider still exists
    const provider = await harness.call('GET', `/api/providers/${providerId}`);
    expect(provider.status).toBe(200);
  });

  it('cannot cancel an unknown job', async () => {
    const { harness } = setup();
    await register(harness, 'cancel-unknown@example.com');

    const response = await harness.call('DELETE', '/api/providers/import-cancel/unknown-job');
    expect(response.status).toBe(404);
  });

  it('expired jobs are cleaned up safely', async () => {
    const { harness, repository } = setup();
    const userId = await register(harness, 'cancel-expired@example.com');

    // Create two jobs, expire one
    const { jobId: activeJobId } = await initJob(harness, 1, 1);
    const { jobId: expiredJobId, providerId: expiredProviderId } = await initJob(harness, 1, 1);

    const expiredJob = repository.importJobs.get(expiredJobId);
    if (expiredJob) {
      expiredJob.expiresAt = 1;
      repository.importJobs.set(expiredJobId, expiredJob);
    }

    // Run cleanup
    const cleaned = await repository.cleanupExpiredImportJobs(userId, 1_700_000_000);
    expect(cleaned).toBe(1);

    // Expired job is gone
    const expiredJobAfter = await repository.getImportJob(userId, expiredJobId, 1_700_000_000);
    expect(expiredJobAfter).toBeNull();

    // Expired provider is gone
    const expiredProvider = await repository.find(userId, expiredProviderId);
    expect(expiredProvider).toBeNull();

    // Active job is untouched
    const activeJob = await repository.getImportJob(userId, activeJobId, 1_700_000_000);
    expect(activeJob).not.toBeNull();
  });

  it('existing chunked import still succeeds after cancel tests', async () => {
    const { harness } = setup();
    await register(harness, 'cancel-success@example.com');

    const { jobId } = await initJob(harness, 2, 1);
    await submitChunk(harness, jobId, 0, [makeEntry(0), makeEntry(1)]);
    const provider = await completeJob(harness, jobId);
    expect(provider!.provider.id).toBeDefined();
    expect(provider!.provider.name).toBe('Test Playlist');
  });
});
