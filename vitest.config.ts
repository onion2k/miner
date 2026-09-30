import { defineConfig } from 'vitest/config';

// The quick run, which is the hook: everything in `test/` but `test/slow/`, whose tests play a whole cave
// through and are run by `npm run test:slow`, as part of the full check. A slow test is not given a longer
// timeout to fit here; it is moved out.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/slow/**', 'node_modules/**'],
    environment: 'node',
  },
});
