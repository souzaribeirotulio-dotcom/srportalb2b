/* =====================================================================
   Clientes do Supabase da Souza Ribeiro (só a chave pública vai para o site).
   - comprador: sessão emitida pela ponte-g360, sem persistir (seção 5).
   - painel: conta própria do operador para ler ocorrências, com storageKey
     separado para não derrubar a sessão de um comprador no mesmo navegador.
   ===================================================================== */
import { createClient } from '@supabase/supabase-js';

const URL_SUPABASE = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const CHAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_CHAVE_PUBLICA || '').trim();
export const LOJA = String(import.meta.env.VITE_G360_LOJA || '').trim();

export function supabaseConfigurado() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(URL_SUPABASE) && /^sb_publishable_[A-Za-z0-9_-]+$/.test(CHAVE_PUBLICA);
}

let comprador = null;
let painel = null;

export function supabaseComprador() {
  if (!comprador && supabaseConfigurado()) {
    comprador = createClient(URL_SUPABASE, CHAVE_PUBLICA, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sr-g360-comprador' },
    });
  }
  return comprador;
}

/** Área do executivo de contas: conta própria (e-mail e senha), guardada só nesta aba,
 *  com chave separada para não misturar com a sessão de um comprador no mesmo navegador. */
let executivo = null;
/* Área do executivo: com "Continuar conectado" a sessão fica no localStorage (continua depois de
   fechar o navegador e renova sozinha); sem, só nesta aba (sessionStorage). Sair apaga dos dois. */
const CHAVE_LEMBRAR_EXEC = `g360:${LOJA}:executivo-lembrar`;
const armazemExecutivo = () => { try { return localStorage.getItem(CHAVE_LEMBRAR_EXEC) === '1' ? localStorage : sessionStorage; } catch { return sessionStorage; } };
const storageExecutivo = {
  getItem: (k) => { try { return armazemExecutivo().getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { armazemExecutivo().setItem(k, v); } catch { /* sem armazenamento */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* */ } try { sessionStorage.removeItem(k); } catch { /* */ } },
};
/** Escolha do "Continuar conectado" (antes do login). false também apaga a marca ao sair. */
export function lembrarExecutivo(sim) {
  try { if (sim) localStorage.setItem(CHAVE_LEMBRAR_EXEC, '1'); else localStorage.removeItem(CHAVE_LEMBRAR_EXEC); } catch { /* sem armazenamento */ }
}

export function supabaseExecutivo() {
  if (!executivo && supabaseConfigurado()) {
    executivo = createClient(URL_SUPABASE, CHAVE_PUBLICA, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `g360:${LOJA}:executivo-sessao`, storage: storageExecutivo },
    });
  }
  return executivo;
}

export function supabasePainel() {
  if (!painel && supabaseConfigurado()) {
    painel = createClient(URL_SUPABASE, CHAVE_PUBLICA, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sr-g360-painel' },
    });
  }
  return painel;
}
