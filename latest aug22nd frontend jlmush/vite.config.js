import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), cloudflare()],
    // Build-time constants. __APP_VERSION__ rides the X-Client-Version
    // header so backend logs and the min-version gate can name the build.
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
        port: 3000,
        watch: { usePolling: true },
        hmr: { clientPort: 3000 },
        proxy: {
            // Backend mounts everything at /api/v1 — forward the path
            // untouched (the old ^/api strip predates the versioned mount).
            '/api': {
                target: 'http://localhost:5001',
                changeOrigin: true
            }
        }
    }
})
