import { exportFileName, MAX_FILE_STEM_BYTES } from '../fileName';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('exportFileName', () => {
  it('joins show name, zero-padded number and title', () => {
    expect(
      exportFileName({ showName: 'ねもとのラジオ', episodeNumber: 12, title: '初回', ext: 'm4a' }),
    ).toBe('ねもとのラジオ - 012 - 初回.m4a');
  });

  it('omits an empty show name or title', () => {
    expect(exportFileName({ showName: '', episodeNumber: 3, title: 'T', ext: 'wav' })).toBe(
      '003 - T.wav',
    );
    expect(exportFileName({ showName: 'S', episodeNumber: 3, title: '  ', ext: 'm4a' })).toBe(
      'S - 003.m4a',
    );
  });

  it('falls back to episode-NNN when both are empty', () => {
    expect(exportFileName({ showName: '', episodeNumber: 1, title: '', ext: 'm4a' })).toBe(
      'episode-001.m4a',
    );
    expect(exportFileName({ showName: '', episodeNumber: 1234, title: '', ext: 'm4a' })).toBe(
      'episode-1234.m4a',
    );
  });

  it('omits the number when the episode has none, without leaving a separator (Issue #211)', () => {
    expect(exportFileName({ showName: 'S', episodeNumber: null, title: 'T', ext: 'm4a' })).toBe(
      'S - T.m4a',
    );
    expect(exportFileName({ showName: '', episodeNumber: null, title: 'T', ext: 'm4a' })).toBe(
      'T.m4a',
    );
    expect(exportFileName({ showName: 'S', episodeNumber: null, title: '', ext: 'wav' })).toBe(
      'S.wav',
    );
    expect(exportFileName({ showName: '', episodeNumber: null, title: '', ext: 'm4a' })).toBe(
      'episode.m4a',
    );
  });

  it('replaces characters that are unsafe in file names or file URIs', () => {
    expect(
      exportFileName({
        showName: 'A/B\\C',
        episodeNumber: 1,
        title: 'Q: "why?" <1|2> *#100% \n next',
        ext: 'm4a',
      }),
    ).toBe('A B C - 001 - Q why 1 2 100 next.m4a');
  });

  it('removes a leading dot and trailing dots', () => {
    expect(exportFileName({ showName: '...hidden', episodeNumber: 1, title: '', ext: 'm4a' })).toBe(
      'hidden - 001.m4a',
    );
    expect(exportFileName({ showName: '', episodeNumber: 1, title: 'end...', ext: 'm4a' })).toBe(
      '001 - end.m4a',
    );
  });

  it('normalizes to NFC', () => {
    const decomposed = 'が'; // か + 濁点（結合文字）
    expect(exportFileName({ showName: decomposed, episodeNumber: 1, title: '', ext: 'm4a' })).toBe(
      'が - 001.m4a',
    );
  });

  it('caps the name by UTF-8 bytes without splitting characters', () => {
    const name = exportFileName({
      showName: '番組',
      episodeNumber: 1,
      title: 'あ'.repeat(200),
      ext: 'm4a',
    });
    const stem = name.slice(0, -'.m4a'.length);
    expect(bytes(stem)).toBeLessThanOrEqual(MAX_FILE_STEM_BYTES);
    expect(stem.startsWith('番組 - 001 - あ')).toBe(true);
    expect(name.endsWith('あ.m4a')).toBe(true);
  });

  it('does not split a surrogate pair at the cap', () => {
    const name = exportFileName({
      showName: '',
      episodeNumber: 1,
      title: 'a'.repeat(MAX_FILE_STEM_BYTES - '001 - '.length - 2) + '😀😀',
      ext: 'm4a',
    });
    expect(name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(bytes(name.slice(0, -4))).toBeLessThanOrEqual(MAX_FILE_STEM_BYTES);
  });

  it('drops a separator left dangling by the cap', () => {
    const show = 'x'.repeat(MAX_FILE_STEM_BYTES - 2);
    expect(exportFileName({ showName: show, episodeNumber: 1, title: 'T', ext: 'm4a' })).toBe(
      `${show}.m4a`,
    );
  });
});
