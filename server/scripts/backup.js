import fs from 'node:fs';
import path from 'node:path';
import { env } from '../src/config/env.js';
import { getDb, resetDb } from '../src/db/connection.js';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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
  console.log(`Backup written to ${target}`);
}

main();
