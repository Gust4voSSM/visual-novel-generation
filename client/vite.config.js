import { defineConfig } from 'vite';

// Em desenvolvimento, /api vai para as Pages Functions (npm run dev:api, porta 8788).
export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8788' } },
});
