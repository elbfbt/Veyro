import type {
  CatalogCategory,
  CatalogKeysView,
  ImportJob,
  ImportStats,
  ImportJobStatus,
  M3uEntry,
  ProviderRepository,
  StoredProvider,
} from '../../worker/services/iptv/types';

export class MemoryProviderRepository implements ProviderRepository {
  readonly providers = new Map<string, StoredProvider>();
  readonly catalog = new Map<string, M3uEntry[]>();
  readonly categories = new Map<string, CatalogCategory[]>();
  readonly imports = new Map<string, ImportStats>();
  readonly importJobs = new Map<string, ImportJob>();

  private key(userId: string, id: string) {
    return `${userId}:${id}`;
  }

  async list(userId: string) {
    return [...this.providers.values()].filter((provider) => provider.userId === userId);
  }

  async find(userId: string, id: string) {
    return this.providers.get(this.key(userId, id)) ?? null;
  }

  async create(provider: StoredProvider) {
    if (provider.isDefault) {
      for (const existing of await this.list(provider.userId)) {
        this.providers.set(this.key(existing.userId, existing.id), { ...existing, isDefault: false });
      }
    }
    this.providers.set(this.key(provider.userId, provider.id), provider);
  }

  async update(userId: string, id: string, patch: Partial<StoredProvider>, now: number) {
    const provider = await this.find(userId, id);
    if (!provider) return false;
    this.providers.set(this.key(userId, id), { ...provider, ...patch, updatedAt: now });
    return true;
  }

  async remove(userId: string, id: string) {
    return this.providers.delete(this.key(userId, id));
  }

  async setDefault(userId: string, id: string, now: number) {
    const provider = await this.find(userId, id);
    if (!provider) return false;
    for (const existing of await this.list(userId)) {
      this.providers.set(this.key(userId, existing.id), { ...existing, isDefault: existing.id === id, updatedAt: now });
    }
    return true;
  }

  async loadCatalogKeys(): Promise<CatalogKeysView> {
    return {
      channels: new Map(),
      movies: new Map(),
      series: new Map(),
      episodes: new Map(),
      categories: new Map(),
    };
  }

  async saveCatalog(
    _userId: string,
    providerId: string,
    entries: M3uEntry[],
    _keys: CatalogKeysView,
    _ids: { newId(): string },
    _now: number,
    categories: CatalogCategory[] = [],
  ) {
    this.catalog.set(providerId, entries);
    this.categories.set(providerId, categories);
    return { added: entries.length, updated: 0, categoriesAdded: categories.length };
  }

  async saveImport(_userId: string, providerId: string, _checksum: string, stats: ImportStats, now: number) {
    const provider = [...this.providers.values()].find((item) => item.id === providerId);
    if (provider) {
      this.providers.set(this.key(provider.userId, providerId), {
        ...provider,
        lastRefreshAt: now,
        status: 'active',
        metadata: { lastImport: stats },
      });
    }
    this.imports.set(providerId, stats);
    return 'playlist-id';
  }

  async cancelImportJob(
    _userId: string,
    jobId: string,
    _now: number,
  ) {
    const job = this.importJobs.get(jobId);
    if (!job || job.userId !== _userId) return false;
    if (job.status === 'completed') return false;

    // Delete catalogue entries for the provider
    this.catalog.delete(job.providerId);
    this.categories.delete(job.providerId);

    // Delete the import job
    this.importJobs.delete(jobId);

    // Delete the provider
    return this.providers.delete(this.key(_userId, job.providerId));
  }

  async cleanupExpiredImportJobs(_userId: string, now: number) {
    const expiredJobIds = [...this.importJobs.values()]
      .filter((job) => job.userId === _userId && job.expiresAt <= now && job.status !== 'completed')
      .map((job) => job.id);

    let cleaned = 0;
    for (const jobId of expiredJobIds) {
      const cancelled = await this.cancelImportJob(_userId, jobId, now);
      if (cancelled) cleaned += 1;
    }
    return cleaned;
  }

  async createImportJob(
    _userId: string,
    providerId: string,
    filename: string,
    totalEntries: number,
    totalChunks: number,
    now: number,
  ) {
    const id = `import-job-${Math.random().toString(36).slice(2)}`;
    const job: ImportJob = {
      id,
      userId: _userId,
      providerId,
      filename,
      totalEntries,
      importedEntries: 0,
      totalChunks,
      completedChunks: 0,
      lastProcessedChunk: -1,
      lastChunkHash: null,
      status: 'pending' as ImportJobStatus,
      error: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 24 * 60 * 60,
    };
    this.importJobs.set(id, job);
    return id;
  }

  async getImportJob(userId: string, jobId: string, now: number) {
    const job = this.importJobs.get(jobId);
    if (!job || job.userId !== userId || job.expiresAt <= now) return null;
    return job;
  }

  async updateImportJob(
    userId: string,
    jobId: string,
    patch: Partial<ImportJob>,
    now: number,
    expectedCompletedChunks?: number,
    expectedLastProcessedChunk?: number,
  ) {
    // Synchronous check-and-set: no await between reading and writing the Map,
    // so no other request can interleave between the check and the update.
    const job = this.importJobs.get(jobId);
    if (!job || job.userId !== userId || job.expiresAt <= now) return false;

    // Atomic sequencing: only advance if the job is still at the expected position.
    if (expectedCompletedChunks !== undefined && job.completedChunks !== expectedCompletedChunks) {
      return false;
    }
    if (expectedLastProcessedChunk !== undefined && job.lastProcessedChunk !== expectedLastProcessedChunk) {
      return false;
    }

    this.importJobs.set(jobId, { ...job, ...patch, updatedAt: now });
    return true;
  }
}
