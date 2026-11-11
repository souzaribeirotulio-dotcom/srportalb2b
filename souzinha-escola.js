
(function(){
 'use strict';
 const root=document.getElementById('souzinhaEscola');if(!root)return;
 const models={
 academia:['Academia ou estúdio de treino','segmento','Quando o cliente tiver academia ou estúdio, pergunte se tem banheiros, vestiários e o fluxo de alunos. Ofereça por finalidade: papel toalha, sabonete líquido, papel higiênico, sacos de lixo, desinfetante e copos, escolhendo produtos reais do catálogo. Não indique químicos para aparelhos sem verificar instruções dos fabricantes.'],
 clinica:['Clínicas e consultórios','segmento','Pergunte quais áreas precisam de reposição. Apresente papel toalha, sabonete líquido, papel higiênico e itens de limpeza compatíveis. Nunca garanta eficácia hospitalar ou de desinfecção sem rótulo e indicação específica.'],
 restaurante:['Restaurantes e lanchonetes','segmento','Pergunte se a operação atende salão, delivery ou ambos. Sugira embalagens adequadas, guardanapos, copos descartáveis e materiais de limpeza do catálogo. Confirme capacidade e dimensões antes de indicar embalagens.'],
 escritorio:['Escritórios','segmento','Pergunte quantos colaboradores usam os banheiros e copa. Sugira papel higiênico, papel toalha, sabonete líquido, copos, sacos de lixo e produtos de limpeza encontrados no catálogo.']
 };
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 let rows=[],editing=null,busy=false,ready=false;
 const $=id=>document.getElementById(id);
 const api=()=>window.Servicos;
 function mount(){
  root.innerHTML=[
   '<div class="sz-school-head"><div><h3>🎓 Escola do Souzinha</h3><p>Ensine o Souzinha a atender, sugerir produtos e montar listas por segmento. Cada orientação ativa será usada nas próximas conversas.</p></div><button class="tool" id="szReload">↻ Atualizar</button></div>',
   '<div class="sz-school-grid"><section class="panel sz-school-form">',
    '<h3 id="szFormTitle">Novo ensinamento</h3><p class="hint">Escreva como se estivesse treinando um vendedor da Souza Ribeiro.</p>',
    '<label>Exemplo (opcional)</label><select id="szTemplate"><option value="">Escrever meu ensinamento</option><option value="academia">Academia</option><option value="clinica">Clínica</option><option value="restaurante">Restaurante</option><option value="escritorio">Escritório</option></select>',
    '<label>Assunto</label><input class="inp" id="szTitulo" maxlength="100" placeholder="Ex.: Produtos para academias">',
    '<label>Tipo de conhecimento</label><select id="szCategoria"><option value="segmento">Segmento de cliente</option><option value="produto">Conhecimento de produto</option><option value="atendimento">Como atender</option><option value="geral">Geral</option></select>',
    '<label>O que ele deve aprender?</label><textarea class="inp" id="szConteudo" rows="8" maxlength="3000" placeholder="Quando o cliente disser..., o Souzinha deve..." style="resize:vertical;min-height:150px"></textarea>',
    '<label class="sz-check"><input type="checkbox" id="szAtivo" checked> Ativo nos próximos atendimentos</label>',
    '<p class="hint">Nunca ensine senhas, preços de custo, dados pessoais ou informações sigilosas.</p>',
    '<div class="row"><button class="btn pri" id="szSalvar">💾 Salvar ensinamento</button><button class="btn sec" id="szCancelar">Limpar</button></div>',
    '<p id="szStatus" role="status" aria-live="polite"></p>',
   '</section><section class="panel sz-school-saved"><div class="sz-school-list-head"><h3>Ensinamentos</h3><span id="szCount"></span></div><div id="szSchoolList" aria-live="polite"></div></section></div>'
  ].join('');
  $('szTemplate').onchange=()=>{
   const a=models[$('szTemplate').value];if(!a)return;
   $('szTitulo').value=a[0];$('szCategoria').value=a[1];$('szConteudo').value=a[2];$('szAtivo').checked=true;
  };
  $('szSalvar').onclick=save;$('szCancelar').onclick=clear;$('szReload').onclick=load;
  $('szSchoolList').onclick=async e=>{
   const b=e.target.closest('[data-school]');if(!b)return;
   const x=rows.find(v=>v.id===b.dataset.id);if(!x)return;
   if(b.dataset.school==='edit'){
    editing=x.id;$('szFormTitle').textContent='Editar ensinamento';$('szTemplate').value='';
    $('szTitulo').value=x.titulo;$('szConteudo').value=x.conteudo;$('szCategoria').value=x.categoria;$('szAtivo').checked=x.ativo;
    root.querySelector('.sz-school-form').scrollIntoView({behavior:'smooth',block:'nearest'});
    return;
   }
   if(b.dataset.school==='toggle')await store(x,!x.ativo);
   if(b.dataset.school==='remove'&&confirm('Excluir este ensinamento?')){
    try{await api().escolaApagar(x.id);await load()}catch(err){status(err.message,true)}
   }
  };
 }
 function status(s,bad){$('szStatus').textContent=s;$('szStatus').style.color=bad?'#ff9999':'#b2e04a'}
 function clear(){editing=null;$('szFormTitle').textContent='Novo ensinamento';$('szTemplate').value='';$('szTitulo').value='';$('szConteudo').value='';$('szCategoria').value='segmento';$('szAtivo').checked=true;status('')}
 async function save(){
  const x={id:editing,categoria:$('szCategoria').value,titulo:$('szTitulo').value.trim(),conteudo:$('szConteudo').value.trim()};
  if(x.titulo.length<3||x.conteudo.length<10)return status('Preencha assunto e orientação (mínimo 10 caracteres).',true);
  await store(x,$('szAtivo').checked);
 }
 async function store(x,active){
  if(busy)return;busy=true;$('szSalvar').disabled=true;
  try{
   await api().escolaSalvar({id:x.id||null,categoria:x.categoria,titulo:x.titulo,conteudo:x.conteudo,ativo:active});
   await load();clear();status('✓ Salvo! O Souzinha usará a orientação nas próximas conversas.');
  }catch(e){status(e.message,true)}
  finally{busy=false;$('szSalvar').disabled=false}
 }
 function render(){
  $('szCount').textContent=rows.filter(x=>x.ativo).length+' ativos / '+rows.length+' no total';
  $('szSchoolList').innerHTML=rows.length?rows.map(x=>
   '<article class="sz-school-item"><div class="sz-school-item-top"><b>'+esc(x.titulo)+'</b><span class="sz-school-pill'+(x.ativo?'':' off')+'">'+(x.ativo?'Ativo':'Pausado')+'</span></div>'+
   '<small>'+esc(x.categoria)+'</small><p>'+esc(x.conteudo)+'</p><div class="row">'+
   '<button class="tool" data-school="edit" data-id="'+esc(x.id)+'">Editar</button>'+
   '<button class="tool" data-school="toggle" data-id="'+esc(x.id)+'">'+(x.ativo?'Desativar':'Ativar')+'</button>'+
   '<button class="tool" data-school="remove" data-id="'+esc(x.id)+'">Excluir</button></div></article>'
  ).join(''):'<p class="hint">Nenhum ensinamento salvo ainda.</p>';
 }
 async function load(){
  if(!ready){mount();ready=true}
  if(!document.body.classList.contains('admin'))return;
  $('szSchoolList').textContent='Carregando…';
  try{const r=await api().escolaListar();rows=Array.isArray(r)?r:[];render()}
  catch(err){$('szSchoolList').textContent='Erro ao carregar: '+err.message}
 }
 window.SouzinhaEscola={load};
})();
