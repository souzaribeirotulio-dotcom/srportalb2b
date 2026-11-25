/* Cliente criado pelo cadastro automático e ainda em análise: entra e navega, mas
   o portal esconde preços e compra até a equipe aprovar no painel (portal_cadastros.em_analise).
   Quem diz é a regra do banco (portal_ocultos_comprador), lida com a sessão vinculada do comprador. */
let emAnalise = false;
export const MSG_ANALISE = 'Seu cadastro está em análise. Os preços e as compras são liberados assim que a Souza Ribeiro aprovar.';
export function clienteEmAnalise() { return emAnalise; }
export function definirEmAnalise(v) {
  const novo = !!v;
  if (novo === emAnalise) return;
  emAnalise = novo;
  try {
    document.body.classList.toggle('cliente-analise', emAnalise);
    let av = document.getElementById('avisoAnalise');
    if (emAnalise && !av) {
      av = document.createElement('div'); av.id = 'avisoAnalise'; av.className = 'aviso-analise'; av.setAttribute('role', 'status');
      av.innerHTML = '<b>Cadastro em análise.</b> Você já pode conhecer os produtos. Os preços e as compras são liberados assim que a Souza Ribeiro aprovar o seu cadastro, e a gente avisa você por e-mail.';
      const ref = document.getElementById('banners') || document.querySelector('.hero');
      if (ref?.parentNode) ref.parentNode.insertBefore(av, ref); else document.body.prepend(av);
    } else if (!emAnalise && av) av.remove();
  } catch { /* sem página */ }
  try { window.dispatchEvent(new CustomEvent('g360:analise', { detail: emAnalise })); } catch { /* sem página */ }
}
