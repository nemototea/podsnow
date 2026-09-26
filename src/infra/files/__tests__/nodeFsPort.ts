// テスト専用: node:fs による FsPort 実装。
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FsHandle, FsPort } from '@/infra/files/fsPort';

export const nodeFsPort: FsPort = {
  open(absPath, mode): FsHandle {
    if (mode === 'w') fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const fd = fs.openSync(absPath, mode === 'w' ? 'w' : 'r');
    let pos = 0;
    return {
      read: (length) => {
        const buf = Buffer.alloc(length);
        const n = fs.readSync(fd, buf, 0, length, pos);
        pos += n;
        return new Uint8Array(buf.buffer, buf.byteOffset, n);
      },
      write: (bytes) => {
        fs.writeSync(fd, bytes);
      },
      close: () => fs.closeSync(fd),
    };
  },
  size: (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0),
  exists: (p) => fs.existsSync(p),
  ensureDir: (d) => fs.mkdirSync(d, { recursive: true }),
  delete: (p) => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  },
  list: (d) =>
    fs.existsSync(d)
      ? fs
          .readdirSync(d, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name)
      : [],
};
