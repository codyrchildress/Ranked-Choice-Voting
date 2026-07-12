// Local driver: the built-in node:sqlite against a file (or ':memory:' in
// tests). Synchronous under the hood, exposed through the same async
// interface as the Turso driver: query / run / batch / close.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_STATEMENTS } from './schema.js';

export function createLocalDb(dbPath = process.env.RCV_DB_PATH ?? './data/runoff.db') {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const sql of SCHEMA_STATEMENTS) db.exec(sql);

  return {
    async query(sql, args = []) {
      return db.prepare(sql).all(...args);
    },

    async run(sql, args = []) {
      const result = db.prepare(sql).run(...args);
      return { changes: Number(result.changes) };
    },

    // Atomic: all statements commit together or not at all.
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const { sql, args = [] } of statements) db.prepare(sql).run(...args);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async close() {
      db.close();
    },
  };
}
