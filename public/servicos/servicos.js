/* Resolve o adaptador escolhido em servicos/configuracao.js e o publica como
   window.Servicos. As telas usam apenas window.Servicos (no app: const API). */
(function(){
'use strict';
const nome=window.SR_ADAPTADOR||'mock';
const ad=(window.SR_ADAPTADORES||{})[nome];
if(!ad)throw new Error('Adaptador de serviços "'+nome+'" não foi carregado. Confira servicos/configuracao.js e index.html.');
const faltando=Object.keys(window.SR_CONTRATO||{}).filter(op=>typeof ad[op]!=='function');
if(faltando.length)console.warn('Adaptador "'+nome+'" sem as operações:',faltando.join(', '));
// O portal (src/main.js) pode carregar antes deste arquivo e já ter ligado operações próprias
// (ex.: assistentePerguntar da Souzinha). Essas continuam valendo; o adaptador só completa o que falta.
window.Servicos=Object.assign({},ad,window.Servicos||{});
})();
