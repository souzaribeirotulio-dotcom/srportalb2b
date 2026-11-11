/* =====================================================================
   ADAPTADOR MOVIMENTO SISTEMAS — a implementar pela Movimento.
   ---------------------------------------------------------------------
   Deve expor as mesmas operações de servicos/contrato.js, devolvendo os
   formatos esperados pelas telas (o adaptador mock tem exemplos completos).
   Endpoints, autenticação e contratos oficiais são definidos pela Movimento;
   nada aqui é contrato oficial. Enquanto não houver implementação, cada
   operação informa que depende de integração.
   Para ativar: servicos/configuracao.js → window.SR_ADAPTADOR = 'movimento'.
   ===================================================================== */
(function(){
'use strict';
const pendente=nome=>async()=>{throw new Error('Operação "'+nome+'" ainda depende da integração com a Movimento Sistemas.')};
const Movimento={nome:'movimento',demonstracao:false};
Object.keys(window.SR_CONTRATO||{}).forEach(op=>Movimento[op]=pendente(op));
// Operações que podem responder vazio sem bloquear a tela:
Movimento.sessaoCliente=async()=>null;
Movimento.sessaoAdmin=async()=>null;
Movimento.configuracao=async()=>({});
Movimento.fotosCatalogo=async()=>({});
Movimento.registrarEvento=async()=>true;
Movimento.atualizarCarrinhoMonitorado=async()=>true;
// TODO Movimento: substituir cada operação pela chamada real ao G360.
window.SR_ADAPTADORES=window.SR_ADAPTADORES||{};
window.SR_ADAPTADORES.movimento=Movimento;
})();
