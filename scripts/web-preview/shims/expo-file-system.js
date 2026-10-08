const files = (globalThis.__memfs = globalThis.__memfs || new Map());
const dirs = (globalThis.__memdirs = globalThis.__memdirs || new Set(['/doc']));
const norm = (u) => String(u).replace(/^file:\/\//, '');
const join = (a, b) => (norm(a).replace(/\/$/, '') + '/' + b).replace(/\/+/g, '/');
class File {
  constructor(a, b) { this.path = b !== undefined ? join(a.uri ?? a, b) : norm(a.uri ?? a); this.uri = 'file://' + this.path; }
  get exists() { return files.has(this.path); }
  get size() { return files.get(this.path)?.length ?? 0; }
  create() { files.set(this.path, new Uint8Array(0)); }
  delete() { files.delete(this.path); }
  write(data) { files.set(this.path, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)); }
  async bytes() { return files.get(this.path) ?? new Uint8Array(0); }
  bytesSync() { return files.get(this.path) ?? new Uint8Array(0); }
  async text() { return new TextDecoder().decode(files.get(this.path) ?? new Uint8Array(0)); }
  textSync() { return new TextDecoder().decode(files.get(this.path) ?? new Uint8Array(0)); }
  copy(dest) { files.set(norm(dest.uri ?? dest), files.get(this.path)); }
  move(dest) { this.copy(dest); files.delete(this.path); }
  open() {
    const p = this.path; let offset = 0;
    return {
      get size() { return files.get(p)?.length ?? 0; },
      get offset() { return offset; },
      readBytes(n) { const b = files.get(p).slice(offset, offset + n); offset += b.length; return b; },
      writeBytes(bytes) { const cur = files.get(p) ?? new Uint8Array(0); const out = new Uint8Array(cur.length + bytes.length); out.set(cur); out.set(bytes, cur.length); files.set(p, out); offset = out.length; },
      close() {},
    };
  }
}
class Directory {
  constructor(a, b) { this.path = b !== undefined ? join(a.uri ?? a, b) : norm(a.uri ?? a); this.uri = 'file://' + this.path; }
  get exists() { return dirs.has(this.path); }
  create() { dirs.add(this.path); }
  delete() { dirs.delete(this.path); for (const k of [...files.keys()]) if (k.startsWith(this.path + '/')) files.delete(k); }
  list() { return []; }
}
const Paths = { document: new Directory('/doc'), cache: new Directory('/cache'), get availableDiskSpace() { return 8 * 1024 ** 3; }, get totalDiskSpace() { return 64 * 1024 ** 3; } };
module.exports = { File, Directory, Paths };
