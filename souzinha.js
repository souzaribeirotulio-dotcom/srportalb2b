
/* Souzinha SAC — widget leve e independente, sem chave de IA no navegador. */
(function(){
  'use strict';
  if(document.getElementById('souzinha-widget'))return;
  const root=document.createElement('div');
  root.id='souzinha-widget';
  root.innerHTML=[
    '<button type="button" class="sz-fab" aria-label="Abrir atendimento da Souzinha" aria-expanded="false" aria-controls="sz-panel">',
      '<span class="sz-tip">Precisa de ajuda? Fale com a Souzinha</span>',
      '<img src="/assets/souzinha-sac.svg" alt="" loading="lazy">',
      '<span class="sz-online" aria-hidden="true"></span>',
    '</button>',
    '<section id="sz-panel" class="sz-panel" role="dialog" aria-modal="false" aria-label="Assistente de compras Souzinha">',
      '<div class="sz-head"><span class="sz-avatar"><img src="/assets/souzinha-sac.svg" alt=""></span>',
        '<div class="sz-head-txt"><strong>Souzinha</strong><small>Assistente de compras · Souza Ribeiro</small></div>',
        '<button type="button" class="sz-close" aria-label="Fechar atendimento">×</button></div>',
      '<div class="sz-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>',
      '<div class="sz-actions" aria-label="Acesso rápido">',
        '<button type="button" class="sz-chip" data-sz="buscar">🔎 Buscar produto</button>',
        '<button type="button" class="sz-chip" data-sz="lista">📋 Minha Lista</button>',
        '<button type="button" class="sz-chip" data-sz="pedidos">🧾 Meus pedidos</button>',
        '<button type="button" class="sz-chip" data-sz="ajuda">💬 Como comprar</button>',
      '</div>',
      '<form class="sz-form"><input class="sz-input" type="text" maxlength="180" autocomplete="off" placeholder="Qual produto você procura?" aria-label="Mensagem para Souzinha"><button class="sz-send" type="submit" aria-label="Enviar mensagem">➤</button></form>',
      '<div class="sz-footnote">Assistente inicial de navegação. IA conversacional ainda não ativada.</div>',
    '</section>'
  ].join('');
  document.body.appendChild(root);
  const fab=root.querySelector('.sz-fab');
  const panel=root.querySelector('.sz-panel');
  const closeBtn=root.querySelector('.sz-close');
  const messages=root.querySelector('.sz-messages');
  const form=root.querySelector('.sz-form');
  const input=root.querySelector('.sz-input');
  let hasWelcome=false;
  let awaitingSearch=false;
  let previousFocus=null;
  const norm=s=>(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function say(value,me){
    const el=document.createElement('div');
    el.className='sz-msg'+(me?' sz-me':'');
    el.textContent=value;
    messages.appendChild(el);
    messages.scrollTop=messages.scrollHeight;
  }
  function open(){
    previousFocus=document.activeElement;
    root.classList.add('sz-open');
    document.body.classList.add('sz-chat-open');
    fab.setAttribute('aria-expanded','true');
    panel.setAttribute('aria-modal',window.matchMedia('(max-width:700px)').matches?'true':'false');
    if(!hasWelcome){
      say('Olá! 👋 Sou a Souzinha, sua assistente de compras da Souza Ribeiro. Posso ajudar você a encontrar produtos, abrir a Minha Lista e consultar seus pedidos.');
      hasWelcome=true;
    }
    input.focus({preventScroll:true});
  }
  function close(){
    root.classList.remove('sz-open');
    document.body.classList.remove('sz-chat-open');
    fab.setAttribute('aria-expanded','false');
    (previousFocus && previousFocus.isConnected?previousFocus:fab).focus({preventScroll:true});
  }
  function navigate(section){
    close();
    if(typeof window.go==='function')window.go(section);
    else{
      const btn=document.querySelector('[data-v="'+section+'"]');
      if(btn)btn.click();
    }
  }
  function search(query){
    const q=document.getElementById('q');
    if(!q){say('A busca do catálogo está indisponível neste momento.');return;}
    navigate('cat');
    q.value=query;
    q.dispatchEvent(new Event('input',{bubbles:true}));
    q.dispatchEvent(new Event('change',{bubbles:true}));
    say('Pronto! Pesquisei "'+query+'" no catálogo. Você pode conferir os resultados na tela.');
    awaitingSearch=false;
  }
  function action(name){
    if(name==='buscar'){
      awaitingSearch=true;
      say('Qual produto você está procurando? Pode escrever o nome, por exemplo: copo para açaí, marmita ou papel interfolha.');
      input.focus({preventScroll:true});
    }else if(name==='lista'){
      say('Vou abrir sua Minha Lista. Caso ainda não tenha entrado, o portal pode solicitar seu login.');
      navigate('lista');
    }else if(name==='pedidos'){
      say('Vou abrir a área de pedidos da sua empresa.');
      navigate('ped');
    }else if(name==='ajuda'){
      say('Para comprar: entre com o cadastro da sua empresa, encontre seus produtos, escolha as quantidades e finalize no carrinho ou pela Minha Lista. Você pode usar os atalhos aqui embaixo.');
    }
  }
  function handle(message){
    const raw=message.trim().slice(0,180);
    if(!raw)return;
    say(raw,true);
    const n=norm(raw);
    if(awaitingSearch){search(raw);return;}
    if(/\b(lista|minha lista|recomprar)\b/.test(n)){action('lista');return;}
    if(/\b(pedidos|meus pedidos|acompanhar pedido)\b/.test(n)){action('pedidos');return;}
    if(/\b(como comprar|ajuda|cadastro|login|entrar)\b/.test(n)){action('ajuda');return;}
    if(/\b(preco|negociar|desconto|gerencia)\b/.test(n)){
      say('As condições de preço dependem do seu cadastro e das negociações da empresa. A negociação automática ainda não está disponível aqui no chat.');
      return;
    }
    search(raw);
  }
  fab.addEventListener('click',open);
  closeBtn.addEventListener('click',close);
  root.querySelectorAll('[data-sz]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.sz)));
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const val=input.value;
    input.value='';
    handle(val);
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.classList.contains('sz-open'))close();});
  document.addEventListener('focusin',e=>{
    if(!root.classList.contains('sz-open')||!window.matchMedia('(max-width:700px)').matches)return;
    if(!panel.contains(e.target))input.focus({preventScroll:true});
  });
})();
