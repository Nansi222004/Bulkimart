import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
  },
});										