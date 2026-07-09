import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '',
  build: {
    outDir: resolve(__dirname, '..', 'dist', 'webview'),
    emptyOutDir: true,
    sourcemap: false,
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
