/**
 * 共有・保存するときの音声ファイル名（Issue #166）。
 *
 * 書き出したファイルはアプリ内で `<exportId>.<ext>` の名前で持つ（DATA_MODEL.md §2）。
 * 外へ渡すときだけ、番組名・話数・タイトルから作ったこの名前を付ける。
 *
 * 例: `ねもとのラジオ - 012 - 初回ゲスト回.m4a`。番組名もタイトルも空なら `episode-012.m4a`。
 * 話数が空の回は番号を省く（`ねもとのラジオ - 初回ゲスト回.m4a`、`episode.m4a`。Issue #211）。
 */
export interface ExportFileNameInput {
  showName: string;
  /** 話数。空（null）なら番号を省く。 */
  episodeNumber: number | null;
  title: string;
  /** 拡張子（`m4a` / `wav`）。先頭の `.` は付けない。 */
  ext: string;
}

/**
 * 拡張子を除いた名前の上限（UTF-8 のバイト数）。
 * iOS（APFS）/ Android（ext4・f2fs）のファイル名の上限 255 バイトに、拡張子と
 * 共有先が付け足す「 (1)」などの余裕を残す。日本語（1 文字 3 バイト）で約 60 文字。
 */
export const MAX_FILE_STEM_BYTES = 180;

const SEPARATOR = ' - ';

/**
 * iOS / Android / Windows / macOS のいずれかでファイル名に使えない文字、または
 * file:// の URI で意味を持つ文字（`#` `%` `?`）。空白に置き換える。
 */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f/\\:*?"<>|#%]/g;

export function exportFileName(input: ExportFileNameInput): string {
  const number =
    input.episodeNumber === null
      ? ''
      : String(Math.max(0, Math.trunc(input.episodeNumber))).padStart(3, '0');
  const show = sanitizePart(input.showName);
  const title = sanitizePart(input.title);
  const ext = sanitizePart(input.ext).replace(/\s/g, '') || 'm4a';
  const stem =
    show || title
      ? [show, number, title].filter(Boolean).join(SEPARATOR)
      : ['episode', number].filter(Boolean).join('-');
  return `${truncateStem(stem)}.${ext}`;
}

/** 使えない文字を空白にし、連続する空白を 1 つにまとめ、前後の空白を取る。 */
function sanitizePart(s: string): string {
  return s.normalize('NFC').replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 上限バイト数に収まるよう、コードポイント単位で後ろから切る（サロゲートペアを割らない）。
 * 切った結果、末尾に残った区切り・空白・`.` は取る。先頭の `.`（隠しファイル扱い）も取る。
 */
function truncateStem(stem: string): string {
  let out = '';
  let bytes = 0;
  for (const ch of stem) {
    const b = utf8Bytes(ch);
    if (bytes + b > MAX_FILE_STEM_BYTES) break;
    out += ch;
    bytes += b;
  }
  return out.replace(/^[.\s]+/, '').replace(/[\s.-]+$/, '') || 'episode';
}

function utf8Bytes(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}
