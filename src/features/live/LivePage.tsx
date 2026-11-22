import { useCallback } from 'react';
import { listChannels } from '../../lib/contentApi';
import { CatalogBrowsePage } from '../content/CatalogBrowsePage';

export function LivePage() {
  const loader = useCallback(async (query: Parameters<typeof listChannels>[0]) => {
    const result = await listChannels({ ...query, sort: 'name' });
    return { items: result.channels, pagination: result.pagination };
  }, []);

  return (
    <CatalogBrowsePage
      eyebrow="Live television"
      title="Live TV"
      description="Browse the channels imported from your providers."
      kind="channel"
      facetType="channel"
      emptyTitle="No live channels found."
      emptyMessage="Add a provider or refresh your playlist to import channels."
      searchLabel="Search channels, tvg names or categories"
      loader={loader}
    />
  );
}
