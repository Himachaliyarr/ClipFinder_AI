import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ mode }) => {
  const { PORT = '5000' } = loadEnv(mode, repositoryRoot, 'PORT');
  const apiTarget = `http://localhost:${PORT}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': apiTarget,
        '/media': apiTarget,
      },
    },
  };
});
