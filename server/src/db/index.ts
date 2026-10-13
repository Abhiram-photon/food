import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { openMigratedDatabase, migrate } from './schema';

export type SqlValue = string | number | bigint | null | Uint8Array | boolean | undefined;

function normalizeParams(params: unknown[]): Array<string | number | bigint | null | Uint8Array> {
  return params.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
      return value;
    }
    if (value instanceof Uint8Array) return value;
    throw new TypeError(`Unsupported SQLite parameter: ${typeof value}`);
  });
}

/**
 * Thin synchronous wrapper around `node:sqlite`.
 *
 * `node:sqlite` is synchronous, so a transaction body cannot be interleaved by
 * another request — that is exactly the guarantee we need for transactional
 * stock control (BEGIN IMMEDIATE + synchronous critical section).
 */
export class Db {
  readonly handle: DatabaseSync;
  private depth = 0;

  constructor(path: string, options: { migrateOnOpen?: boolean } = {}) {
    this.handle =
      options.migrateOnOpen === false ? new DatabaseSync(path) : openMigratedDatabase({ path });
    if (options.migrateOnOpen === false) migrate(this.handle);
  }

  prepare(sql: string): StatementSync {
    return this.handle.prepare(sql);
  }

  run(sql: string, params: unknown[] = []) {
    return this.prepare(sql).run(...normalizeParams(params));
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return this.prepare(sql).get(...normalizeParams(params)) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.prepare(sql).all(...normalizeParams(params)) as T[];
  }

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  /**
   * Runs `fn` inside `BEGIN IMMEDIATE ... COMMIT`. Nested calls join the outer
   * transaction (SQLite has no true nested transactions).
   */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.handle.exec('BEGIN IMMEDIATE');
    this.depth += 1;
    try {
      const result = fn();
      this.handle.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.handle.exec('ROLLBACK');
      } catch {
        /* rollback errors are secondary to the original failure */
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close(): void {
    try {
      this.handle.close();
    } catch {
      /* already closed */
    }
  }
}

export function createDb(path: string): Db {
  return new Db(path);
}
