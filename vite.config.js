import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';

// Dev (`npm run dev`): serves index.html as-is with HMR.
// Prod (`npm run build`): bundles everything — app modules, localforage,
// CSS — into ONE dist/index.html with zero external requests. That single
// file works by double-click (file://), where browsers block external
// ES-module files via CORS. discover_seed.json is copied to dist/ alongside
// (fetched lazily; over file:// the fetch fails gracefully and Discover
// falls back to the live API, since covers/API need internet anyway).
export default defineConfig({
  root: fs.realpathSync(process.cwd()).replace(/\\/g, '/'),
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 100 * 1024 * 1024
  },
  plugins: [viteSingleFile()]
});
