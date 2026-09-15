import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Where the renderer actually is: inside node_modules when installed, and a
 * checkout elsewhere on the disk when linked for working on both at once.
 * The dev server has to be allowed to serve from there, and its watcher told
 * not to ignore it.
 */
const renderer = dirname(createRequire(import.meta.url).resolve('artshape-render/package.json'));

export default defineConfig({
  server: {
    port: 5194,
    strictPort: true,
    watch: { ignored: ['!**/node_modules/artshape-render/**'] },
    fs: { allow: ['.', renderer] },
  },
  optimizeDeps: { exclude: ['artshape-render'] },
});
