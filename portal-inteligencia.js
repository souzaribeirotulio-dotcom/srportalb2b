/* Inteligência Comercial — somente clientes logados, sem telemetria financeira.
   Eventos não bloqueiam o uso do portal. Toda leitura do painel exige token admin. */
let intelBuscaTimer=null, intelUltimaBusca='',intelUltimaBuscaEm=0;
let intelCartTimer=null, intelFilaCarrinho=Promise.resolve(), intelSequenciaPainel=0;
const intelAtivo=()=>typeof CLI!=='undefined'&&!!CLI&&!!CNPJ&&!(typeof ADM!=='undefined'&&ADM)&&USA_SB()&&!!tokGet('sr_b2b_tok');
const intelNumero=n=>Number(n||0).toLocaleString('pt-BR');
const intelSeguroTexto=s=>esc(String(s||''));
function intelEvento(evento,cod=null,termo=null,resultados=null){
  if(!intelAtivo())return;
  rpc('portal_intel_registrar_evento',{
    p_token:tokGet('sr_b2b_tok'),p_evento:evento,p_cod:cod,p_termo:termo,p_resultados:resultados
  }).catch(()=>{}); // Analytics nunca pode impedir a compra.
}
function intelAtualizarCarrinho(itens,origem='carrinho',checkout=false){
  if(!intelAtivo())return;
  const p_token=tokGet('sr_b2b_tok');
  const p_itens=(itens||[]).filter(i=>i&&i.p&&i.p.cod&&i.q>0)
    .slice(0,80).map(i=>({cod:i.p.cod,q:Math.min(9999,Math.round(i.q))}));
  const args={p_token,p_itens,p_origem:origem==='lista'?'lista':'carrinho',p_checkout:!!checkout};
  // Preserva a ordem das atualizações do mesmo navegador.
  intelFilaCarrinho=intelFilaCarrinho.catch(()=>{}).then(()=>
    rpc('portal_intel_atualizar_carrinho',args)).catch(()=>{});
}
function intelProgramarCarrinho(){
  clearTimeout(intelCartTimer);
  if(!intelAtivo())return;
  intelCartTimer=setTimeout(()=>intelAtualizarCarrinho(cartItems(),'carrinho',false),550);
}
function intelIniciarCheckout(itens,origem){
  if(!intelAtivo())return;
  clearTimeout(intelCartTimer);
  intelEvento('checkout');
  intelAtualizarCarrinho(itens,origem,true);
}
function intelConcluirSimulacao(){
  // A interface ainda simula pedidos. Não registrar como pedido confirmado real.
  clearTimeout(intelCartTimer);
  intelAtualizarCarrinho([], 'carrinho',false);
}
const intelCampoBusca=document.getElementById('q');
if(intelCampoBusca)intelCampoBusca.addEventListener('input',()=>{
  clearTimeout(intelBuscaTimer);
  intelBuscaTimer=setTimeout(()=>{
    if(!intelAtivo()||VIEW!=='cat')return;
    const q=intelCampoBusca.value.trim();
    if(q.length<2||q.length>80||q.includes('@')||/[0-9]{11,}/.test(q))return;
    const chave=norm(q);
    if(intelUltimaBusca===chave&&Date.now()-intelUltimaBuscaEm<15000)return;
    intelUltimaBusca=chave;intelUltimaBuscaEm=Date.now();
    intelEvento('busca',null,q,document.querySelectorAll('#grid .card').length);
  },850);
});
function intelListaVazia(mensagem){
  return `<div class="intel-empty">${intelSeguroTexto(mensagem)}</div>`;
}
function intelRanking(items,campo){
  if(!Array.isArray(items)||!items.length)return intelListaVazia('Ainda sem dados no período.');
  const maximo=Math.max(1,...items.map(x=>Number(x.total)||0));
  return items.map(x=>{
    const total=Number(x.total)||0,percentual=Math.round(100*total/maximo);
    return `<div class="intel-rank">
      <div class="intel-rank-top"><span>${intelSeguroTexto(x[campo])}</span><b>${intelNumero(total)}</b></div>
      <div class="intel-bar"><span style="width:${percentual}%"></span></div>
    </div>`;
  }).join('');
}
function intelProdutoLinha(item){
  const p=typeof byCod!=='undefined'?byCod[item.cod]:null;
  const views=Number(item.visualizacoes)||0, adds=Number(item.adicoes)||0;
  return `<div class="intel-prod">
    <div><b>${intelSeguroTexto(p?p.t:'Produto código '+item.cod)}</b>
      <small>Cód. ${intelSeguroTexto(item.cod)}</small></div>
    <div class="intel-prod-num"><b>${intelNumero(views)}</b><small>visualizações</small></div>
    <div class="intel-prod-num"><b>${intelNumero(adds)}</b><small>adições</small></div>
  </div>`;
}
function intelCarrinhoLinha(item){
  const d=new Date(item.atualizado_em);
  const data=Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const itens=Array.isArray(item.itens)?item.itens:[];
  const lista=itens.slice(0,3).map(i=>{
    const p=typeof byCod!=='undefined'?byCod[i.cod]:null;
    return intelSeguroTexto((p?p.t:i.cod)+' × '+i.q);
  }).join(' · ');
  return `<div class="intel-cartrow">
    <div><b>${intelSeguroTexto(item.cliente||'Cliente')}</b>
      <small>CNPJ ${intelSeguroTexto(item.cnpj)} · ${intelNumero(itens.length)} produto(s)</small>
      <small>${lista}${itens.length>3?'…':''}</small></div>
    <div class="intel-cartdate">${data}<small>Última atividade</small></div>
  </div>`;
}
async function drawIntel(){
  const el=document.getElementById('intelPanel');
  if(!el||!ADM)return;
  const vez=++intelSequenciaPainel;
  el.innerHTML='<div class="panel intel-loading">Consultando indicadores do portal…</div>';
  const dias=Number(document.getElementById('intelPeriodo').value)||30;
  try{
    const dados=await API.inteligencia(dias);
    if(vez!==intelSequenciaPainel||AT!=='intel')return;
    const s=dados.resumo||{},buscas=Number(s.buscas)||0,sem=Number(s.sem_resultado)||0;
    const taxa=buscas?(100*sem/buscas).toFixed(1).replace('.',',')+'%':'—';
    const cards=[
      ['Clientes ativos',s.clientes_ativos,'Com atividades rastreadas'],
      ['Pesquisas',s.buscas,'Feitas por clientes logados'],
      ['Sem resultado',s.sem_resultado,taxa+' das pesquisas'],
      ['Produtos vistos',s.visualizacoes,'Aberturas de detalhes'],
      ['Adições ao carrinho',s.adicoes,'Ações de adicionar'],
      ['Checkouts iniciados',s.checkouts_iniciados,'Não são pedidos confirmados']
    ];
    const kpis=cards.map(([nome,valor,sub])=>`<div class="intel-kpi">
      <span>${intelSeguroTexto(nome)}</span><strong>${intelNumero(valor)}</strong><small>${intelSeguroTexto(sub)}</small>
    </div>`).join('');
    const produtos=Array.isArray(dados.produtos)?dados.produtos.filter(p=>Number(p.visualizacoes)>0):[];
    const parados=Array.isArray(dados.carrinhos)?dados.carrinhos:[];
    el.innerHTML=`
      <div class="intel-kpis">${kpis}</div>
      <div class="intel-grid">
        <section class="panel intel-section"><h3>Buscas mais frequentes</h3>
          <p>O que os clientes realmente procuram.</p>
          ${intelRanking(dados.buscas,'termo')}</section>
        <section class="panel intel-section"><h3>Buscas sem resultado</h3>
          <p>Oportunidades para melhorar sinônimos e cadastro.</p>
          ${intelRanking(dados.buscas_sem_resultado,'termo')}</section>
        <section class="panel intel-section"><h3>Produtos vistos, mas pouco adicionados</h3>
          <p>Interesse versus adição ao carrinho; não representa vendas perdidas.</p>
          ${produtos.length?produtos.map(intelProdutoLinha).join(''):intelListaVazia('Ainda não há visualizações suficientes.')}</section>
        <section class="panel intel-section"><h3>Carrinhos parados · ${intelNumero(dados.carrinhos_parados)}</h3>
          <p>Com itens e sem atualização há mais de 24 horas. Confira antes de contatar o cliente.</p>
          ${parados.length?parados.map(intelCarrinhoLinha).join(''):intelListaVazia('Nenhum carrinho parado neste período.')}</section>
      </div>
      <div class="panel intel-foot">
        <b>Pedidos confirmados e faturamento</b>
        <p>Aguardando retorno oficial da Movimento/G360. O checkout atual é demonstrativo e não entra como pedido real.</p>
      </div>
      <p class="intel-disclaimer">Coleta iniciada a partir da ativação deste painel. Somente clientes autenticados; buscas e interações anteriores não são recuperadas. Números de uso são indicativos, não comprovação de venda.</p>
    `;
  }catch(e){
    if(vez!==intelSequenciaPainel)return;
    el.innerHTML=`<div class="panel intel-loading">Não foi possível carregar os indicadores: ${intelSeguroTexto(e.message)}
      <div style="margin-top:12px"><button class="tool" onclick="drawIntel()">Tentar novamente</button></div></div>`;
  }
}
const intelPeriodo=document.getElementById('intelPeriodo');
if(intelPeriodo)intelPeriodo.addEventListener('change',drawIntel);
const intelAtualizar=document.getElementById('intelAtualizar');
if(intelAtualizar)intelAtualizar.addEventListener('click',drawIntel);
