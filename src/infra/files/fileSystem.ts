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

export function availableDiskBytes(): number {
  return Paths.availableDiskSpace;
}

function stripScheme(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

function toUri(abs: string): string {
  return abs.startsWith('file://') ? abs : `file://${abs}`;
}
