/* Avisos no celular (Web Push). Só com o "Permitir" do próprio cliente.
   O aparelho fica registrado na tabela push_inscricoes do Supabase (regra de acesso igual à da
   Minha Lista: cada comprador só vê e mexe nos próprios aparelhos). Nenhum aviso é disparado
   automaticamente por aqui: o único envio é o "Enviar aviso de teste", pedido pelo próprio cliente. */
import { sessao, garantirVinculo } from './sessao.js';
import { supabaseComprador, LOJA } from '../api/supabase.js';
import { chavePublicaPush, enviarAvisoTeste, inscreverPainelPush, desinscreverPainelPush, testarPainelPush } from '../api/push.js';

const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ehApp = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** Situação para a tela: 'sem_suporte' | 'instalar_primeiro' | 'bloqueado' | 'ativo' | 'desligado' */
export async function situacaoAvisos() {
  if (ehIOS() && !ehApp()) return 'instalar_primeiro';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'sem_suporte';
  if (Notification.permission === 'denied') return 'bloqueado';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'ativo' : 'desligado';
  } catch { return 'desligado'; }
}

function chaveEmBytes(b64) {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function nomeAparelho() {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  return 'Computador';
}

/** Pede a permissão e inscreve o aparelho (precisa vir de um toque). Devolve o JSON da inscrição. */
async function inscreverAparelho() {
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') throw new Error('Os avisos não foram permitidos. Para ativar depois, libere as notificações do app nos Ajustes do celular.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveEmBytes(await chavePublicaPush()) });
  return sub.toJSON();
}

/** Pede a permissão, inscreve o aparelho e grava no Supabase. Lança Error com mensagem para a tela. */
export async function ativarAvisos() {
  if (!sessao.ativa) throw new Error('Entre na sua conta para ativar os avisos.');
  const j = await inscreverAparelho();
  if (!(await garantirVinculo())) throw new Error('Não foi possível salvar agora. Tente de novo em instantes.');
  const { error } = await supabaseComprador().from('push_inscricoes').insert({
    loja: LOJA, comprador_codigo: sessao.comprador.codigo, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho: nomeAparelho(),
  });
  if (error && error.code !== '23505') throw new Error('Não foi possível salvar agora. Tente de novo em instantes.'); // 23505 = já estava salvo
}

/** Desliga neste aparelho: apaga o registro (do próprio comprador) e cancela a inscrição. */
export async function desativarAvisos() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  if (sessao.ativa && await garantirVinculo()) {
    await supabaseComprador().from('push_inscricoes').delete().eq('loja', LOJA).eq('comprador_codigo', sessao.comprador.codigo).eq('endpoint', sub.endpoint);
  }
  await sub.unsubscribe();
}

export async function testarAviso() {
  if (!sessao.ativa) throw new Error('Entre na sua conta para enviar o teste.');
  return enviarAvisoTeste(sessao.token);
}

/* ---------- Painel (gestores) ---------- */
export async function ativarAvisosPainel(token) {
  const j = await inscreverAparelho();
  await inscreverPainelPush(token, j, nomeAparelho());
}
export async function desativarAvisosPainel(token) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  try { await desinscreverPainelPush(token, sub.endpoint); } finally { await sub.unsubscribe(); }
}
export const testarAvisoPainel = (token) => testarPainelPush(token);
