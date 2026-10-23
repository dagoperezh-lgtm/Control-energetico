import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funciona en GitHub Pages con cualquier nombre de repositorio
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
});
