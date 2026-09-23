const initSqlJs = require('sql.js/dist/sql-wasm.js');
let SQL = null;
async function load() { if (!SQL) SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' }); return SQL; }
async function openDatabaseAsync() {
  const S = await load();
  const db = new S.Database();
  let chain = Promise.resolve();
  const q = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const rows = (sql, params) => { const st = db.prepare(sql); st.bind(params ?? []); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out; };
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
