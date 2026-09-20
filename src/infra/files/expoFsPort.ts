import { Directory, File } from 'expo-file-system';

import type { FsHandle, FsPort } from './fsPort';

function toUri(abs: string): string {
  return abs.startsWith('file://') ? abs : `file://${abs}`;
}

/** expo-file-system（SDK 57、File.open → FileHandle）による FsPort 実装。【仮説: 実機で要確認】 */
export const expoFsPort: FsPort = {
  open(absPath, mode): FsHandle {
    const f = new File(toUri(absPath));
    if (mode === 'w') {
      const dir = new Directory(toUri(absPath.slice(0, absPath.lastIndexOf('/'))));
      if (!dir.exists) dir.create({ intermediates: true });
      if (f.exists) f.delete();
      f.create();
    }
    const h = f.open();
    return {
      read: (length) => {
        const remain = (h.size ?? 0) - (h.offset ?? 0);
        const n = Math.max(0, Math.min(length, remain));
        return n === 0 ? new Uint8Array(0) : h.readBytes(n);
      },
      write: (bytes) => h.writeBytes(bytes),
      close: () => h.close(),
    };
  },
  size: (absPath) => {
    const f = new File(toUri(absPath));
    return f.exists ? (f.size ?? 0) : 0;
  },
  exists: (absPath) => new File(toUri(absPath)).exists,
  ensureDir: (absDir) => {
    const d = new Directory(toUri(absDir));
    if (!d.exists) d.create({ intermediates: true });
  },
  delete: (absPath) => {
    const f = new File(toUri(absPath));
    if (f.exists) f.delete();
  },
};
