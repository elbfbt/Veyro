import { describe, expect, it } from 'vitest';
import {
  chunkEntries,
  createIncrementalM3uParser,
  INVALID_PLAYLIST_MESSAGE,
  MAX_TOTAL_ENTRIES,
  parseM3u,
  PlaylistLimitError,
} from '../src/lib/m3uParser';

function entryLines(count: number, url: (index: number) => string = (index) => `https://s.test/${index}`) {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < count; index += 1) {
    lines.push(`#EXTINF:-1 tvg-id="ch-${index}",Channel ${index}`);
    lines.push(url(index));
  }
  return lines.join('\n');
}

describe('parseM3u — duplicate stream URLs', () => {
  it('terminates and keeps every entry when the same URL is repeated', () => {
    // Regression: the dedupe loop keyed on the stream URL as well as the id and
    // spun forever (freezing the UI) as soon as a URL appeared twice.
    const playlist = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="news",News',
      'https://stream.test/live.m3u8',
      '#EXTINF:-1 tvg-id="news",News backup',
      'https://stream.test/live.m3u8',
      '#EXTINF:-1 tvg-id="news",News again',
      'https://stream.test/live.m3u8',
    ].join('\n');

    const result = parseM3u(playlist);

    expect(result.totalEntries).toBe(3);
    expect(result.entries.map((entry) => entry.externalId)).toEqual(['news', 'news-1', 'news-2']);
    expect(result.entries.map((entry) => entry.name)).toEqual(['News', 'News backup', 'News again']);
    expect(result.entries.every((entry) => entry.streamUrl === 'https://stream.test/live.m3u8')).toBe(true);
  });

  it('keeps entries that share a tvg-id but point at different URLs', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="0",One',
      'https://stream.test/one.m3u8',
      '#EXTINF:-1 tvg-id="0",Two',
      'https://stream.test/two.m3u8',
      '#EXTINF:-1 tvg-id="0",Three',
      'https://stream.test/three.m3u8',
    ].join('\n');

    const result = parseM3u(playlist);
    expect(result.entries.map((entry) => entry.externalId)).toEqual(['0', '0-1', '0-2']);
  });

  it('derives unique ids from the URL when no id attributes are present', () => {
    const playlist = ['#EXTM3U', 'https://stream.test/a.m3u8', 'https://stream.test/a.m3u8'].join('\n');
    const result = parseM3u(playlist);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.externalId).not.toBe(result.entries[1]?.externalId);
  });
});

describe('incremental parser', () => {
  it('returns the same entries as parseM3u when fed arbitrary slices', () => {
    const playlist = [
      '\uFEFF#EXTM3U',
      '#EXTINF:-1 tvg-id="news" tvg-name="News" group-title="News", Breaking News',
      'https://stream.test/live/news.m3u8',
      '',
      '# a comment',
      '#EXTINF:-1 group-title="Cinema",A Film',
      'https://stream.test/movies/film.mp4',
      '#EXTINF:-1,Same URL',
      'https://stream.test/live/news.m3u8',
    ].join('\r\n');

    const whole = parseM3u(playlist);

    for (const sliceSize of [1, 2, 3, 7, 64, playlist.length]) {
      const parser = createIncrementalM3uParser();
      const entries = [];
      for (let offset = 0; offset < playlist.length; offset += sliceSize) {
        entries.push(...parser.push(playlist.slice(offset, offset + sliceSize)));
      }
      const tail = parser.finish();
      entries.push(...tail.entries);
      expect(entries).toEqual(whole.entries);
      expect(tail.totalEntries).toBe(whole.totalEntries);
    }
  });

  it('reports entries as they complete', () => {
    const parser = createIncrementalM3uParser();
    expect(parser.push('#EXTM3U\n#EXTINF:-1,One\nhttps://s.test/1')).toHaveLength(0);
    expect(parser.push('\n')).toHaveLength(1);
    expect(parser.totalEntries).toBe(1);
    const tail = parser.finish();
    expect(tail.entries).toHaveLength(0);
    expect(tail.totalEntries).toBe(1);
  });

  it('flushes a final line that has no trailing newline', () => {
    const parser = createIncrementalM3uParser();
    parser.push('#EXTM3U\n#EXTINF:-1,One\nhttps://s.test/1');
    const tail = parser.finish();
    expect(tail.entries).toHaveLength(1);
    expect(tail.entries[0]?.streamUrl).toBe('https://s.test/1');
  });
});

describe('parser validation', () => {
  it('rejects files without an #EXTM3U header', () => {
    expect(() => parseM3u('https://stream.example.com/a\n')).toThrow(INVALID_PLAYLIST_MESSAGE);
    expect(() => parseM3u('')).toThrow(INVALID_PLAYLIST_MESSAGE);
    expect(() => createIncrementalM3uParser().finish()).toThrow(INVALID_PLAYLIST_MESSAGE);
  });

  it('ignores unsupported schemes', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:-1,Bad',
      'javascript:alert(1)',
      '#EXTINF:-1,Bad',
      'file:///etc/passwd',
      '#EXTINF:-1,Good',
      'https://stream.test/good.m3u8',
    ].join('\n');
    expect(parseM3u(playlist).entries.map((entry) => entry.name)).toEqual(['Good']);
  });

  it(`enforces the ${MAX_TOTAL_ENTRIES.toLocaleString('en-US')} entry limit`, () => {
    expect(MAX_TOTAL_ENTRIES).toBe(100_000);
    const playlist = entryLines(3);
    expect(() => parseM3u(playlist, { maxEntries: 2 })).toThrow(PlaylistLimitError);
    expect(() => parseM3u(playlist, { maxEntries: 2 })).toThrow(/entry limit/);
    expect(parseM3u(playlist, { maxEntries: 3 }).totalEntries).toBe(3);
  });

  it('enforces the limit in the incremental parser too', () => {
    const parser = createIncrementalM3uParser({ maxEntries: 1 });
    expect(() => parser.push(`${entryLines(2)}\n`)).toThrow(PlaylistLimitError);
  });
});

describe('chunkEntries', () => {
  it('splits entries into fixed size chunks', () => {
    const chunks = chunkEntries([1, 2, 3, 4, 5], 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkEntries([], 2)).toEqual([]);
  });
});
