import { defineConfig } from 'vite';

// Porta fixa: a API só aceita chamadas da origem cadastrada http://localhost:5173.
// Abra sempre "localhost", nunca "127.0.0.1".
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { outDir: 'dist' },
  // Versão no rodapé: commit publicado pela Vercel (ou "local").
  define: { __VERSAO__: JSON.stringify(`${(process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`) },
});
