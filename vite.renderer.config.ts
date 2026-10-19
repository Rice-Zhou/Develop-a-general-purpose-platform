import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'apps/desktop', base: './', plugins: [react()], server: { host: '127.0.0.1' } });
