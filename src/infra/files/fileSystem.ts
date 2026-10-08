import { Directory, File, Paths } from 'expo-file-system';

import { joinRoot, ROOT_DIR_NAME } from './layout';

/** アプリのデータルート（Paths.document/podsnow）。絶対パス（file:// なし）。 */
export function dataRoot(): string {
  const dir = new Directory(Paths.document, ROOT_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return stripScheme(dir.uri);
}

export function absPath(rel: string): string {
  return joinRoot(dataRoot(), rel);
}

export function ensureDir(absDir: string): void {
  const d = new Directory(toUri(absDir));
  if (!d.exists) d.create({ intermediates: true });
}

export function fileExists(absFile: string): boolean {
  return new File(toUri(absFile)).exists;
}

export function fileSize(absFile: string): number {
  const f = new File(toUri(absFile));
  return f.exists ? (f.size ?? 0) : 0;
}

export function deleteIfExists(absFile: string): void {
  const f = new File(toUri(absFile));
  if (f.exists) f.delete();
}

/** 中間ファイル置き場（DATA_MODEL.md §2 の tmp/）を空にして作り直す。起動時に呼ぶ。 */
export function resetTmpDir(): string {
  const d = new Directory(toUri(joinRoot(dataRoot(), 'tmp')));
  try {
    if (d.exists) d.delete();
  } catch {
    /* 消せなくても致命的ではない */
  }
  if (!d.exists) d.create({ intermediates: true });
  return stripScheme(d.uri);
}

/**
 * `absSrc` を `absDir/name` へコピーし、コピーの file:// URI を返す（共有用の別名コピー。Issue #166）。
 * `absDir` は毎回空にしてから作り直す（前回の共有で作ったコピーを残さない）。
 * `name` は URI に埋めず File に名前として渡す（日本語・空白を含む名前の符号化は expo-file-system に任せる）。
 */
export async function copyAsNamed(absSrc: string, absDir: string, name: string): Promise<string> {
  const dir = new Directory(toUri(absDir));
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  const dest = new File(dir, name);
  await new File(toUri(absSrc)).copy(dest);
  return dest.uri;
}

export function availableDiskBytes(): number {
  return Paths.availableDiskSpace;
}

function stripScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

function toUri(abs: string): string {
  return abs.startsWith('file://') ? abs : `file://${abs}`;
}
