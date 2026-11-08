// Stockage : Postgres (Neon) si DATABASE_URL, sinon fichier JSON local (dev).
// Une seule table générique : (collection, id) -> data jsonb.
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.DATABASE_URL;
let pool = null;
let mem = {}; // fallback JSON
const FILE = path.join(__dirname, '..', 'data', 'store.json');
let saveTimer = null;

async function init() {
  if (DB_URL) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: DB_URL, ssl: DB_URL.includes('localhost') ? false : { rejectUnauthorized: false }, max: 5 });
    await pool.query(`CREATE TABLE IF NOT EXISTS sl_records (
      collection TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (collection, id))`);
    console.log('[store] Postgres prêt');
  } else {
    try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = {}; }
    console.log('[store] Mode fichier local (data/store.json) — définir DATABASE_URL en production');
  }
}

function persistFile() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(mem));
  }, 200);
}

async function list(col) {
  if (pool) {
    const r = await pool.query('SELECT data FROM sl_records WHERE collection=$1 ORDER BY updated_at DESC', [col]);
    return r.rows.map(x => x.data);
  }
  return Object.values(mem[col] || {});
}

async function get(col, id) {
  if (pool) {
    const r = await pool.query('SELECT data FROM sl_records WHERE collection=$1 AND id=$2', [col, String(id)]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  return (mem[col] || {})[id] ?? null;
}

async function put(col, id, data) {
  if (pool) {
    await pool.query(`INSERT INTO sl_records (collection,id,data,updated_at) VALUES ($1,$2,$3,now())
      ON CONFLICT (collection,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [col, String(id), JSON.stringify(data)]);
  } else {
    (mem[col] ||= {})[id] = data; persistFile();
  }
  return data;
}

async function del(col, id) {
  if (pool) await pool.query('DELETE FROM sl_records WHERE collection=$1 AND id=$2', [col, String(id)]);
  else if (mem[col]) { delete mem[col][id]; persistFile(); }
}

async function replaceAll(col, items, idKey = 'id') {
  if (pool) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM sl_records WHERE collection=$1', [col]);
      for (const it of items) {
        await c.query('INSERT INTO sl_records (collection,id,data) VALUES ($1,$2,$3)', [col, String(it[idKey]), JSON.stringify(it)]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  } else {
    mem[col] = {}; for (const it of items) mem[col][it[idKey]] = it; persistFile();
  }
}

async function count(col) {
  if (pool) { const r = await pool.query('SELECT count(*)::int n FROM sl_records WHERE collection=$1', [col]); return r.rows[0].n; }
  return Object.keys(mem[col] || {}).length;
}

const kv = {
  get: async (k, dflt = null) => (await get('_kv', k)) ?? dflt,
  set: (k, v) => put('_kv', k, v),
};

module.exports = { init, list, get, put, del, replaceAll, count, kv };
