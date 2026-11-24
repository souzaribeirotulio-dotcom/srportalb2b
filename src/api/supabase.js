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
export function supabaseExecutivo() {
  if (!executivo && supabaseConfigurado()) {
    executivo = createClient(URL_SUPABASE, CHAVE_PUBLICA, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `g360:${LOJA}:executivo-sessao`, storage: window.sessionStorage },
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
