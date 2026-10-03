import { utf8Decode, utf8Encode } from '../bytes';
import { coverImage, EXPORT_GENRE, exportTags, isoWithOffset } from '../exportTags';

const base = {
  title: 'タイトル',
  episodeNumber: 3,
  showName: '番組',
  author: '著者',
  publishedAt: null,
  publishPlannedAt: null,
  appVersion: '0.1.0',
  utcOffsetMinutes: 540,
};

describe('exportTags (Issue #56)', () => {
  it('maps episode and show fields', () => {
    expect(exportTags(base)).toEqual({
      title: 'タイトル',
      artist: '著者',
      album: '番組',
      track: 3,
      date: null,
      genre: EXPORT_GENRE,
      encoder: 'PodsNow 0.1.0',
    });
  });

  it('uses the show name as the artist when the author is empty', () => {
    expect(exportTags({ ...base, author: '  ' }).artist).toBe('番組');
    expect(exportTags({ ...base, author: '', showName: '' })).toMatchObject({
      artist: null,
      album: null,
    });
  });

  it('drops empty titles and non-positive episode numbers, and tidies whitespace', () => {
    expect(exportTags({ ...base, title: ' \n ', episodeNumber: 0 })).toMatchObject({
      title: null,
      track: null,
    });
    expect(exportTags({ ...base, title: '  a \n b  ' }).title).toBe('a b');
  });

  it('prefers the published date over the planned one', () => {
    const published = Date.UTC(2026, 0, 2, 3, 4, 5);
    const planned = Date.UTC(2027, 0, 1);
    expect(exportTags({ ...base, publishedAt: published, publishPlannedAt: planned }).date).toBe(
      '2026-01-02T12:04:05+09:00',
    );
    expect(exportTags({ ...base, publishPlannedAt: planned }).date).toBe(
      '2027-01-01T09:00:00+09:00',
    );
  });

  it('formats local time with the offset', () => {
    const t = Date.UTC(2026, 9, 3, 23, 30, 0, 999);
    expect(isoWithOffset(t, 0)).toBe('2026-10-03T23:30:00+00:00');
    expect(isoWithOffset(t, 540)).toBe('2026-10-04T08:30:00+09:00');
    expect(isoWithOffset(t, -210)).toBe('2026-10-03T20:00:00-03:30');
  });
});

describe('coverImage', () => {
  it('recognises JPEG and PNG by their signature', () => {
    expect(coverImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.kind).toBe('jpeg');
    expect(coverImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]))?.kind).toBe(
      'png',
    );
  });

  it('rejects anything else', () => {
    expect(coverImage(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(coverImage(new Uint8Array(0))).toBeNull();
  });
});

describe('utf8', () => {
  it('round-trips BMP, astral and combining characters', () => {
    const s = 'aé日本🎙́ x';
    expect(utf8Decode(utf8Encode(s))).toBe(s);
    expect(Array.from(utf8Encode('🎙'))).toEqual([0xf0, 0x9f, 0x8e, 0x99]);
  });

  it('replaces broken sequences', () => {
    expect(utf8Decode(Uint8Array.from([0x61, 0xe6, 0x97]))).toBe('a��');
    expect(utf8Decode(Uint8Array.from([0x80, 0x62]))).toBe('�b');
  });
});
