import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

let db = null;

/**
 * Harden file-system permissions on the database file and its WAL/SHM sidecars
 * so that other users on a shared host cannot read tenant data. Best-effort:
 * filesystems that ignore chmod must not prevent startup.
 */
function hardenDbPermissions(dbPath) {
  if (dbPath === ':memory:') return;
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Open a SQLite database connection with the required pragmas.
 * @param {string} dbPath file path or ':memory:'
 */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* ignore */
    }
  }
  const database = new DatabaseSync(dbPath);
  hardenDbPermissions(dbPath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA synchronous = NORMAL;');
  database.exec('PRAGMA cache_size = -64000;');
  database.exec('PRAGMA temp_store = MEMORY;');
  hardenDbPermissions(dbPath);
  return database;
}

/**
 * Singleton database accessor, resolved from configuration.
 */
export function getDb() {
  if (!db) {
    db = openDatabase(env.dbPath);
  }
  return db;
}

/**
 * Replace the singleton connection (used by tests to inject a fresh DB).
 */
export function setDb(database) {
  db = database;
}

export function resetDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  db = null;
}
