import { concat, readFourcc, u32le, view } from '@/domain/metadata/bytes';
import type { CoverImage, ExportTags } from '@/domain/metadata/exportTags';
import { rewriteMoov } from '@/domain/metadata/mp4Tags';
import { buildInfoList } from '@/domain/metadata/riffInfo';
import type { ExportFormat } from '@/infra/db/repositories/exportsRepo';
import type { FsHandle, FsPort } from '@/infra/files/fsPort';

const COPY_CHUNK_BYTES = 1024 * 1024;
/** この量を写すごとに JS のスレッドを一度空ける（画面を止めない）。 */
const YIELD_EVERY_BYTES = 4 * 1024 * 1024;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * 書き出したファイルにメタデータを埋め込む（Issue #56、AUDIO_DESIGN.md §8.3）。
 * ネイティブのレンダ（音量の処理を含む）が終わったあとの後処理で、音声のデータには触らない。
 *
 * - M4A: `moov` を組み直した写しを同じフォルダに書き、できてから元と置き換える。
 *   途中で失敗しても元のファイルは壊れない（写しは消す）。
 * - WAV: 末尾に `LIST/INFO` を足し、RIFF の長さを直す（数百 MB を写さないため、その場で書く）。
 *   足したあと長さを直す前に落ちても、RIFF の長さまでは元と同じなので読める。
 */
export async function embedExportMetadata(
  fs: FsPort,
  absPath: string,
  format: ExportFormat,
  tags: ExportTags,
  cover: CoverImage | null,
): Promise<void> {
  if (format === 'wav') embedWav(fs, absPath, tags);
  else await embedM4a(fs, absPath, tags, cover);
}

function readExact(h: FsHandle, n: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let got = 0;
  while (got < n) {
    const b = h.read(Math.min(n - got, COPY_CHUNK_BYTES));
    if (!b.length) throw new Error('unexpected end of file');
    parts.push(b);
    got += b.length;
  }
  return parts.length === 1 ? parts[0]! : concat(parts);
}

async function embedM4a(
  fs: FsPort,
  absPath: string,
  tags: ExportTags,
  cover: CoverImage | null,
): Promise<void> {
  const total = fs.size(absPath);
  const tmp = `${absPath}.tagging`;
  const src = fs.open(absPath, 'r');
  let dst: FsHandle | null = null;
  try {
    dst = fs.open(tmp, 'w');
    let pos = 0;
    let moovSeen = false;
    let sinceYield = 0;
    // 最上位の箱を順に写し、moov だけ組み直す
    while (pos < total) {
      let header = readExact(src, 8);
      let size = view(header).getUint32(0);
      const type = readFourcc(header, 4);
      if (size === 1) {
        header = concat([header, readExact(src, 8)]);
        const v = view(header);
        size = v.getUint32(8) * 0x1_0000_0000 + v.getUint32(12);
      } else if (size === 0) {
        size = total - pos;
      }
      if (size < header.length || pos + size > total) throw new Error(`mp4: bad box ${type}`);
      if (type === 'moov') {
        if (moovSeen) throw new Error('mp4: two moov boxes');
        moovSeen = true;
        const moov = concat([header, readExact(src, size - header.length)]);
        dst.write(rewriteMoov(moov, pos, tags, cover));
      } else {
        dst.write(header);
        let left = size - header.length;
        while (left > 0) {
          const b = readExact(src, Math.min(left, COPY_CHUNK_BYTES));
          dst.write(b);
          left -= b.length;
          sinceYield += b.length;
          if (sinceYield >= YIELD_EVERY_BYTES) {
            sinceYield = 0;
            await yieldToUi();
          }
        }
      }
      pos += size;
    }
    if (!moovSeen) throw new Error('mp4: no moov');
  } catch (e) {
    src.close();
    dst?.close();
    fs.delete(tmp);
    throw e;
  }
  src.close();
  dst.close();
  fs.move(tmp, absPath);
}

function embedWav(fs: FsPort, absPath: string, tags: ExportTags): void {
  const total = fs.size(absPath);
  const h = fs.open(absPath, 'rw');
  try {
    const head = readExact(h, 12);
    if (readFourcc(head, 0) !== 'RIFF' || readFourcc(head, 8) !== 'WAVE')
      throw new Error('wav: not a RIFF/WAVE');
    const riffSize = view(head).getUint32(4, true);
    // 書き出しの WAV は RIFF の長さどおりで終わる。後ろに何かあれば触らない
    if (riffSize + 8 !== total || total % 2) throw new Error('wav: unexpected length');
    const list = buildInfoList(tags);
    if (riffSize + list.length > 0xffffffff) throw new Error('wav: too large for RIFF');
    h.seek(total);
    h.write(list);
    h.seek(4);
    h.write(u32le(riffSize + list.length));
  } finally {
    h.close();
  }
}
