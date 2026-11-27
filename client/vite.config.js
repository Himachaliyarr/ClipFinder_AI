import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ mode }) => {
  const { PORT = '5000' } = loadEnv(mode, repositoryRoot, 'PORT');
  const apiTarget = `http://localhost:${PORT}`;

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          marketing: fileURLToPath(new URL('./index.html', import.meta.url)),
          app: fileURLToPath(new URL('./app.html', import.meta.url)),
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': apiTarget,
        '/media': apiTarget,
      },
    },
  };
});
