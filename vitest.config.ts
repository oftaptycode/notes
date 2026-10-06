import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    pool: 'threads',
    maxWorkers: 2,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
