// SQLite المحلية (node:sqlite) - للتشغيل على جهاز أو خادم أو Docker، وللسكربتات.
// node:sqlite تُحمَّل وقت التشغيل عبر getBuiltinModule حتى لا يحاول مُجمّع Cloudflare تضمينها.
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } from './schema.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data'));
export const DB_PATH = path.join(DATA_DIR, 'app.db');

const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3];

export function openDb(file = DB_PATH) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

// نفس واجهة محوّل D1: كل الدوال async.
export function nodeAdapter(db) {
  return {
    kind: 'sqlite',
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { lastRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async batch(stmts) {
      if (!stmts.length) return [];
      return tx(db, () => stmts.map(([sql, params = []]) => db.prepare(sql).run(...params)));
    },
  };
}
