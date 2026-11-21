import { describe, expect, it } from 'vitest';
import { classifyEntry } from '../worker/services/iptv/classifier';
import { DEFAULT_MAX_PLAYLIST_ENTRIES, parseM3u } from '../worker/services/iptv/m3uParser';

describe('M3U parser', () => {
  it('parses EXTINF attributes, display names and stream URLs across line endings', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="news.one" tvg-name="News 1" tvg-logo="https://img.test/news.png" group-title="News" tvg-country="US" tvg-language="English" tvg-chno="12", Breaking News',
      'https://stream.example.com/live/news.m3u8',
      '',
      '# a comment',
      '#EXTINF:-1 group-title="Cinema",A Film',
      'https://stream.example.com/movies/film.mp4',
    ].join('\r\n');

    const result = parseM3u(playlist);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      name: 'Breaking News',
      tvgId: 'news.one',
      tvgName: 'News 1',
      tvgLogo: 'https://img.test/news.png',
      groupTitle: 'News',
      country: 'US',
      language: 'English',
      channelNumber: '12',
      kind: 'channel',
    });
    expect(result.entries[1]).toMatchObject({ name: 'A Film', kind: 'movie' });
  });

  it('handles missing metadata, UTF-8 names and malformed entries without crashing', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:-1,São Paulo ≥ HD',
      'https://stream.example.com/sao-paulo',
      '#EXTINF:-1,Orphaned metadata',
      'not-a-url',
      '#EXTINF:-1,Second',
      '  https://stream.example.com/second  ',
    ].join('\n');

    const result = parseM3u(`\uFEFF${playlist}`);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.name).toBe('São Paulo ≥ HD');
    expect(result.entries[0]?.tvgId).toBeNull();
    expect(result.malformedEntries).toBe(1);
    expect(result.skippedEntries).toBe(1);
  });

  it('deduplicates by tvg-id and stream URL', () => {
    const result = parseM3u(
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="same",First',
        'https://stream.example.com/a',
        '#EXTINF:-1 tvg-id="same",Second',
        'https://stream.example.com/b',
        '#EXTINF:-1 tvg-id="other",Third',
        'https://stream.example.com/a',
      ].join('\n'),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.duplicateEntries).toBe(2);
  });

  it('rejects non-M3U content and enforces byte and entry limits', () => {
    expect(() => parseM3u('https://stream.example.com/a\n')).toThrow();
    expect(() => parseM3u('#EXTM3U\nhttps://stream.example.com/a', { maxBytes: 10 })).toThrow(/too large/);
    const many = ['#EXTM3U', ...Array.from({ length: 5 }, (_, index) => `https://stream.example.com/${index}`)].join('\n');
    expect(() => parseM3u(many, { maxEntries: 2 })).toThrow(/too many/);
    expect(DEFAULT_MAX_PLAYLIST_ENTRIES).toBeGreaterThan(0);
  });

  it('classifies episodes, series and conservative live channels', () => {
    expect(classifyEntry({ name: 'Show S02E04', groupTitle: 'Series', streamUrl: 'https://x.test/show' })).toBe('episode');
    expect(classifyEntry({ name: 'Season 1', groupTitle: 'Series', streamUrl: 'https://x.test/show' })).toBe('series');
    expect(classifyEntry({ name: 'BBC', groupTitle: 'News', streamUrl: 'https://x.test/live' })).toBe('channel');
  });
});

describe('M3U parser stream URL scheme safety', () => {
  it('accepts http:// stream URLs', () => {
    const result = parseM3u('#EXTM3U\n#EXTINF:-1,HTTP Stream\nhttp://stream.example.com/live.m3u8');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.streamUrl).toBe('http://stream.example.com/live.m3u8');
    expect(result.malformedEntries).toBe(0);
  });

  it('accepts https:// stream URLs', () => {
    const result = parseM3u('#EXTM3U\n#EXTINF:-1,HTTPS Stream\nhttps://stream.example.com/live.m3u8');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.streamUrl).toBe('https://stream.example.com/live.m3u8');
    expect(result.malformedEntries).toBe(0);
  });

  it('rejects javascript: stream URLs', () => {
    const result = parseM3u('#EXTM3U\n#EXTINF:-1,Bad Stream\njavascript:alert(1)');
    expect(result.entries).toHaveLength(0);
    expect(result.malformedEntries).toBe(1);
  });

  it('rejects data: stream URLs', () => {
    const result = parseM3u('#EXTM3U\n#EXTINF:-1,Bad Stream\ndata:video/mp4;base64,AAAA');
    expect(result.entries).toHaveLength(0);
    expect(result.malformedEntries).toBe(1);
  });

  it('rejects file: stream URLs', () => {
    const result = parseM3u('#EXTM3U\n#EXTINF:-1,Bad Stream\nfile:///etc/passwd');
    expect(result.entries).toHaveLength(0);
    expect(result.malformedEntries).toBe(1);
  });

  it('rejects ftp: stream URLs', () => {
    const result = parseM3u('#EXTM3U\n#EXTINF:-1,Bad Stream\nftp://stream.example.com/live.m3u8');
    expect(result.entries).toHaveLength(0);
    expect(result.malformedEntries).toBe(1);
  });

  it('mixes safe and unsafe entries, keeping only HTTP(S)', () => {
    const result = parseM3u([
      '#EXTM3U',
      '#EXTINF:-1,Good',
      'https://stream.example.com/good.m3u8',
      '#EXTINF:-1,Bad JS',
      'javascript:alert(1)',
      '#EXTINF:-1,Bad Data',
      'data:video/mp4;base64,AAAA',
      '#EXTINF:-1,Also Good',
      'http://stream.example.com/also-good.mp4',
    ].join('\n'));
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.streamUrl).toBe('https://stream.example.com/good.m3u8');
    expect(result.entries[1]?.streamUrl).toBe('http://stream.example.com/also-good.mp4');
    expect(result.malformedEntries).toBe(2);
  });
});
