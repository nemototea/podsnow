/**
 * 画像などのファイルを逐次処理するための最小ファイル抽象。
 * アプリでは expo-file-system の FileHandle、Jest では node:fs で実装する。
 * すべて同期（expo-file-system SDK 57 の FileHandle は同期 API）。
 */
export interface FsHandle {
  /** 最大 length バイト読む。EOF なら空配列。 */
  read(length: number): Uint8Array;
  write(bytes: Uint8Array): void;
  /** 次の read / write の位置（ファイル先頭からのバイト数）を移す。 */
  seek(offset: number): void;
  close(): void;
}

export interface FsPort {
  /** `r` 読むだけ / `w` 空にして書く / `rw` 中身を残して読み書き（位置は先頭）。 */
  open(absPath: string, mode: 'r' | 'w' | 'rw'): FsHandle;
  size(absPath: string): number;
  exists(absPath: string): boolean;
  ensureDir(absDir: string): void;
  delete(absPath: string): void;
  /** `from` を `to` へ移す。`to` があれば置き換える。 */
  move(from: string, to: string): void;
  /** ディレクトリ直下のファイル名（ディレクトリは含めない）。無ければ空。 */
  list(absDir: string): string[];
}
