import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  base: '/serverless-chat/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 3000,
    open: true,
  },
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'robots.txt'],

      manifest: {
        name: 'P2P Mesh Chat',
        short_name: 'MeshChat',
        description: 'Serverless peer-to-peer chat application with mesh networking. Connect directly with peers without any server.',
        theme_color: '#5865F2',
        background_color: '#313338',
        display: 'standalone',
        scope: '/serverless-chat/',
        start_url: '/serverless-chat/',
        orientation: 'portrait-primary',
        categories: ['social', 'productivity', 'utilities'],
        icons: [
          {
            src: '/serverless-chat/pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: '/serverless-chat/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/serverless-chat/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/serverless-chat/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],

        runtimeCaching: [
          {
            // Cache external CDN resources (Tabler Icons)
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'cdn-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ],

        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true
      },

      devOptions: {
        enabled: true,  // Enable PWA in development mode
        type: 'module',
        navigateFallback: 'index.html'
      }
    })
  ]
});
