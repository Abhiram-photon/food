import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Concurrency tests hit a shared in-memory SQLite database; keep files isolated
    // (each test file builds its own app + database) but avoid cross-file surprises.
    fileParallelism: true,
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
