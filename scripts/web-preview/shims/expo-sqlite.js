const initSqlJs = require('sql.js/dist/sql-wasm.js');
let SQL = null;
async function load() { if (!SQL) SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' }); return SQL; }
async function openDatabaseAsync() {
  const S = await load();
  const db = new S.Database();
  let chain = Promise.resolve();
  const q = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const raw = (sql, params) => { const st = db.prepare(sql); st.bind(params ?? []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
  // 撮影用: ?showColor=%23C4492F&showName=...&showAuthor=... で番組の代表色・名前を差し替える（画像は読めないので名前の表紙になる）
  const seed = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const patchShow = (r) => ({
    ...r,
    ...(seed.get('showColor') ? { cover_color: seed.get('showColor'), cover_path: 'artwork/preview.png' } : {}),
    ...(seed.get('showName') ? { name: seed.get('showName') } : {}),
    ...(seed.get('showAuthor') ? { author: seed.get('showAuthor') } : {}),
  });
  const rows = (sql, params) => { const out = raw(sql, params); return /\bFROM shows\b/i.test(sql) ? out.map(patchShow) : out; };
  // 撮影用: スクリプトから素材や番組の構成を入れられるように DB を出しておく（製品には含めない）
  if (typeof window !== 'undefined') window.__podsnowDb = db;
  let inTx = false;
  const api = {
    execAsync: async (sql) => { db.exec(sql.replace(/PRAGMA journal_mode = WAL;/, '')); },
    runAsync: async (sql, params) => { db.run(sql, params ?? []); return { changes: db.getRowsModified(), lastInsertRowId: 0 }; },
    getAllAsync: async (sql, params) => rows(sql, params),
    getFirstAsync: async (sql, params) => rows(sql, params)[0] ?? null,
    withExclusiveTransactionAsync: async (fn) => {
      if (inTx) return fn(api);
      inTx = true; db.exec('BEGIN');
      try { await fn(api); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } finally { inTx = false; }
    },
  };
  return api;
}
module.exports = { openDatabaseAsync };
