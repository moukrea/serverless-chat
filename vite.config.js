import { defineConfig } from 'vite';

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
  resolve: {
    alias: {
      events: 'events',
      process: 'process/browser',
    },
  },
  define: {
    'process.env': {},
  },
});
