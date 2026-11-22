import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import dagrePatches from './dagre-stack-safe.cjs';

function stackSafeDagre() {
  return {
    name: 'stack-safe-dagre',
    enforce: 'pre' as const,
    load(id: string) {
      if (!/[\\/]node_modules[\\/](dagre|graphlib)[\\/].*\.js$/.test(id)) return null;
      const source = readFileSync(id, 'utf8');
      const patched = dagrePatches.patchDagre(source, id);
      return patched === source ? null : patched;
    },
  };
}

export default defineConfig({
  plugins: [stackSafeDagre(), react()],
  worker: { format: 'iife', plugins: () => [stackSafeDagre()] },
  base: '',
  build: {
    outDir: resolve(__dirname, '..', 'dist', 'webview'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    // Single chunk for CSP compatibility in VS Code webviews
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        // Bundle everything into a single chunk
        manualChunks: undefined,
      },
    },
  },
  // Resolve paths
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
