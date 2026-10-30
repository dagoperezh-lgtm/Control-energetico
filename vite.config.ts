import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funciona en GitHub Pages con cualquier nombre de repositorio
export default defineConfig({
  base: './',
  plugins: [react()],
  // Compatibilidad con iPhone con iOS 15 o superior
  build: { chunkSizeWarningLimit: 1500, target: ['es2020', 'safari15'] },
});
