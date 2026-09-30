import { defineConfig } from 'vitest/config';

// The slow tests: each plays a cave through, and takes seconds. Run by `npm run test:slow`, in the full check.
export default defineConfig({
  test: {
    include: ['test/slow/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
