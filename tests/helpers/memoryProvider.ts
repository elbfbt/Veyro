import type {
  CatalogCategory,
  CatalogKeysView,
  ImportStats,
  M3uEntry,
  ProviderRepository,
  StoredProvider,
} from '../../worker/services/iptv/types';

export class MemoryProviderRepository implements ProviderRepository {
  readonly providers = new Map<string, StoredProvider>();
  readonly catalog = new Map<string, M3uEntry[]>();
  readonly categories = new Map<string, CatalogCategory[]>();
  readonly imports = new Map<string, ImportStats>();

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
        metadata: {},
      });
    }
    this.imports.set(providerId, stats);
    return 'playlist-id';
  }
}
