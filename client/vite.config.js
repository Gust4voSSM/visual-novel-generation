import { defineConfig } from 'vite';

// Em desenvolvimento, /api (login, upload) e /img (imagens do KV) vão para as Pages Functions
// (npm run dev:api ou dev:api:anon, porta 8788).
export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8788', '/img': 'http://localhost:8788' } },
});
