import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

let db = null;

/**
 * Open a SQLite database connection with the required pragmas.
 * @param {string} dbPath file path or ':memory:'
 */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
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
