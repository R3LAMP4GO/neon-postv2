/**
 * Shared mock for better-sqlite3 Database
 *
 * Provides an in-memory mock that implements the subset of the better-sqlite3 API
 * used by MemoryManager and other modules, avoiding native module ELF header issues
 * in CI/cross-architecture environments.
 */
import { vi } from 'vitest';

export interface MockStatement {
  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
}

export interface MockDatabase {
  exec: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  pragma: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock statement object with run/get/all methods
 */
export function createMockStatement(overrides?: Partial<MockStatement>): MockStatement {
  return {
    run: overrides?.run ?? vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
    get: overrides?.get ?? vi.fn(() => undefined),
    all: overrides?.all ?? vi.fn(() => []),
  };
}

/**
 * Create a mock better-sqlite3 Database instance
 */
export function createMockDatabase(overrides?: Partial<MockDatabase>): MockDatabase {
  const defaultStatement = createMockStatement();

  return {
    exec: overrides?.exec ?? vi.fn(),
    prepare: overrides?.prepare ?? vi.fn(() => defaultStatement),
    close: overrides?.close ?? vi.fn(),
    pragma: overrides?.pragma ?? vi.fn(),
    transaction: overrides?.transaction ?? vi.fn((fn: (...args: unknown[]) => unknown) => fn),
  };
}

/**
 * Creates a vi.mock factory for 'better-sqlite3' that returns a mock Database class.
 * Usage:
 *   vi.mock('better-sqlite3', () => createBetterSqlite3Mock());
 */
export function createBetterSqlite3Mock(dbFactory?: () => MockDatabase) {
  const factory = dbFactory ?? createMockDatabase;
  const MockDatabaseClass = vi.fn(() => factory());
  return {
    default: MockDatabaseClass,
    Database: MockDatabaseClass,
  };
}
