import { defineConfig } from 'vite';

// Porta fixa: a API só aceita chamadas da origem cadastrada http://localhost:5173.
// Abra sempre "localhost", nunca "127.0.0.1".
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { outDir: 'dist' },
});
