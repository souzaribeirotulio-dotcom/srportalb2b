/* =====================================================================
   Souza Ribeiro · Portal B2B — ADAPTADOR MOCK (demonstração)
   ---------------------------------------------------------------------
   Implementa a interface descrita em servicos/contrato.js usando somente
   dados fictícios (servicos/dados-ficticios.js) guardados neste navegador.
   Não acessa rede, Supabase, ERP nem qualquer serviço externo.

   Os valores devolvidos (preços, conversões, totais, condições, previsão
   de entrega) são FICTÍCIOS e servem só para demonstrar os estados da tela.
   Este arquivo NÃO implementa regras comerciais da Souza Ribeiro nem da
   Movimento: a lógica abaixo existe apenas para produzir respostas plausíveis.
   ===================================================================== */
(function(){
'use strict';
const CHAVE='sr_demo_estado_v1';
const D=()=>window.SR_DADOS_FICTICIOS;
const clone=o=>JSON.parse(JSON.stringify(o));
const espera=(ms)=>new Promise(r=>setTimeout(r,ms??(180+Math.random()*220)));
const hojeISO=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const somaDias=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const brData=iso=>iso?new Date(iso.slice(0,10)+'T12:00').toLocaleDateString('pt-BR'):'';
const r2=v=>Math.round(v*100)/100;
const plural=(w,q)=>{w=String(w||'').toLowerCase();return q>1?w.replace(/^(\S+?)(ão)?$/,(m,a,b)=>b?a+'ões':(/[aeiou]$/.test(a)?a+'s':a+'es')):w};
const aleatorio=n=>Math.random().toString(36).slice(2,2+n).toUpperCase();
class ErroServico extends Error{constructor(msg,codigo){super(msg);this.codigo=codigo||'erro'}}
const erro=(m,c)=>{throw new ErroServico(m,c)};

function estadoInicial(){
 const d=D();
 const clientes={};
 for(const [cnpj,c] of Object.entries(clone(d.clientes)))clientes[cnpj]=c;
 return {versao:1,produtos:clone(d.produtos),alt:clone(d.unidades_alternativas),clientes,admins:clone(d.administradores),
  config:{},pedidos:{},negociacoes:[],escola:[],clips:{},sessao:{cliente:null,admin:null},seq:0,revisoes:{},cenarioEnvio:'sucesso'};
}
let E;
function carrega(){
 try{E=JSON.parse(localStorage.getItem(CHAVE))}catch(e){E=null}
 if(!E||E.versao!==1)E=estadoInicial();
}
function grava(){try{localStorage.setItem(CHAVE,JSON.stringify(E))}catch(e){console.warn('Demonstração: não foi possível gravar no navegador',e)}}
carrega();

const cliSessao=()=>{const c=E.sessao.cliente;if(!c||!E.clientes[c])erro('Sessão expirada. Entre novamente.','sessao');return c};
const admSessao=()=>{if(!E.sessao.admin)erro('Sessão de administrador expirada. Entre novamente.','sessao');return E.sessao.admin};
const formas=()=>(Array.isArray(E.config.formas)&&E.config.formas.length?E.config.formas:D().formas_pagamento);
const publicoCliente=(cnpj)=>{const c=E.clientes[cnpj];const {senha,congelados,lista,...resto}=c;return {cnpj,...clone(resto),nome:c.razao_social}};

/* Preços fictícios do cliente logado: tabela → preço especial (congelado) → negociação aceita. */
function negociacoesValidas(cnpj){
 const h=hojeISO(),o={};
 E.negociacoes.filter(n=>n.cnpj===cnpj&&n.status==='aceita'&&!n.congelar&&n.validade&&n.validade>=h).slice().reverse()
  .forEach(n=>n.itens.forEach(i=>{if(i.oferta>0)o[i.un_id?i.cod+'@'+i.un_id:i.cod]={preco:i.oferta,id:n.id,validade:n.validade}}));
 return o;
}
function precosDe(cnpj){
 const cong=cnpj?(E.clientes[cnpj]?.congelados||{}):{}, neg=cnpj?negociacoesValidas(cnpj):{};
 return (p,un)=>{
  const k=un&&un.id?p.cod+'@'+un.id:p.cod;
  if(neg[k])return {preco:neg[k].preco,origem:'negociado',etiqueta:'🤝 negociado até '+brData(neg[k].validade)};
  const c=cong[p.cod];
  if(!un||!un.id)return c!=null?{preco:c,origem:'especial',etiqueta:'Preço especial'}:{preco:p.p,origem:'tabela',etiqueta:''};
  if(c!=null)return {preco:r2(c*un.fator),origem:'especial',etiqueta:'Preço especial'};
  return {preco:un.preco??r2(p.p*un.fator),origem:'tabela',etiqueta:''};
 };
}
function unidadesDe(p){return [{id:'',nome:p.u,fator:1},...(E.alt[p.cod]||[])]}

const Mock={
 nome:'mock',
 demonstracao:true,

 /* ---------- Sessão ---------- */
 async login(cnpj,senha){
  await espera();
  const c=E.clientes[String(cnpj||'').replace(/\D/g,'')];
  if(!c||c.senha!==senha)erro('CNPJ ou senha incorretos.','credenciais');
  if(c.status==='pendente')erro('Seu cadastro está em análise. Avisaremos pelo WhatsApp assim que for liberado.','pendente');
  if(c.status!=='aprovado')erro('Cadastro não liberado. Fale com a Souza Ribeiro.','bloqueado');
  E.sessao.cliente=String(cnpj).replace(/\D/g,'');grava();
  return {cnpj:E.sessao.cliente,razao_social:c.razao_social,fantasia:c.fantasia||c.razao_social,vendedor:c.vendedor};
 },
 async sessaoCliente(){
  await espera(60);
  const c=E.sessao.cliente;if(!c||!E.clientes[c]||E.clientes[c].status!=='aprovado')return null;
  const x=E.clientes[c];return {cnpj:c,razao_social:x.razao_social,fantasia:x.fantasia||x.razao_social,vendedor:x.vendedor};
 },
 async sairCliente(){await espera(60);E.sessao.cliente=null;grava();return true},
 async loginAdmin(usuario,senha){
  await espera();
  const a=E.admins.find(x=>x.usuario===String(usuario||'').trim().toLowerCase());
  if(!a||a.senha!==senha)erro('Usuário ou senha incorretos.','credenciais');
  E.sessao.admin=a.usuario;grava();return {usuario:a.usuario,nome:a.nome};
 },
 async sessaoAdmin(){await espera(40);return E.sessao.admin?{usuario:E.sessao.admin}:null},
 async sairAdmin(){await espera(60);E.sessao.admin=null;grava();return true},
 async recuperarSenha(cnpj,email){
  await espera();
  return {simulado:true,mensagem:'Demonstração: nenhum e-mail foi enviado. O envio real da senha depende de integração.'};
 },

 /* ---------- Cadastro ---------- */
 async consultarCNPJ(cnpj){
  await espera();
  const c=String(cnpj||'').replace(/\D/g,'');
  const r=D().consultas_cnpj[c];
  if(!r)erro('Consulta de CNPJ depende de integração. Na demonstração, use o CNPJ fictício 11.222.333/0001-81 ou preencha os dados manualmente.','integracao');
  return {...clone(r),simulado:true};
 },
 async consultarCEP(cep){
  await espera(120);
  const r=D().consultas_cep[String(cep||'').replace(/\D/g,'')];
  if(!r)erro('Consulta de CEP depende de integração. Preencha o endereço manualmente (CEPs fictícios: 38400-000, 38400-001, 38440-000).','integracao');
  return clone(r);
 },
 async cadastrar(d){
  await espera();
  const cnpj=String(d.cnpj||'').replace(/\D/g,'');
  if(cnpj.length!==14)erro('CNPJ inválido.');
  if(E.clientes[cnpj])erro('Este CNPJ já possui cadastro. Faça login ou fale com a Souza Ribeiro.','duplicado');
  const {senha,...resto}=d;
  E.clientes[cnpj]={...resto,cnpj:undefined,senha,status:'pendente',codigo:'',pagamentos:['pix'],enderecos:[],lista:[],congelados:{},criado_em:hojeISO()};
  delete E.clientes[cnpj].cnpj;grava();
  return {status:'pendente',simulado:true};
 },
 async cliente(){await espera(80);return publicoCliente(cliSessao())},
 async salvarEnderecos(cnpj,lista){
  await espera();const c=cliSessao();
  E.clientes[c].enderecos=clone(lista||[]).slice(0,30);grava();return true;
 },

 /* ---------- Catálogo ---------- */
 async catalogo(){
  await espera(120);
  const cnpj=E.sessao.cliente&&E.clientes[E.sessao.cliente]?E.sessao.cliente:null, admin=!!E.sessao.admin;
  const preco=precosDe(cnpj);
  const unidades={};
  const produtos=E.produtos.map(p=>{
   const base=preco(p,null);
   const alt=(E.alt[p.cod]||[]).map(u=>{const x=preco(p,u);return {id:u.id,nome:u.nome,fator:u.fator,preco:x.preco,origem_preco:x.origem,etiqueta_preco:x.etiqueta}});
   if(alt.length)unidades[p.cod]=alt;
   const o={...clone(p),p:base.preco,origem_preco:base.origem,etiqueta_preco:base.etiqueta};
   if(admin)o.p_tabela=p.p; else delete o.k; // custo só para o administrador
   return o;
  });
  return {produtos,unidades_alternativas:unidades,demonstracao:true,gerado_em:new Date().toISOString()};
 },
 async configuracao(){await espera(40);return {formas:clone(D().formas_pagamento),vendedores:['Carlos (fictício)','Ana (fictícia)'],pagPadrao:['pix'],...clone(E.config)}},

 /* ---------- Minha Lista ---------- */
 async lista(){
  await espera(80);const c=cliSessao();
  return (E.clientes[c].lista||[]).map(v=>Array.isArray(v)?{cod:v[0],ultima_qtd:v[1]||0,ultima_data:v[2]||'',media_qtd:v[3]||0,qtd_sugerida:v[4]||0}:v);
 },
 async salvarMinhaLista(itens){
  await espera(80);const c=cliSessao();
  E.clientes[c].lista=(itens||[]).slice(0,300).map(i=>[i.cod,i.ultima_qtd||0,i.ultima_data||'',i.media_qtd||0,i.qtd_sugerida||0]);grava();return true;
 },

 /* ---------- Condições de pagamento ---------- */
 async pagamentos(){
  await espera(80);const c=cliSessao(),ids=E.clientes[c].pagamentos||[];
  return ids.map(id=>formas().find(f=>f.id===id)).filter(Boolean).map(f=>({id:f.id,descricao:f.nome,observacao:f.obs||''}));
 },

 /* ---------- Revisão do pedido ----------
    Recebe só as escolhas do comprador e devolve valores fictícios prontos para exibir. */
 async revisarPedido(escolhas){
  await espera();
  const cnpj=cliSessao(),cli=E.clientes[cnpj],preco=precosDe(cnpj);
  const ends=[{id:'cad',apelido:'Endereço do cadastro',cep:cli.cep,logradouro:cli.logradouro,numero:cli.numero,complemento:cli.complemento,bairro:cli.bairro,cidade:cli.cidade,uf:cli.uf},...(cli.enderecos||[])];
  const end=ends.find(x=>x.id===escolhas?.endereco_id)||ends[0];
  const avisos=[],itens=[];let bloqueado=false;
  const usoBase={};
  for(const e of (escolhas?.itens||[]).slice(0,200)){
   const p=E.produtos.find(x=>x.cod===e.cod);const q=Number(e.quantidade);
   if(!p||p.off){avisos.push({tipo:'erro',texto:'Produto '+e.cod+' indisponível na demonstração.'});bloqueado=true;continue}
   if(!(q>0))continue;
   const un=unidadesDe(p).find(u=>u.id===(e.unidade||''))||unidadesDe(p)[0];
   const pr=preco(p,un.id?un:null);
   usoBase[p.cod]=(usoBase[p.cod]||0)+q*un.fator;
   itens.push({cod:p.cod,descricao:p.t,unidade:un.id?un.nome:p.u,unidade_id:un.id,quantidade:q,
    quantidade_texto:q+' '+plural(un.id?un.nome:p.u,q),
    conversao:un.id?('1 '+un.nome.toLowerCase()+' = '+un.fator+' '+plural(p.u,un.fator)+' · total '+(q*un.fator)+' '+plural(p.u,q*un.fator)):'',
    preco_unitario:pr.preco,total:r2(pr.preco*q),origem_preco:pr.origem,etiqueta_preco:pr.etiqueta,aviso:''});
  }
  for(const it of itens){
   const p=E.produtos.find(x=>x.cod===it.cod);
   if(usoBase[p.cod]>p.s){
    it.aviso='Estoque fictício disponível: '+p.s+' '+plural(p.u,p.s)+'.';
    if(E.config.bloquear!==false){bloqueado=true;it.aviso+=' Ajuste a quantidade para enviar.'}
   }
  }
  if(!itens.length){avisos.push({tipo:'erro',texto:'Nenhum item para revisar.'});bloqueado=true}
  const subtotal=r2(itens.reduce((s,i)=>s+i.total,0));
  const conds=(cli.pagamentos||[]).map(id=>formas().find(f=>f.id===id)).filter(Boolean).map(f=>({id:f.id,descricao:f.nome,observacao:f.obs||''}));
  if(!conds.length){avisos.push({tipo:'erro',texto:'Nenhuma condição de pagamento liberada para esta empresa (simulado).'});bloqueado=true}
  avisos.unshift({tipo:'info',texto:'Valores fictícios de demonstração. Preços, conversões, totais e condições virão do serviço oficial após a integração.'});
  const id='REV-'+aleatorio(6);
  E.revisoes={[id]:{cnpj,itens,total:subtotal,endereco:end,condicoes:conds.map(c=>c.id),criado_em:Date.now(),tentativas:0}};grava();
  return {revisao_id:id,demonstracao:true,itens,
   totais:[{rotulo:'Subtotal dos produtos',valor:subtotal},{rotulo:'Frete (simulado)',valor:0}],
   total:subtotal,
   entrega:{endereco_id:end.id,endereco:clone(end),previsao:'Previsão fictícia: '+brData(somaDias(1))+' até 18h',observacao:'Prazo simulado — o prazo real depende de integração.'},
   condicoes_pagamento:conds,avisos,pode_enviar:!bloqueado,valida_ate:new Date(Date.now()+15*60000).toISOString()};
 },

 /* ---------- Envio do pedido (simulado) ---------- */
 async criarPedido(escolhas){
  await espera(500+Math.random()*400);
  const cnpj=cliSessao(),rev=E.revisoes[escolhas?.revisao_id];
  if(!rev||rev.cnpj!==cnpj)erro('A revisão expirou. Revise o pedido novamente.','revisao');
  if(!rev.condicoes.includes(escolhas.pagamento_id))erro('Selecione uma condição de pagamento disponível.','pagamento');
  rev.tentativas++;
  const cen=E.cenarioEnvio;
  if(cen==='falha'||(cen==='falha_uma_vez'&&rev.tentativas===1)){grava();erro('Falha simulada no envio do pedido. Nada foi registrado e seu carrinho foi mantido. Tente novamente.','falha_simulada')}
  E.seq++;
  const numero='DEMO-'+String(E.seq).padStart(5,'0');
  const cond=formas().find(f=>f.id===escolhas.pagamento_id);
  const ped={numero,status:'Simulado',demonstracao:true,criado_em:new Date().toISOString(),origem:escolhas.origem||'carrinho',
   pagamento:{id:cond.id,descricao:cond.nome},observacao:String(escolhas.observacao||'').slice(0,500),endereco:rev.endereco,
   previsao:'Previsão fictícia: '+brData(somaDias(1))+' até 18h',
   itens:rev.itens.map(i=>({cod:i.cod,descricao:i.descricao,un_id:i.unidade_id,unidade:i.unidade,q:i.quantidade,preco:i.preco_unitario,total:i.total})),total:rev.total};
  (E.pedidos[cnpj]=E.pedidos[cnpj]||[]).unshift(ped);
  // histórico fictício da Minha Lista
  const L=E.clientes[cnpj].lista=E.clientes[cnpj].lista||[];
  for(const i of rev.itens){const p=E.produtos.find(x=>x.cod===i.cod),f=i.unidade_id?(E.alt[i.cod]||[]).find(u=>u.id===i.unidade_id)?.fator||1:1,qb=i.quantidade*f;
   let l=L.find(x=>x[0]===i.cod);if(!l){l=[i.cod,0,'',0,0];L.push(l)}l[3]=l[1]?Math.round((l[3]+qb)/2):qb;l[1]=qb;l[2]=hojeISO();}
  delete E.revisoes[escolhas.revisao_id];grava();
  return {numero,status:'Simulado',demonstracao:true,mensagem:'Pedido simulado com sucesso',total:ped.total,pagamento:ped.pagamento.descricao,previsao:ped.previsao,endereco:ped.endereco};
 },
 async pedidos(){await espera(120);const c=cliSessao();return clone(E.pedidos[c]||[])},

 /* ---------- Administração (dados fictícios) ---------- */
 async listarClientes(){
  await espera(120);admSessao();const o={};
  for(const [cn,c] of Object.entries(E.clientes)){const {senha,congelados,...r}=c;o[cn]={...clone(r),nome:c.razao_social}}
  return o;
 },
 async salvarClienteAdmin(cnpj,dados){
  await espera();admSessao();
  const cn=String(cnpj||'').replace(/\D/g,'');const atual=E.clientes[cn]||{lista:[],congelados:{},enderecos:[],senha:'demo123',criado_em:hojeISO()};
  const {senha,cnpj:_x,nome,...r}=dados||{};
  E.clientes[cn]={...atual,...clone(r),razao_social:r.razao_social||nome||atual.razao_social};
  if(senha)E.clientes[cn].senha=senha;
  grava();return true;
 },
 async salvarProduto(cod,dados){
  await espera();admSessao();
  const p=E.produtos.find(x=>x.cod===cod);if(!p)erro('Produto não encontrado.');
  const map={t:'t',m:'m',c:'c',u:'u',p:'p',d:'d',ncm:'ncm',tagsBusca:'tagsBusca',off:'off'};
  for(const [k,v] of Object.entries(dados||{}))if(k in map&&v!==undefined)p[map[k]]=v;
  if('alt' in (dados||{})){if(dados.alt&&dados.alt.length)E.alt[cod]=clone(dados.alt);else delete E.alt[cod]}
  grava();return true;
 },
 async buscarCongeladosAdmin(cnpj){await espera(80);admSessao();return clone(E.clientes[cnpj]?.congelados||{})},
 async salvarPrecoCongelado(cnpj,cod,preco){
  await espera();admSessao();const c=E.clientes[cnpj];if(!c)erro('Cliente não encontrado.');
  c.congelados=c.congelados||{};if(preco==null)delete c.congelados[cod];else{if(!(preco>0))erro('Informe um preço válido acima de zero.');c.congelados[cod]=r2(preco)}
  grava();return clone(c.congelados);
 },
 async listaClienteAdmin(cnpj){
  await espera(100);admSessao();const c=E.clientes[cnpj];if(!c)erro('Cliente não encontrado.');
  return {configurada:(c.lista||[]).length>0,lista:(c.lista||[]).map(v=>({cod:v[0],ultima_qtd:v[1]||0,ultima_data:v[2]||null,media_qtd:v[3]||0,qtd_sugerida:v[4]||0})),congelados:clone(c.congelados||{})};
 },
 async salvarListaClienteAdmin(cnpj,itens){
  await espera();admSessao();const c=E.clientes[cnpj];if(!c)erro('Cliente não encontrado.');
  c.lista=(itens||[]).map(i=>[i.cod,i.ultima_qtd||0,i.ultima_data||'',i.media_qtd||0,i.qtd_sugerida||0]);
  c.congelados=c.congelados||{};
  for(const i of itens||[]){if(i.preco_modo==='congelar')c.congelados[i.cod]=r2(i.preco);else if(i.preco_modo==='remover')delete c.congelados[i.cod]}
  grava();return {salvo:true,itens:(itens||[]).length};
 },
 async salvarConfig(cfg){await espera();admSessao();E.config=clone(cfg||{});grava();return true},
 async salvarClips(cod,lista){await espera(80);admSessao();E.clips[cod]=(lista||[]).map(c=>({id:c.id,titulo:c.titulo}));grava();return {simulado:true}},
 async enviarVideo(){erro('Envio de vídeo para a nuvem depende de integração. Na demonstração o vídeo fica só neste navegador.','integracao')},
 async publicarFotos(){erro('Publicar fotos para todos os clientes depende de integração (armazenamento de imagens).','integracao')},
 async fotosCatalogo(){await espera(40);return {}},
 async inteligencia(){await espera();erro('Painel de inteligência comercial depende de integração com os dados reais. Indisponível na demonstração.','integracao')},
 async registrarEvento(){return true},
 async atualizarCarrinhoMonitorado(){return true},
 async adminUsuarios(){await espera(80);admSessao();return E.admins.map(a=>({usuario:a.usuario,nome:a.nome}))},
 async salvarAdminUsuario(usuario,nome,senha){
  await espera();admSessao();const u=String(usuario||'').trim().toLowerCase();
  if(!/^[a-z0-9._-]{3,30}$/.test(u))erro('Usuário: 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado.');
  const a=E.admins.find(x=>x.usuario===u);
  if(!a){if(!senha||senha.length<6)erro('Senha com pelo menos 6 caracteres.');E.admins.push({usuario:u,nome:nome||u,senha})}
  else{if(nome)a.nome=nome;if(senha){if(senha.length<6)erro('Senha com pelo menos 6 caracteres.');a.senha=senha}}
  grava();return true;
 },
 async removerAdminUsuario(usuario){
  await espera();const eu=admSessao();
  if(usuario===eu)erro('Você não pode remover o próprio usuário.');
  if(E.admins.length<=1)erro('É preciso manter pelo menos um administrador.');
  E.admins=E.admins.filter(a=>a.usuario!==usuario);grava();return true;
 },

 /* ---------- Assistente Souzinha (simulado) ---------- */
 async assistentePerguntar({message,candidates}){
  await espera(500);
  const cods=(candidates||[]).slice(0,3).map(c=>c.cod);
  return {simulado:true,reply:'Modo demonstração: as respostas do assistente com IA dependem de integração. '+(cods.length?'Separei alguns produtos fictícios que combinam com sua mensagem:':'Tente buscar pelo nome do produto no catálogo.'),product_codes:cods};
 },
 async escolaListar(){await espera(80);admSessao();return clone(E.escola)},
 async escolaSalvar(x){
  await espera();admSessao();
  if(x.id){const i=E.escola.findIndex(y=>y.id===x.id);if(i>=0)E.escola[i]={...E.escola[i],...clone(x),atualizado_em:new Date().toISOString()}}
  else E.escola.unshift({...clone(x),id:'ESC-'+aleatorio(6),criado_em:new Date().toISOString(),atualizado_em:new Date().toISOString()});
  grava();return true;
 },
 async escolaApagar(id){await espera();admSessao();E.escola=E.escola.filter(x=>x.id!==id);grava();return true},

 /* ---------- Negociações (simuladas) ---------- */
 async negociacaoCriar({origem,itens,motivo,observacao}){
  await espera();const cnpj=cliSessao();
  if(!Array.isArray(itens)||!itens.length)erro('Selecione pelo menos um produto.');
  if(E.negociacoes.filter(n=>n.cnpj===cnpj&&['solicitada','analise'].includes(n.status)).length>=10)erro('Você já tem 10 negociações aguardando resposta.');
  const n={id:'NEG-DEMO-'+aleatorio(5),cnpj,origem:origem==='lista'?'lista':'carrinho',motivo:motivo||'outro',observacao:String(observacao||'').slice(0,500),
   itens:itens.slice(0,100).map(i=>({cod:i.cod,nome:i.nome,unidade:i.unidade,un_id:i.un_id||'',fator:i.fator||1,q:i.q,preco:i.preco,desejado:i.desejado||null,oferta:null})),
   status:'solicitada',resposta:'',validade:null,congelar:false,criado_em:new Date().toISOString(),atualizado_em:new Date().toISOString()};
  E.negociacoes.unshift(n);grava();return clone(n);
 },
 async minhasNegociacoes(){await espera(100);const c=cliSessao();return E.negociacoes.filter(n=>n.cnpj===c).map(statusNeg)},
 async negociacaoAceitar(id){
  await espera();const c=cliSessao();const n=E.negociacoes.find(x=>x.id===id&&x.cnpj===c);
  if(!n||n.status!=='proposta')erro('Esta negociação não tem proposta para aceitar.');
  if(n.validade<hojeISO())erro('Esta proposta expirou. Solicite uma nova negociação.');
  n.status='aceita';n.aceito_em=new Date().toISOString();
  if(n.congelar){const cg=E.clientes[c].congelados=E.clientes[c].congelados||{};n.itens.forEach(i=>{if(i.oferta>0)cg[i.cod]=r2(i.oferta/(i.fator||1))})}
  grava();return statusNeg(n);
 },
 async negociacaoCancelar(id){
  await espera();const c=cliSessao();const n=E.negociacoes.find(x=>x.id===id&&x.cnpj===c);
  if(!n||!['solicitada','analise','proposta'].includes(n.status))erro('Não é possível cancelar esta negociação.');
  n.status='cancelada';n.atualizado_em=new Date().toISOString();grava();return statusNeg(n);
 },
 async adminNegociacoes(){
  await espera(120);admSessao();
  return E.negociacoes.map(n=>{const c=E.clientes[n.cnpj]||{};return {...statusNeg(n),cliente:{nome:c.fantasia||c.razao_social,razao:c.razao_social,codigo:c.codigo,cidade:c.cidade,uf:c.uf,vendedor:c.vendedor,whats:c.whats}}});
 },
 async adminResponderNegociacao({id,acao,ofertas,resposta,validade_dias,congelar}){
  await espera();admSessao();const n=E.negociacoes.find(x=>x.id===id);
  if(!n)erro('Negociação não encontrada.');if(['aceita','cancelada'].includes(n.status))erro('Esta negociação já foi encerrada pelo cliente.');
  if(!['analise','proposta','recusada'].includes(acao))erro('Ação inválida.');
  n.itens.forEach((i,k)=>{const v=ofertas?.[k];i.oferta=v>0?r2(v):null});
  if(acao==='proposta'&&!n.itens.some(i=>i.oferta))erro('Informe o preço oferecido em pelo menos um produto.');
  n.status=acao;n.resposta=String(resposta||'').slice(0,500);n.validade=acao==='proposta'?somaDias(Math.max(1,Math.min(90,validade_dias||7))):null;
  n.congelar=acao==='proposta'&&!!congelar;n.respondido_em=n.atualizado_em=new Date().toISOString();
  grava();const c=E.clientes[n.cnpj]||{};return {...statusNeg(n),cliente:{nome:c.fantasia||c.razao_social,codigo:c.codigo,cidade:c.cidade,uf:c.uf,whats:c.whats}};
 },

 /* ---------- Controles exclusivos da demonstração ---------- */
 demo:{
  cenariosEnvio:[{id:'sucesso',nome:'Envio com sucesso'},{id:'falha_uma_vez',nome:'Falha na 1ª tentativa'},{id:'falha',nome:'Falha sempre'}],
  cenarioEnvio(){return E.cenarioEnvio},
  definirCenarioEnvio(id){if(this.cenariosEnvio.some(c=>c.id===id)){E.cenarioEnvio=id;grava()}},
  restaurar(){localStorage.removeItem(CHAVE);carrega();grava()},
  credenciais:{cliente:{cnpj:'12.345.678/0001-90',senha:'demo123'},admin:{usuario:'demo',senha:'demo123'}}
 }
};
function statusNeg(n){const o=clone(n);if(o.status==='proposta'&&o.validade<hojeISO())o.status='expirada';return o}

window.SR_ADAPTADORES=window.SR_ADAPTADORES||{};
window.SR_ADAPTADORES.mock=Mock;
})();
