/**
 * バックアップなど大きなファイルを逐次処理するための最小ファイル抽象。
 * アプリでは expo-file-system の FileHandle、Jest では node:fs で実装する。
 * すべて同期（expo-file-system SDK 57 の FileHandle は同期 API）。
 */
export interface FsHandle {
  /** 最大 length バイト読む。EOF なら空配列。 */
  read(length: number): Uint8Array;
  write(bytes: Uint8Array): void;
  close(): void;
}

export interface FsPort {
  open(absPath: string, mode: 'r' | 'w'): FsHandle;
  size(absPath: string): number;
  exists(absPath: string): boolean;
  ensureDir(absDir: string): void;
  delete(absPath: string): void;
  /** ディレクトリ直下のファイル名（ディレクトリは含めない）。無ければ空。 */
  list(absDir: string): string[];
}
