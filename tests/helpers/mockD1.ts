import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';

export function createTestD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  // Apply every migration in order, same as `wrangler d1 migrations apply`,
  // so the mock always matches the real schema.
  const migrationsDir = resolve(process.cwd(), 'migrations');
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    sqlite.exec(readFileSync(resolve(migrationsDir, file), 'utf-8'));
  }

  function makeStatement(sql: string, params: unknown[] = []): D1PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return makeStatement(sql, values);
      },
      async first<T = unknown>(colName?: string): Promise<T | null> {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...(params as never[])) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        const stmt = sqlite.prepare(sql);
        const results = stmt.all(...(params as never[])) as T[];
        return {
          results,
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: results.length,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0,
          },
        };
      },
      async run(): Promise<D1Result> {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...(params as never[]));
        return {
          results: [],
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
            changed_db: info.changes > 0,
            changes: Number(info.changes),
          },
        };
      },
      async raw<T = unknown>(): Promise<T[]> {
        const stmt = sqlite.prepare(sql);
        return stmt.all(...(params as never[])) as T[];
      },
    } as unknown as D1PreparedStatement;
  }

  return {
    prepare(sql: string) {
      return makeStatement(sql);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      // D1's real `batch` runs atomically; node:sqlite has no async transaction
      // API here, so we just run each statement in order, which is enough for
      // the mock's purpose (the production code only relies on all-or-nothing
      // ordering within one request, not cross-request isolation).
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        results.push((await stmt.run()) as unknown as D1Result<T>);
      }
      return results;
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}
