// واجهة قاعدة البيانات الموحّدة (async): SQLite محليًا، وD1 عند التشغيل على Cloudflare Workers.
// كل الاستعلامات تمر عبر: all / get / run / batch.

export function onCloudflare() {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

export async function cfEnv() {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare');
  return (await getCloudflareContext({ async: true })).env;
}

function d1Adapter(d1) {
  const bind = (sql, params = []) => d1.prepare(sql).bind(...params);
  return {
    kind: 'd1',
    async all(sql, params) {
      return (await bind(sql, params).all()).results;
    },
    async get(sql, params) {
      return (await bind(sql, params).first()) ?? null;
    },
    async run(sql, params) {
      const r = await bind(sql, params).run();
      return { lastRowId: r.meta.last_row_id, changes: r.meta.changes };
    },
    async batch(stmts) {
      if (!stmts.length) return [];
      return d1.batch(stmts.map(([sql, params]) => bind(sql, params)));
    },
  };
}

export async function getDb() {
  if (onCloudflare()) return d1Adapter((await cfEnv()).DB);
  if (!globalThis.__beneficiaryDb) {
    const m = await import('./db-node.js');
    globalThis.__beneficiaryDb = m.nodeAdapter(m.openDb());
  }
  return globalThis.__beneficiaryDb;
}

export function nowIso() {
  return new Date().toISOString();
}

// قائمة معرّفات كمعامل واحد (D1 يسمح بـ 100 معامل فقط لكل استعلام).
export function inList(column, values) {
  return [`${column} IN (SELECT value FROM json_each(?))`, JSON.stringify(values)];
}
