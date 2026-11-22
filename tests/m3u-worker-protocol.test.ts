import { describe, expect, it } from 'vitest';
import {
  createImportSession,
  DEFAULT_CHUNK_SIZE,
  type ImportSession,
  type ImportSessionOptions,
  type M3uWorkerResponse,
  type PlaylistSource,
} from '../src/lib/m3uWorkerProtocol';

function playlist(count: number): string {
  const lines = ['#EXTM3U'];
  for (let index = 0; index < count; index += 1) {
    lines.push(`#EXTINF:-1 tvg-id="ch-${index}",Channel ${index}`);
    lines.push(`https://stream.test/${index}.m3u8`);
  }
  return lines.join('\n');
}

function file(content: string, name = 'playlist.m3u'): File {
  return new File([content], name, { type: 'application/vnd.apple.mpegurl' });
}

async function settle(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createHarness(options: Partial<ImportSessionOptions> = {}) {
  const messages: M3uWorkerResponse[] = [];
  const session: ImportSession = createImportSession({
    post: (message) => messages.push(message),
    yieldToEventLoop: () => Promise.resolve(),
    ...options,
  });
  return { messages, session };
}

function chunkMessages(messages: M3uWorkerResponse[]) {
  return messages.filter(
    (message): message is Extract<M3uWorkerResponse, { type: 'chunk' }> => message.type === 'chunk',
  );
}

function errorMessages(messages: M3uWorkerResponse[]) {
  return messages.filter(
    (message): message is Extract<M3uWorkerResponse, { type: 'error' }> => message.type === 'error',
  );
}

describe('import session — count mode', () => {
  it('parses the file and reports the total without posting chunks', async () => {
    const { messages, session } = createHarness();
    session.handleMessage({ type: 'start', file: file(playlist(2_500)), mode: 'count' });
    await settle();

    const done = messages.find((message) => message.type === 'done');
    expect(done).toEqual({ type: 'done', total: 2_500 });
    expect(chunkMessages(messages)).toHaveLength(0);

    const progress = messages.filter((message) => message.type === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    const last = progress.at(-1);
    expect(last).toMatchObject({ type: 'progress', parsedEntries: 2_500 });
  });

  it('works when the source can only be read as text', async () => {
    const source: PlaylistSource = { text: async () => playlist(3) };
    const { messages, session } = createHarness();
    session.handleMessage({ type: 'start', file: source, mode: 'count' });
    await settle();
    expect(messages.at(-1)).toEqual({ type: 'done', total: 3 });
  });
});

describe('import session — stream mode', () => {
  it('emits 1,000 entry chunks and waits for an acknowledgement between them', async () => {
    const { messages, session } = createHarness();
    session.handleMessage({ type: 'start', file: file(playlist(2_500)), mode: 'stream' });
    await settle();

    const first = chunkMessages(messages);
    expect(first).toHaveLength(1);
    expect(first[0]?.entries).toHaveLength(DEFAULT_CHUNK_SIZE);
    expect(first[0]?.entries[0]?.name).toBe('Channel 0');

    // Backpressure: nothing else is emitted until the main thread asks.
    expect(messages.some((message) => message.type === 'done')).toBe(false);

    session.handleMessage({ type: 'next' });
    await settle();

    const second = chunkMessages(messages);
    expect(second).toHaveLength(2);
    expect(second[1]?.entries[0]?.name).toBe('Channel 1000');

    session.handleMessage({ type: 'next' });
    await settle();
    session.handleMessage({ type: 'next' });
    await settle();

    const all = chunkMessages(messages).map((message) => message.entries.length);
    expect(all).toEqual([1_000, 1_000, 500]);
    expect(messages.at(-1)).toEqual({ type: 'done', total: 2_500 });
  });

  it('skips chunks that a resumed import already uploaded', async () => {
    const { messages, session } = createHarness();
    session.handleMessage({
      type: 'start',
      file: file(playlist(2_500)),
      mode: 'stream',
      skipChunks: 2,
    });
    await settle();

    const chunks = chunkMessages(messages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.entries).toHaveLength(500);
    expect(chunks[0]?.entries[0]?.name).toBe('Channel 2000');

    session.handleMessage({ type: 'next' });
    await settle();
    expect(messages.at(-1)).toEqual({ type: 'done', total: 2_500 });
  });

  it('stops when cancelled and posts nothing else', async () => {
    const { messages, session } = createHarness();
    session.handleMessage({ type: 'start', file: file(playlist(3_000)), mode: 'stream' });
    await settle();
    expect(chunkMessages(messages)).toHaveLength(1);

    session.handleMessage({ type: 'cancel' });
    await settle();

    expect(chunkMessages(messages)).toHaveLength(1);
    expect(messages.some((message) => message.type === 'done')).toBe(false);
    expect(errorMessages(messages)).toHaveLength(0);
  });
});

describe('import session — errors', () => {
  it('reports an invalid playlist', async () => {
    const { messages, session } = createHarness();
    session.handleMessage({ type: 'start', file: file('not a playlist\n'), mode: 'count' });
    await settle();
    expect(errorMessages(messages).map((message) => message.code)).toEqual(['invalid_playlist']);
  });

  it('reports the entry limit as a normal error code', async () => {
    const { messages, session } = createHarness();
    session.handleMessage({ type: 'start', file: file(playlist(3)), mode: 'count', maxEntries: 2 });
    await settle();
    expect(errorMessages(messages).map((message) => message.code)).toEqual(['entry_limit_exceeded']);
  });

  it('falls back to a text read when streaming the file fails', async () => {
    const source = file(playlist(4));
    const { messages, session } = createHarness({
      // eslint-disable-next-line require-yield
      readSource: async function* () {
        throw new Error('stream unsupported');
      },
    });
    session.handleMessage({ type: 'start', file: source, mode: 'count' });
    await settle();
    expect(messages.at(-1)).toEqual({ type: 'done', total: 4 });
  });

  it('reports an unreadable file', async () => {
    const source: PlaylistSource = {
      text: async () => {
        throw new Error('permission denied');
      },
    };
    const { messages, session } = createHarness({
      // eslint-disable-next-line require-yield
      readSource: async function* () {
        throw new Error('stream unsupported');
      },
    });
    session.handleMessage({ type: 'start', file: source, mode: 'count' });
    await settle();
    expect(errorMessages(messages).map((message) => message.code)).toEqual(['file_unreadable']);
  });

  it('rejects a second start while a run is active', async () => {
    const { messages, session } = createHarness();
    session.handleMessage({ type: 'start', file: file(playlist(2_500)), mode: 'stream' });
    await settle();
    session.handleMessage({ type: 'start', file: file(playlist(2)), mode: 'count' });
    await settle();
    expect(errorMessages(messages).map((message) => message.code)).toEqual(['bad_request']);
  });
});
