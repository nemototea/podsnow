import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import type { FsPort } from './fsPort';

/*
 * .podsnow（zip）の逐次読み書き。ファイル全体をメモリに載せない（DATA_MODEL.md §7）。
 * 音声は無圧縮（ZipPassThrough）、JSON は Deflate。
 */

export const ZIP_CHUNK = 256 * 1024;

export interface ZipEntrySource {
  name: string;
  /** 無圧縮で入れる（WAV など）。 */
  store: boolean;
  /** 絶対パスのファイル、またはメモリ上のバイト列。 */
  source: { path: string } | { bytes: Uint8Array };
}

export interface ZipProgress {
  entry: string;
  /** これまでに読み込んだ合計バイト。 */
  bytes: number;
  totalBytes: number;
}

/** entries を順に zip へ書く。 */
export function writeZip(
  fs: FsPort,
  outAbsPath: string,
  entries: readonly ZipEntrySource[],
  onProgress?: (p: ZipProgress) => void,
): void {
  const out = fs.open(outAbsPath, 'w');
  let failure: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) {
      failure = err;
      return;
    }
    out.write(data);
  });
  const totalBytes = entries.reduce(
    (a, e) => a + ('bytes' in e.source ? e.source.bytes.length : fs.size(e.source.path)),
    0,
  );
  let done = 0;
  try {
    for (const e of entries) {
      const stream = e.store ? new ZipPassThrough(e.name) : new ZipDeflate(e.name, { level: 6 });
      zip.add(stream);
      if ('bytes' in e.source) {
        stream.push(e.source.bytes, true);
        done += e.source.bytes.length;
      } else {
        const h = fs.open(e.source.path, 'r');
        try {
          for (;;) {
            const chunk = h.read(ZIP_CHUNK);
            if (chunk.length === 0) {
              stream.push(new Uint8Array(0), true);
              break;
            }
            stream.push(chunk, false);
            done += chunk.length;
            if (failure) throw failure;
            onProgress?.({ entry: e.name, bytes: done, totalBytes });
          }
        } finally {
          h.close();
        }
      }
      if (failure) throw failure;
      onProgress?.({ entry: e.name, bytes: done, totalBytes });
    }
    zip.end();
    if (failure) throw failure;
  } finally {
    out.close();
  }
}

export interface ZipReadEntry {
  name: string;
  /** 全チャンクを受け取る。final が true で終了。 */
  onData: (chunk: Uint8Array, final: boolean) => void;
}

/**
 * zip を先頭から逐次読み、エントリごとに select で受け取り先を決める（null なら読み飛ばす）。
 * ローカルヘッダを順に辿るため central directory を先に読む必要がない。
 */
export function readZip(
  fs: FsPort,
  zipAbsPath: string,
  select: (name: string, size: number | undefined) => ZipReadEntry | null,
  onProgress?: (bytes: number, totalBytes: number) => void,
): void {
  const totalBytes = fs.size(zipAbsPath);
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  let failure: Error | null = null;
  unzip.onfile = (file) => {
    const target = select(file.name, file.originalSize);
    if (!target) return;
    file.ondata = (err, data, final) => {
      if (err) {
        failure = err;
        return;
      }
      target.onData(data, final);
    };
    file.start();
  };
  const h = fs.open(zipAbsPath, 'r');
  let read = 0;
  try {
    for (;;) {
      const chunk = h.read(ZIP_CHUNK);
      if (chunk.length === 0) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      read += chunk.length;
      unzip.push(chunk, false);
      if (failure) throw failure;
      onProgress?.(read, totalBytes);
    }
    if (failure) throw failure;
  } finally {
    h.close();
  }
}

/** 逐次読みしたエントリをファイルへ書く受け取り先。 */
export function fileSink(fs: FsPort, absPath: string): ZipReadEntry & { name: string } {
  let h: ReturnType<FsPort['open']> | null = null;
  return {
    name: absPath,
    onData: (chunk, final) => {
      if (!h) h = fs.open(absPath, 'w');
      if (chunk.length) h.write(chunk);
      if (final) {
        h.close();
        h = null;
      }
    },
  };
}

/** 逐次読みしたエントリをメモリに集める受け取り先（JSON 用）。 */
export function bytesSink(): ZipReadEntry & { result: () => Uint8Array } {
  const parts: Uint8Array[] = [];
  return {
    name: 'memory',
    onData: (chunk) => {
      if (chunk.length) parts.push(chunk);
    },
    result: () => {
      const total = parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      return out;
    },
  };
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}
