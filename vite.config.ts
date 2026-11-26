import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/astronomy-engine')) return 'astronomy';
          if (id.includes('node_modules/proj4')) return 'geo';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173
  }
});
