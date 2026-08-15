import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../src/config/env.js';
import { getDb, resetDb } from '../src/db/connection.js';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Verify a freshly written backup by opening it read-only and running SQLite's
 * integrity check. Returns `{ ok, problems, tableCount }` — `ok` is true only
 * when integrity_check reports no errors and at least one table exists.
 */
export function verifyBackup(target) {
  let check;
  try {
    check = new DatabaseSync(target, { readOnly: true });
    try {
      const rows = check.prepare('PRAGMA integrity_check').all();
      const bad = rows.filter((r) => String(r.integrity_check) !== 'ok');
      const tableCount = check.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get().c;
      return { ok: bad.length === 0 && tableCount > 0, problems: bad.map((r) => r.integrity_check), tableCount };
    } finally {
      check.close();
    }
  } catch (err) {
    return { ok: false, problems: [String(err.message || err)], tableCount: 0 };
  }
}

function main() {
  if (env.dbPath === ':memory:') {
    console.error('Cannot back up an in-memory database.');
    process.exit(1);
  }

  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(path.dirname(env.dbPath), 'backups', `crm-${stamp()}.db`);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    console.error(`Backup target already exists: ${target}`);
    process.exit(1);
  }

  const db = getDb();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const escaped = target.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}';`);
  resetDb();

  const verify = verifyBackup(target);
  console.log(`Backup written to ${target}`);
  if (!verify.ok) {
    console.error('Backup verification FAILED:');
    for (const p of verify.problems) console.error(`  - ${p}`);
    console.error('Do not rely on this backup. Investigate before proceeding.');
    process.exit(1);
  }
  console.log(`Backup verified: integrity ok (${verify.tableCount} tables).`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
