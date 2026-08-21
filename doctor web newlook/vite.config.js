import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
    // The Cloudflare plugin boots a workerd runtime for the edge worker. That
    // is what `npm run preview` / `npm run deploy` need, but in this project it
    // never finishes starting — `vite dev` sits with no output and accepts
    // connections it never answers. The worker plays no part in serving the
    // dev app, so load the plugin for builds only and let `vite dev` come up.
    plugins: command === 'build' ? [react(), cloudflare()] : [react()],
    // node_modules is a symlink to the base frontend's, so the default
    // node_modules/.vite cache would be shared with that project and the two
    // dev servers would keep invalidating each other's pre-bundle. Keep ours
    // inside this project instead.
    cacheDir: '.vite-cache',
    server: {
        port: 3100,
        // Polling every file under an iCloud-synced tree pins a core and
        // starves the dev server; the default fs events are enough here.
        hmr: { clientPort: 3100 },
        proxy: {
            '/api': {
                target: 'http://localhost:5001',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '')
            }
        }
    }
}))
