import { exportFileName, MAX_FILE_STEM_BYTES } from '../fileName';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('exportFileName', () => {
  it('joins show name and title, without the episode number (Issue #211)', () => {
    expect(exportFileName({ showName: 'ねもとのラジオ', title: '初回', ext: 'm4a' })).toBe(
      'ねもとのラジオ - 初回.m4a',
    );
  });

  it('omits an empty show name or title without leaving a separator', () => {
    expect(exportFileName({ showName: '', title: 'T', ext: 'wav' })).toBe('T.wav');
    expect(exportFileName({ showName: 'S', title: '  ', ext: 'm4a' })).toBe('S.m4a');
  });

  it('falls back to episode when both are empty', () => {
    expect(exportFileName({ showName: '', title: '', ext: 'm4a' })).toBe('episode.m4a');
  });

  it('replaces characters that are unsafe in file names or file URIs', () => {
    expect(
      exportFileName({
        showName: 'A/B\\C',
        title: 'Q: "why?" <1|2> *#100% \n next',
        ext: 'm4a',
      }),
    ).toBe('A B C - Q why 1 2 100 next.m4a');
  });

  it('removes a leading dot and trailing dots', () => {
    expect(exportFileName({ showName: '...hidden', title: '', ext: 'm4a' })).toBe('hidden.m4a');
    expect(exportFileName({ showName: '', title: 'end...', ext: 'm4a' })).toBe('end.m4a');
  });

  it('normalizes to NFC', () => {
    const decomposed = 'が'; // か + 濁点（結合文字）
    expect(exportFileName({ showName: decomposed, title: '', ext: 'm4a' })).toBe('が.m4a');
  });

  it('caps the name by UTF-8 bytes without splitting characters', () => {
    const name = exportFileName({
      showName: '番組',
      title: 'あ'.repeat(200),
      ext: 'm4a',
    });
    const stem = name.slice(0, -'.m4a'.length);
    expect(bytes(stem)).toBeLessThanOrEqual(MAX_FILE_STEM_BYTES);
    expect(stem.startsWith('番組 - あ')).toBe(true);
    expect(name.endsWith('あ.m4a')).toBe(true);
  });

  it('does not split a surrogate pair at the cap', () => {
    const name = exportFileName({
      showName: '',
      title: 'a'.repeat(MAX_FILE_STEM_BYTES - 2) + '😀😀',
      ext: 'm4a',
    });
    expect(name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(bytes(name.slice(0, -4))).toBeLessThanOrEqual(MAX_FILE_STEM_BYTES);
  });

  it('drops a separator left dangling by the cap', () => {
    const show = 'x'.repeat(MAX_FILE_STEM_BYTES - 2);
    expect(exportFileName({ showName: show, title: 'T', ext: 'm4a' })).toBe(`${show}.m4a`);
  });
});
