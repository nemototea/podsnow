import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { exportTags, coverImage, type ExportTags } from '@/domain/metadata/exportTags';
import { mp4Boxes, mp4ChunkOffsets, readMp4Tags } from '@/domain/metadata/mp4Tags';
import { readRiffInfo, riffChunks } from '@/domain/metadata/riffInfo';
import { nodeFsPort } from '@/infra/files/__tests__/nodeFsPort';

import { embedExportMetadata } from '../embedMetadata';

const FIXTURES = path.join(__dirname, 'fixtures');

/** ffmpeg 6.1 で作った 0.5 秒の AAC（moov が mdat の後ろ / 前）。Lavf の ilst が既に入っている。 */
const M4A_FIXTURES = ['moov-last.m4a', 'moov-first.m4a'] as const;

const TAGS: ExportTags = exportTags({
  title: '初回ゲスト回 🎙',
  episodeNumber: 12,
  showName: 'ねもとのラジオ',
  author: 'ねもと',
  publishedAt: Date.UTC(2026, 9, 3, 12, 0, 0),
  publishPlannedAt: null,
  appVersion: '0.1.0',
  utcOffsetMinutes: 540,
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podsnow-tags-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function copyFixture(name: string): string {
  const dst = path.join(dir, name);
  fs.copyFileSync(path.join(FIXTURES, name), dst);
  return dst;
}

function moovOf(file: Uint8Array): { moov: Uint8Array; offset: number } {
  const box = mp4Boxes(file).find((b) => b.type === 'moov')!;
  return { moov: file.subarray(box.start, box.start + box.size), offset: box.start };
}

/** チャンク位置が指す先の音声データ（各チャンクの先頭 32 バイト）。 */
function chunkHeads(file: Uint8Array): string[] {
  return mp4ChunkOffsets(moovOf(file).moov).map((o) =>
    Buffer.from(file.subarray(o, o + 32)).toString('hex'),
  );
}

describe('embedExportMetadata (Issue #56)', () => {
  const cover = coverImage(fs.readFileSync(path.join(FIXTURES, 'cover.jpg')))!;

  it.each(M4A_FIXTURES)('writes iTunes tags into %s and reads them back', async (name) => {
    const p = copyFixture(name);
    const before = new Uint8Array(fs.readFileSync(p));
    await embedExportMetadata(nodeFsPort, p, 'm4a', TAGS, cover);
    const after = new Uint8Array(fs.readFileSync(p));

    const tags = readMp4Tags(moovOf(after).moov);
    expect(tags).toMatchObject({
      title: '初回ゲスト回 🎙',
      artist: 'ねもと',
      albumArtist: 'ねもと',
      album: 'ねもとのラジオ',
      track: 12,
      date: '2026-10-03T21:00:00+09:00',
      genre: 'Podcast',
      encoder: 'PodsNow 0.1.0',
      // ffmpeg が書いた meta は置き換わり、1 つだけ
      metaCount: 1,
    });
    expect(tags.cover?.kind).toBe('jpeg');
    expect(Buffer.from(tags.cover!.bytes).equals(Buffer.from(cover.bytes))).toBe(true);

    // 音声のデータはそのままで、チャンク位置は（ずれたなら）ずれた先を正しく指す
    expect(chunkHeads(after)).toEqual(chunkHeads(before));
    const mdat = (b: Uint8Array) => {
      const m = mp4Boxes(b).find((x) => x.type === 'mdat')!;
      return Buffer.from(b.subarray(m.start, m.start + m.size));
    };
    expect(mdat(after).equals(mdat(before))).toBe(true);
    // 一時ファイルは残らない
    expect(fs.readdirSync(dir)).toEqual([name]);
  });

  it('moves the audio data when moov is in front of it', async () => {
    const p = copyFixture('moov-first.m4a');
    const before = new Uint8Array(fs.readFileSync(p));
    await embedExportMetadata(nodeFsPort, p, 'm4a', TAGS, cover);
    const after = new Uint8Array(fs.readFileSync(p));
    const grow = moovOf(after).moov.length - moovOf(before).moov.length;
    expect(grow).toBeGreaterThan(0);
    expect(after.length - before.length).toBe(grow);
    const offs = (b: Uint8Array) => mp4ChunkOffsets(moovOf(b).moov);
    expect(offs(after)).toEqual(offs(before).map((o) => o + grow));
  });

  it('keeps chunk offsets when moov is the last box', async () => {
    const p = copyFixture('moov-last.m4a');
    const before = new Uint8Array(fs.readFileSync(p));
    await embedExportMetadata(nodeFsPort, p, 'm4a', TAGS, null);
    const after = new Uint8Array(fs.readFileSync(p));
    expect(mp4ChunkOffsets(moovOf(after).moov)).toEqual(mp4ChunkOffsets(moovOf(before).moov));
    expect(readMp4Tags(moovOf(after).moov).cover).toBeUndefined();
  });

  it('can be run again on its own output (replaces, does not stack)', async () => {
    const p = copyFixture('moov-first.m4a');
    await embedExportMetadata(nodeFsPort, p, 'm4a', TAGS, cover);
    const once = fs.readFileSync(p);
    await embedExportMetadata(nodeFsPort, p, 'm4a', TAGS, cover);
    expect(fs.readFileSync(p).equals(once)).toBe(true);
  });

  it('leaves the original untouched and removes the temp file when the MP4 is broken', async () => {
    const p = path.join(dir, 'broken.m4a');
    const good = fs.readFileSync(path.join(FIXTURES, 'moov-last.m4a'));
    // moov を途中で切ったファイル
    const broken = good.subarray(0, good.length - 100);
    fs.writeFileSync(p, broken);
    await expect(embedExportMetadata(nodeFsPort, p, 'm4a', TAGS, cover)).rejects.toThrow();
    expect(fs.readFileSync(p).equals(broken)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['broken.m4a']);
  });

  it('rejects a file without moov', async () => {
    const p = path.join(dir, 'nomoov.m4a');
    const ftyp = Buffer.from('0000001066747970' + '4d344120' + '00000200', 'hex');
    fs.writeFileSync(p, ftyp);
    await expect(embedExportMetadata(nodeFsPort, p, 'm4a', TAGS, null)).rejects.toThrow('no moov');
    expect(fs.readdirSync(dir)).toEqual(['nomoov.m4a']);
  });

  /** 書き出しの WavSink と同じ 44 バイトのヘッダ + PCM。 */
  function writeWav(p: string, frames: number): Buffer {
    const data = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) data.writeInt16LE((i * 37) % 2000, i * 2);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + data.length, 4);
    h.write('WAVEfmt ', 8);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(48000, 24);
    h.writeUInt32LE(96000, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36);
    h.writeUInt32LE(data.length, 40);
    fs.writeFileSync(p, Buffer.concat([h, data]));
    return data;
  }

  it('writes LIST/INFO into a WAV and keeps the samples', async () => {
    const p = path.join(dir, 'a.wav');
    const pcm = writeWav(p, 4801);
    await embedExportMetadata(nodeFsPort, p, 'wav', TAGS, cover);
    const b = new Uint8Array(fs.readFileSync(p));
    expect(readRiffInfo(b)).toEqual({
      INAM: '初回ゲスト回 🎙',
      IART: 'ねもと',
      IPRD: 'ねもとのラジオ',
      ITRK: '12',
      ICRD: '2026-10-03',
      IGNR: 'Podcast',
      ISFT: 'PodsNow 0.1.0',
    });
    const chunks = riffChunks(b);
    expect(chunks.map((c) => c.id)).toEqual(['fmt ', 'data', 'LIST']);
    const data = chunks.find((c) => c.id === 'data')!;
    expect(Buffer.from(b.subarray(data.start + 8, data.start + 8 + data.size)).equals(pcm)).toBe(
      true,
    );
    // RIFF の長さがファイルの長さと合う
    expect(Buffer.from(b).readUInt32LE(4) + 8).toBe(b.length);
  });

  it('refuses a WAV with trailing bytes beyond the RIFF length', async () => {
    const p = path.join(dir, 'b.wav');
    writeWav(p, 10);
    fs.appendFileSync(p, Buffer.from([1, 2]));
    const before = fs.readFileSync(p);
    await expect(embedExportMetadata(nodeFsPort, p, 'wav', TAGS, null)).rejects.toThrow(
      'unexpected length',
    );
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});
