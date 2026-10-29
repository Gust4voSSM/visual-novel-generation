import { DbConnection } from './module_bindings';
/* ---------- art generators (placeholders for uploads / AI output) ---------- */
const enc=s=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
function emotionKind(name,desc){const t=norm(name+' '+desc);
  if(/feliz|alegr|sorri|content|ri(nd|s)/.test(t))return'happy';
  if(/trist|chor|melanc|desanim/.test(t))return'sad';
  if(/surpre|choc|espant|assust/.test(t))return'surprised';
  if(/brav|raiv|irrit|zang|furi/.test(t))return'angry';
  if(/vergonh|timid|corad|envergonh/.test(t))return'shy';
  if(/pensat|duvid|descon|curios/.test(t))return'thinking';
  return'neutral';}
function face(k){const s='#2b2230';
  const eyes={neutral:`<circle cx="82" cy="110" r="5" fill="${s}"/><circle cx="118" cy="110" r="5" fill="${s}"/>`,
    happy:`<path d="M75 112q7-9 14 0M111 112q7-9 14 0" stroke="${s}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    sad:`<circle cx="82" cy="113" r="4" fill="${s}"/><circle cx="118" cy="113" r="4" fill="${s}"/><path d="M72 100l16-5M128 100l-16-5" stroke="${s}" stroke-width="3" stroke-linecap="round"/>`,
    surprised:`<circle cx="82" cy="108" r="7" fill="#fff" stroke="${s}" stroke-width="3"/><circle cx="118" cy="108" r="7" fill="#fff" stroke="${s}" stroke-width="3"/><circle cx="82" cy="108" r="3" fill="${s}"/><circle cx="118" cy="108" r="3" fill="${s}"/>`,
    angry:`<circle cx="83" cy="112" r="4" fill="${s}"/><circle cx="117" cy="112" r="4" fill="${s}"/><path d="M72 97l18 8M128 97l-18 8" stroke="${s}" stroke-width="4" stroke-linecap="round"/>`,
    shy:`<path d="M76 111q6-6 12 0M112 111q6-6 12 0" stroke="${s}" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse cx="72" cy="126" rx="10" ry="5" fill="#ec7b8f" opacity=".6"/><ellipse cx="128" cy="126" rx="10" ry="5" fill="#ec7b8f" opacity=".6"/>`,
    thinking:`<circle cx="84" cy="110" r="4.5" fill="${s}"/><circle cx="120" cy="110" r="4.5" fill="${s}"/><path d="M110 97l18-3" stroke="${s}" stroke-width="3" stroke-linecap="round"/>`};
  const mouth={neutral:`<path d="M89 137h22" stroke="${s}" stroke-width="3.5" stroke-linecap="round"/>`,
    happy:`<path d="M84 131q16 18 32 0z" fill="#8c2f3c" stroke="${s}" stroke-width="2.5" stroke-linejoin="round"/>`,
    sad:`<path d="M87 142q13-11 26 0" stroke="${s}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    surprised:`<ellipse cx="100" cy="139" rx="7" ry="9" fill="#8c2f3c" stroke="${s}" stroke-width="2.5"/>`,
    angry:`<path d="M87 141q13-7 26 0" stroke="${s}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    shy:`<path d="M92 136q8 5 16 0" stroke="${s}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    thinking:`<path d="M90 139q8-4 20 1" stroke="${s}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`};
  return eyes[k]+mouth[k];}
function spriteArt(look,emotionName,emotionDesc){const k=emotionKind(emotionName,emotionDesc),{hair,skin,outfit,style}=look;
  const longHair=style==='long'?`<path d="M42 100c-4 60 6 95 22 110h72c16-15 26-50 22-110z" fill="${hair}"/>`:'';
  const beard=style==='beard'?`<path d="M56 120c4 40 22 52 44 52s40-12 44-52c-10 18-26 22-44 22s-34-4-44-22z" fill="${hair}"/>`:'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">${longHair}<ellipse cx="100" cy="92" rx="60" ry="64" fill="${hair}"/><path d="M28 300c0-70 30-102 72-102s72 32 72 102z" fill="${outfit}"/><path d="M70 205l30 30 30-30" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="5"/><rect x="88" y="150" width="24" height="52" rx="8" fill="${skin}"/><ellipse cx="100" cy="108" rx="47" ry="55" fill="${skin}"/>${beard}<path d="M50 98c2-48 98-48 100 0-20-22-80-22-100 0z" fill="${hair}"/>${face(k)}</svg>`;
  return enc(svg);}
function lookFrom(desc,color){const t=norm(desc);
  const hair=/loir|dourad/.test(t)?'#e7c262':/ruiv|laranj/.test(t)?'#c4532b':/pret|negro/.test(t)?'#25202a':/castanh|marrom/.test(t)?'#6b4130':/azul/.test(t)?'#3e6fd3':/rosa/.test(t)?'#e07aa8':/branc|grisalh|cinza/.test(t)?'#d8d5cf':/verde/.test(t)?'#3e9a6c':/roxo|lilas/.test(t)?'#7c4cc6':'#4b3a33';
  const skin=/pele (escura|negra)|negr[oa]/.test(t)?'#8a5a3c':/moren/.test(t)?'#c08a62':/palid|clar/.test(t)?'#f6dcc6':'#f0c6a3';
  const style=/barb/.test(t)?'beard':/(cabelo )?(longo|comprid)/.test(t)?'long':'short';
  return{hair,skin,outfit:color||'#5a6478',style};}
function bgArt(name,desc){const t=norm(name+' '+desc);let body='';
  const sky=(a,b)=>`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/>`;
  if(/farol|noite|estrel/.test(t)&&!/cidade|rua/.test(t)){
    body=sky('#0d1633','#2c3466');for(let i=0;i<60;i++){const x=(i*271)%1600,y=(i*137)%420;body+=`<circle cx="${x}" cy="${y}" r="${1+(i%3)}" fill="#fff" opacity="${.4+(i%5)/10}"/>`}
    body+=`<circle cx="1320" cy="150" r="60" fill="#f4edd0"/><path d="M0 700q400-60 800 0t800 0v200H0z" fill="#162048"/><path d="M0 760q300-30 700 10t900-10v140H0z" fill="#101635"/><path d="M640 760l40-460h80l40 460z" fill="#e9e4dc"/><path d="M660 520h120M655 600h130M650 680h140" stroke="#c0423a" stroke-width="34"/><rect x="668" y="250" width="104" height="60" fill="#2b3550"/><path d="M650 250h140l-70-60z" fill="#c0423a"/><rect x="690" y="262" width="60" height="38" fill="#ffe8a3"/><path d="M720 280L1600 120v330z" fill="#ffe8a3" opacity=".14"/>`;}
  else if(/praia|mar|litoral|oceano/.test(t)){
    body=sky('#ffb27a','#ffd9a0')+`<circle cx="800" cy="520" r="120" fill="#ffefb8"/><rect y="520" width="1600" height="200" fill="#3f86b8"/><path d="M0 560h1600M0 610h1600" stroke="#ffd9a0" stroke-opacity=".35" stroke-width="6" stroke-dasharray="80 60"/><path d="M0 700q400-50 800-10t800-20v230H0z" fill="#efd3a1"/><path d="M1240 720c10-150 30-260 70-330" stroke="#5b3a24" stroke-width="22" fill="none"/><path d="M1310 390c-80-20-160 10-200 60M1310 390c60-50 150-50 200 0M1310 390c-30-60-110-90-180-70M1310 390c50-70 130-80 180-50" stroke="#2f6b3f" stroke-width="26" fill="none" stroke-linecap="round"/>`;}
  else if(/cafe|bar|restaur|cozinh|padar/.test(t)){
    body=`<rect width="1600" height="900" fill="#d9b48a"/><rect y="600" width="1600" height="300" fill="#7a4e2f"/><path d="M0 600h1600" stroke="#5b3720" stroke-width="10"/><rect x="980" y="140" width="460" height="320" rx="10" fill="#9fd0e6" stroke="#6b4428" stroke-width="22"/><path d="M1210 140v320M980 300h460" stroke="#6b4428" stroke-width="14"/><rect x="140" y="170" width="520" height="22" fill="#6b4428"/><rect x="140" y="330" width="520" height="22" fill="#6b4428"/>`+[0,1,2,3,4].map(i=>`<rect x="${170+i*95}" y="${100}" width="50" height="70" rx="8" fill="${['#c35d3c','#e0b04c','#4d8b74','#ce7b8a','#5d77b8'][i]}"/><rect x="${175+i*95}" y="${270}" width="40" height="60" rx="18" fill="#f2eee6"/>`).join('')+`<rect x="80" y="560" width="1440" height="60" rx="8" fill="#5b3720"/>`;}
  else if(/sala de aula|escola|aula|classe/.test(t)){
    body=`<rect width="1600" height="900" fill="#e8e2cf"/><rect y="640" width="1600" height="260" fill="#9a7b56"/><rect x="380" y="120" width="840" height="380" rx="8" fill="#2f5a46" stroke="#8a6a44" stroke-width="18"/><path d="M460 220h300M460 280h420M460 340h220" stroke="#e8f0e6" stroke-width="8" stroke-linecap="round" opacity=".7"/>`+[0,1,2].map(i=>`<rect x="${120+i*520}" y="660" width="320" height="30" rx="6" fill="#c9a374"/><rect x="${140+i*520}" y="690" width="16" height="150" fill="#6b4c2f"/><rect x="${404+i*520}" y="690" width="16" height="150" fill="#6b4c2f"/>`).join('')+`<rect x="1320" y="130" width="200" height="300" fill="#a9d7ee" stroke="#8a6a44" stroke-width="14"/>`;}
  else if(/floresta|bosque|parque|mata|jardim/.test(t)){
    body=sky('#a7e0d0','#e8f5d8')+`<path d="M0 640q400-80 800-20t800-30v310H0z" fill="#6bab5e"/>`+[...Array(9)].map((_,i)=>{const x=60+i*190,h=380+(i%3)*80;return`<rect x="${x+40}" y="${700-h*0.35}" width="34" height="${h*0.4}" fill="#5b3b25"/><circle cx="${x+57}" cy="${700-h*0.55}" r="${110+(i%2)*20}" fill="${i%2?'#2f7a49':'#3c8f55'}"/>`}).join('')+[...Array(14)].map((_,i)=>`<circle cx="${(i*233)%1600}" cy="${300+(i*97)%300}" r="5" fill="#fff6a8" opacity=".85"/>`).join('');}
  else if(/cidade|rua|urban|predio/.test(t)){
    const night=/noite/.test(t);body=sky(night?'#141a3a':'#8fc3ef',night?'#4a3b6e':'#dbeefa');
    body+=[...Array(10)].map((_,i)=>{const w=130+(i%3)*30,h=260+((i*73)%280),x=i*165-20;let win='';for(let r=0;r<Math.floor(h/60);r++)for(let c=0;c<3;c++)win+=`<rect x="${x+18+c*(w-36)/3}" y="${700-h+20+r*60}" width="22" height="30" fill="${night&&(r+c+i)%3?'#ffd97a':'#3a4466'}" opacity="${night?1:.5}"/>`;return`<rect x="${x}" y="${700-h}" width="${w}" height="${h}" fill="${night?'#232a4a':'#7b8aa6'}"/>${win}`}).join('')+`<rect y="700" width="1600" height="200" fill="${night?'#1a1d2b':'#565d6c'}"/><path d="M0 800h1600" stroke="#f3d35b" stroke-width="10" stroke-dasharray="90 70"/>`;}
  else if(/quarto|casa|interior|sala|aconcheg/.test(t)){
    body=`<rect width="1600" height="900" fill="#e9d6c3"/><rect y="650" width="1600" height="250" fill="#a8775a"/><rect x="980" y="150" width="380" height="300" rx="10" fill="#273a68" stroke="#fff" stroke-width="18"/><circle cx="1260" cy="230" r="34" fill="#f4edd0"/><rect x="120" y="470" width="620" height="200" rx="30" fill="#7f5fa8"/><rect x="120" y="430" width="200" height="90" rx="30" fill="#efe7f6"/><rect x="820" y="520" width="120" height="150" fill="#6b4c37"/><path d="M860 520l20-120 20 120" fill="#f4d47c"/>`;}
  else{body=sky('#6d7fc9','#e9b8c9')+`<path d="M0 620q300-140 700-40t900-60v380H0z" fill="#5d6fa8"/><path d="M0 720q500-80 900 0t700-20v200H0z" fill="#3f4f86"/>`;}
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">${body}</svg>`);}

/* ---------- state ---------- */
// Os ids do elenco de exemplo precisam ser iguais em todos os navegadores (o elenco
// fica no cliente neste spike); depois do seed, ids novos são aleatórios.
let seq=1,seeding=true;const uid=p=>seeding?p+(seq++).toString(36):p+crypto.randomUUID().replace(/-/g,'').slice(0,12);
const SLOTS={1:[50],2:[30,70],3:[20,50,80],4:[14,38,62,86],5:[10,30,50,70,90],6:[8,25,42,58,75,92]};
const MAXCH=6;
function makeChar(name,desc,color,emotions,src){const look=lookFrom(desc,color||null);
  return{id:uid('c'),name,desc,color:color||'',source:src||'upload',sprites:emotions.map(([n,d])=>({id:uid('sp'),name:n,desc:d,img:spriteArt(look,n,d)}))};}
function makeBg(name,desc,src){return{id:uid('b'),name,desc,source:src||'upload',img:bgArt(name,desc)};}

const lia=makeChar('Lia','Jovem de 19 anos, cabelo ruivo curto, sardas, volta à vila onde cresceu.','#d9467a',[['Neutro','expressão calma, boca reta'],['Feliz','sorriso aberto, olhos fechados de alegria'],['Surpresa','olhos arregalados, boca aberta'],['Triste','sobrancelhas caídas, olhar baixo']]);
const davi=makeChar('Davi','Amigo de infância de Lia, cabelo preto, pescador, desconfiado de forasteiros.','',[['Neutro','rosto sério'],['Feliz','sorriso largo'],['Bravo','sobrancelhas franzidas, mandíbula tensa']]);
const cida=makeChar('Dona Cida','Dona do café da vila, cabelo grisalho, conhece todos os segredos do lugar.','#e0b25c',[['Neutro','olhar atento'],['Feliz','sorriso acolhedor']]);
const bPraia=makeBg('Praia ao entardecer','Praia da vila com sol baixo, mar calmo e um coqueiro.');
const bFarol=makeBg('Farol à noite','Farol listrado de vermelho sobre a pedra, céu estrelado.');
const bCafe=makeBg('Café da vila','Interior do café de Dona Cida, prateleiras de potes e janela para o mar.');
const S=(id,title,x,y,bg,chars,kind,speaker,text,extra)=>Object.assign({id,title,x,y,bg,chars,kind,speaker,text,choices:[],next:null},extra||{});
let state={
  title:'O Farol de Itamaracá',start:'s1',
  characters:[lia,davi,cida],backgrounds:[bPraia,bFarol,bCafe],
  scenes:[
    S('s1','Chegada',0,40,bPraia.id,[{c:lia.id,s:lia.sprites[0].id}],'narration',null,'O ônibus deixa Lia na beira da praia. Ao longe, o farol apagado parece observar a vila.',{next:'s2'}),
    S('s2','Reencontro',360,0,bPraia.id,[{c:lia.id,s:lia.sprites[1].id},{c:davi.id,s:davi.sprites[1].id}],'dialogue',davi.id,'Lia! Achei que você nunca mais ia voltar pra cá.',{choices:[{id:'ch1',label:'Ir ao café da Dona Cida',target:'s3'},{id:'ch2',label:'Perguntar sobre o farol',target:'s4'}]}),
    S('s3','No café',720,-90,bCafe.id,[{c:lia.id,s:lia.sprites[0].id},{c:cida.id,s:cida.sprites[1].id},{c:davi.id,s:davi.sprites[0].id}],'dialogue',cida.id,'Senta, menina. O café ainda é o mesmo, mas a vila mudou muito desde que você foi embora.',{choices:[{id:'ch3',label:'Contar por que voltou',target:'s5'},{id:'ch4',label:'Pedir um bolo de rolo',target:null}]}),
    S('s4','O farol',720,290,bFarol.id,[{c:lia.id,s:lia.sprites[2].id},{c:davi.id,s:davi.sprites[2].id}],'dialogue',lia.id,'Ele está apagado desde quando? Ninguém nunca me contou isso.',{next:'s5'}),
    S('s5','A luz',1080,110,bFarol.id,[],'narration',null,'A luz do farol pisca uma única vez, mesmo sem ninguém lá dentro.'),
  ]};
const market={
  characters:[
    {author:'@marina.ilustra',...makeChar('Yumi','Estudante tímida, cabelo azul longo, uniforme escolar.','#3e6fd3',[['Neutro','olhar tranquilo'],['Feliz','sorriso tímido'],['Surpresa','olhos arregalados'],['Envergonhada','bochechas coradas, olhar desviado']],'marketplace')},
    {author:'@caio.vn',...makeChar('Capitão Breno','Pirata veterano, barba castanha, chapéu e casaco.','#e8925a',[['Neutro','postura firme'],['Feliz','gargalhada'],['Bravo','olhar furioso']],'marketplace')},
    {author:'@estudio.lume',...makeChar('Professor Átila','Professor de história, cabelo grisalho, óculos imaginários, fala devagar.','#7fd1a3',[['Neutro','expressão serena'],['Pensativo','olhar distante, desconfiado'],['Surpreso','espanto contido']],'marketplace')},
  ],
  backgrounds:[
    {author:'@estudio.lume',...makeBg('Sala de aula','Sala de aula com quadro verde e carteiras de madeira.','marketplace')},
    {author:'@marina.ilustra',...makeBg('Floresta encantada','Floresta com vaga-lumes e árvores altas.','marketplace')},
    {author:'@caio.vn',...makeBg('Rua da cidade à noite','Rua com prédios iluminados à noite.','marketplace')},
    {author:'@bea.pixel',...makeBg('Quarto aconchegante','Quarto com sofá, abajur e janela para a lua.','marketplace')},
  ]};
seeding=false;
// A história de exemplo vai para o servidor só no "reiniciar demo"; o grafo local
// começa vazio e é preenchido pela assinatura.
const SEED={title:state.title,start:state.start,scenes:state.scenes};
state.scenes=[];state.title='';state.start='';


/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scene=id=>state.scenes.find(s=>s.id===id);
const charById=id=>state.characters.find(c=>c.id===id);
const bgById=id=>state.backgrounds.find(b=>b.id===id);
const spriteOf=(c,sid)=>c&&c.sprites.find(s=>s.id===sid);
const SPARK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/></svg>';
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function toast(msg,kind){const t=document.createElement('div');t.className='toast'+(kind?' '+kind:'');t.innerHTML=(kind==='ai'?SPARK.replace('<svg','<svg style="width:13px;height:13px;flex:none;margin-top:2px"'):'')+'<span>'+esc(msg)+'</span>';$('#toasts').appendChild(t);setTimeout(()=>{t.style.transition='opacity .25s,transform .25s';t.style.opacity='0';t.style.transform='translateY(6px)';setTimeout(()=>t.remove(),260);},kind==='err'?4200:2600);}
const outs=s=>s.choices.length?s.choices.map(c=>c.target).filter(Boolean):(s.next?[s.next]:[]);
function reaches(from,to){const seen=new Set,st=[from];while(st.length){const x=st.pop();if(x===to)return true;if(seen.has(x))continue;seen.add(x);const s=scene(x);if(s)st.push(...outs(s));}return false;}
const isFinal=s=>!s.choices.length&&!s.next;
const edgeKey=(sid,ch)=>sid+'|'+(ch||'');
const targetOf=(s,ch)=>ch?s.choices.find(c=>c.id===ch)?.target:s.next;
function setTarget(s,ch,t){if(ch)s.choices.find(c=>c.id===ch).target=t;else s.next=t;}
function edges(){const out=[];state.scenes.forEach(s=>{if(s.choices.length)s.choices.forEach(c=>{if(c.target&&scene(c.target))out.push({key:edgeKey(s.id,c.id),from:s.id,ch:c.id,to:c.target});});else if(s.next&&scene(s.next))out.push({key:edgeKey(s.id,''),from:s.id,ch:'',to:s.next});});return out;}

/* ---------- undo ---------- */
// Desfazer por usuário: cada passo guarda a foto de antes e as entidades que
// ESTE usuário mudou depois dela (preenchidas pelo syncNow). Desfazer restaura só
// essas entidades, contra o estado atual, e manda as operações ao servidor.
const undoS=[],redoS=[];
const snapStr=()=>JSON.stringify(state);
let collector=new Set;           // entidades tocadas desde o último pushUndo
let typingTouched=null;          // durante digitação, o passo só nasce no change
function pushUndo(str,touched){const e={flat:flatOf(JSON.parse(str??snapStr())),touched:touched||new Set};undoS.push(e);collector=e.touched;if(undoS.length>200)undoS.shift();redoS.length=0;syncUndo();}
function restoreStep(e){const cur=flatOf(state);const inv={flat:cloneFlat(cur),touched:e.touched};
  for(const k of e.touched){const[t,id]=k.split(/:(.*)/);
    if(t==='s'){const v=e.flat.scenes.get(id);v?cur.scenes.set(id,{...v}):cur.scenes.delete(id);}
    else if(t==='c'){const v=e.flat.choices.get(id);v?cur.choices.set(id,{...v}):cur.choices.delete(id);}
    else if(k==='title')cur.title=e.flat.title;else if(k==='start')cur.start=e.flat.start;}
  writeFlat(cur);collector=new Set;return inv;}
function undo(){if(!undoS.length)return;redoS.push(restoreStep(undoS.pop()));afterRestore();}
function redo(){if(!redoS.length)return;undoS.push(restoreStep(redoS.pop()));afterRestore();}
function afterRestore(){for(const id of gens.keys()){const s=scene(id);if(s)s.aiStatus='';}gens.clear();lit.clear();fades.clear();tweens.clear();selected.clear();renderAll();}
function syncUndo(){$('#btnUndo').disabled=!undoS.length;$('#btnRedo').disabled=!redoS.length;}

/* ---------- validation ---------- */
function warnings(){const w=[];const reach=new Set;if(scene(state.start)){const st=[state.start];while(st.length){const x=st.pop();if(reach.has(x))continue;reach.add(x);const s=scene(x);if(s)st.push(...outs(s));}}
  let finalReach=false;
  state.scenes.forEach(s=>{if(!reach.has(s.id))w.push({id:s.id,t:`“${s.title}” não é alcançável a partir da cena inicial`});
    s.choices.forEach(c=>{if(!c.target)w.push({id:s.id,t:`Ação “${c.label||'sem texto'}” em “${s.title}” não tem destino`});});
    if(!s.text.trim()&&!gens.has(s.id))w.push({id:s.id,t:`“${s.title}” está sem texto`});
    if(reach.has(s.id)&&isFinal(s))finalReach=true;});
  if(!finalReach)w.push({id:null,t:'Nenhum final alcançável'});
  return{list:w,reach};}

/* ---------- viewport ---------- */
const view={x:40,y:90,z:1};
const canvas=$('#canvas'),world=$('#world'),nodesEl=$('#nodes'),wiresEl=$('#wires'),dragEl=$('#dragwires'),fxEl=$('#fx'),cutsEl=$('#cuts');
function applyView(){world.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.z})`;const g=$('#grid');g.style.backgroundSize=`${24*view.z}px ${24*view.z}px`;g.style.backgroundPosition=`${view.x}px ${view.y}px`;$('#btnZoomReset').textContent=Math.round(view.z*100)+'%';dirty=true;}
function toWorld(cx,cy){const r=canvas.getBoundingClientRect();return{x:(cx-r.left-view.x)/view.z,y:(cy-r.top-view.y)/view.z};}
function zoomAt(z2,cx,cy){const r=canvas.getBoundingClientRect();const px=cx-r.left,py=cy-r.top;const z=Math.max(.3,Math.min(2,z2));const wx=(px-view.x)/view.z,wy=(py-view.y)/view.z;view.z=z;view.x=px-wx*z;view.y=py-wy*z;applyView();}
function nodeH(id){const el=nodeEl(id);return el?el.offsetHeight:460;}
const nodeEl=id=>nodesEl.querySelector(`.node[data-id="${id}"]`);
function fitView(){if(!state.scenes.length)return;const r=canvas.getBoundingClientRect();let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;state.scenes.forEach(s=>{x0=Math.min(x0,s.x);y0=Math.min(y0,s.y);x1=Math.max(x1,s.x+300);y1=Math.max(y1,s.y+nodeH(s.id));});
  const top=70,pad=40;const z=Math.min(1,Math.max(.5,Math.min((r.width-pad*2)/(x1-x0),(r.height-top-pad-60)/(y1-y0))));view.z=z;
  view.x=(x1-x0)*z<=r.width-pad*2?(r.width-(x1-x0)*z)/2-x0*z:pad-x0*z;view.y=(y1-y0)*z<=r.height-top-pad-60?top+(r.height-top-60-(y1-y0)*z)/2-y0*z:top-y0*z;applyView();}

/* ---------- live fx state ---------- */
let dirty=true;
const lit=new Set;            // AI wires while generating (hue cycling)
const fades=new Map;          // key -> t0 : violet -> amber
const tweens=new Map;         // key -> {fx,fy,t0,ai,noland,to}
let ghosts=[];                // retracting wires
const gens=new Map;           // sceneId -> {full,i,comp,key,labelFor}
const fresh=new Map;          // id -> {t0,cls}
const freshRows=new Map;      // rowId -> t0
const reveal=new Map;         // sceneId -> t0
const selected=new Set;
let expanded=null,animUntil=0;
const remoteDrag=new Map;       // sceneId -> {x,y,tx,ty,color,name,conn,seen,done}: nós que outra pessoa arrasta
const pushOff=new Map;const dispY=s=>{const r=remoteDrag.get(s.id);return r?r.y:s.y+(pushOff.get(s.id)||0);};
const dispX=s=>{const r=remoteDrag.get(s.id);return r?r.x:s.x;};
function applyPush(prevTops){const E=expanded&&scene(expanded);const el=E&&nodeEl(E.id);pushOff.clear();
  if(E&&el){const hE=el.offsetHeight;const aff=state.scenes.filter(n=>n.id!==E.id&&n.x<E.x+300&&n.x+300>E.x&&n.y>E.y);
    if(aff.length){const minY=Math.min(...aff.map(n=>n.y));const d=Math.max(0,E.y+hE+24-minY);if(d>0)aff.forEach(n=>pushOff.set(n.id,d));}}
  state.scenes.forEach(s=>{const n=nodeEl(s.id);if(!n||(drag&&drag.type==='move'&&drag.moved&&drag.orig.some(o=>o.s.id===s.id)))return;const t=dispY(s);const cur=prevTops?prevTops.get(s.id):parseFloat(getComputedStyle(n).top);n.getAnimations().forEach(a=>{if(a.__push)a.cancel();});n.style.top=t+'px';
    if(!reduced&&cur!=null&&!isNaN(cur)&&Math.abs(cur-t)>.5){const a=n.animate([{top:cur+'px'},{top:t+'px'}],{duration:360,easing:'cubic-bezier(.2,1,.3,1)'});a.__push=true;animUntil=Math.max(animUntil,performance.now()+400);}});
  dirty=true;}
function setExpanded(id){if(expanded===id)return;expanded=id;refresh();}
let drag=null,hover=null,shiftOn=false,altOn=false,spaceDown=false,openMenu=null;
// toque: um dedo arrasta a tela, dois dedos dão zoom, segurar parado faz o papel do Shift (IA)
const touchUI=matchMedia('(pointer:coarse)').matches,HOLD_MS=450;
const touches=new Map;let pinch=null,holdTimer=0,heldAdd=false,selectMode=false;
function startPinch(){const[a,b]=[...touches.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,mx:(a.x+b.x)/2,my:(a.y+b.y)/2,v:{...view}};drag={type:'pinch'};canvas.classList.add('panning');}
function doPinch(){const[a,b]=[...touches.values()];const d=Math.hypot(a.x-b.x,a.y-b.y)||1,mx=(a.x+b.x)/2,my=(a.y+b.y)/2,r=canvas.getBoundingClientRect(),v=pinch.v;
  const z=Math.max(.3,Math.min(2,v.z*d/pinch.d)),wx=(pinch.mx-r.left-v.x)/v.z,wy=(pinch.my-r.top-v.y)/v.z;view.z=z;view.x=mx-r.left-wx*z;view.y=my-r.top-wy*z;applyView();}
function flyTo(x,y,z){const v0={...view},t0=performance.now();const step=t=>{const k=Math.min(1,(t-t0)/260),q=1-Math.pow(1-k,3);view.x=v0.x+(x-v0.x)*q;view.y=v0.y+(y-v0.y)*q;view.z=v0.z+(z-v0.z)*q;applyView();if(k<1)requestAnimationFrame(step);};requestAnimationFrame(step);}
function focusScene(id){const s=scene(id);if(s)focusAt(s.x,dispY(s));}
function focusAt(x,y){const r=canvas.getBoundingClientRect();const z=Math.max(view.z,Math.min(1,(r.width-24)/300));const top=$('.hud').getBoundingClientRect().bottom-r.top+16;flyTo((r.width-300*z)/2-x*z,top-y*z,z);}
const geom=new Map;           // key -> {a,b}
function ago(t0){return Math.round(performance.now()-t0);}

/* ---------- node rendering ---------- */
const REMOTE_GEN={full:'',i:0};
const genOf=s=>gens.get(s.id)||(s.aiStatus==='generating'?REMOTE_GEN:null);
function stageMini(s){const bg=bgById(s.bg);const n=s.chars.length,pos=SLOTS[n]||[];const w=n>3?Math.max(18,100/n*1.25):30;const g=genOf(s);
  if(g)return`<div class="stage-mini"><div class="gen-veil"><span class="skel" style="width:72%"></span><span class="skel" style="width:54%"></span><span class="skel" style="width:63%"></span></div></div>`;
  const rv=reveal.has(s.id)?ago(reveal.get(s.id)):null;const rvOn=rv!==null&&rv<1600;
  let h=bg?`<img class="bgimg" src="${bg.img}" alt="" ${rvOn?`style="animation-delay:-${rv}ms"`:''}>`:`<div class="nobg">sem background</div>`;
  s.chars.forEach((cc,i)=>{const c=charById(cc.c),sp=spriteOf(c,cc.s);if(!sp)return;h+=`<img class="pchar" style="left:${pos[i]}%;max-width:${w}%;${rvOn?`animation-delay:${180+i*110-rv}ms`:''}" src="${sp.img}" alt="">`;});
  return`<div class="stage-mini${rvOn?' reveal':''}">${h}</div>`;}
function rowFresh(id){const t=freshRows.get(id);if(t==null)return'';const a=ago(t);if(a>700){freshRows.delete(id);return'';}return` fresh" style="animation-delay:-${a}ms`;}
function nodeHTML(s,ws,reach,lnk,incoming){const g=genOf(s);const isStart=state.start===s.id;const exp=expanded===s.id&&!g;const avail=state.characters.filter(c=>!s.chars.some(x=>x.c===c.id));
  const cls=['node'];if(exp)cls.push('exp');if(s.ai)cls.push('ai');if(selected.has(s.id))cls.push('sel');if(!reach.has(s.id)&&!g)cls.push('unreach');
  const rd=remoteDrag.get(s.id);if(rd)cls.push('rdrag');
  const lkTitle=lockOf('scene:'+s.id+':title'),lkText=lockOf('scene:'+s.id+':text');
  let style=`left:${dispX(s)}px;top:${dispY(s)}px${rd?`;--rc:${rd.color}`:''}`;const f=fresh.get(s.id);
  if(g){cls.push('gen');if(f)style+=`;animation-delay:-${ago(f.t0)}ms,${700-ago(f.t0)}ms`;}
  else if(f){const a=ago(f.t0);if(a<800){cls.push(f.cls);style+=`;animation-delay:-${a}ms`;}else fresh.delete(s.id);}
  const head=`<div class="nhead" data-drag><span class="port in${incoming.has(s.id)?' linked':''}" aria-hidden="true"></span><input class="ntitle${lkTitle?' locked':''}" data-act="title" value="${esc(s.title)}" aria-label="Título da cena" ${g?'disabled':''}${lkTitle?` readonly title="${esc(lkTitle.name)} está escrevendo…" style="--lc:${lkTitle.color}"`:''}>${isStart?'<span class="tag start">início</span>':''}${s.ai?`<span class="tag ai">${SPARK}IA</span>`:''}${isFinal(s)&&!g?'<span class="tag final">final</span>':''}${!g&&s.aiStatus==='failed'&&!s.text?'<span class="tag warn" title="A IA não conseguiu montar esta cena">IA falhou</span><button class="addbtn ai" data-act="retry" title="Pedir a cena de novo à IA" style="padding:2px 7px;font-size:11px">tentar de novo</button>':''}${ws.has(s.id)?'<span class="tag warn" title="Há avisos nesta cena">!</span>':''}${g?'':`<button class="iconbtn sm ntoggle" data-act="toggle" aria-expanded="${exp}" aria-label="${exp?'Recolher':'Expandir'} cena" title="${exp?'Recolher':'Expandir para editar'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>`}<button class="iconbtn sm" data-act="menu" aria-label="Mais opções da cena"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button></div>`;
  if(g){return`<div class="${cls.join(' ')}" data-id="${s.id}" style="${style}">${head}<div class="sec">${stageMini(s)}</div><div class="sec"><div class="ntext typing" data-typing>${esc(g.full.slice(0,g.i))}<span class="caret"></span></div></div><div class="orow"><span class="skel" style="width:38%"></span><span class="skel" style="width:26%"></span></div><div class="nfoot"><span class="hintsm">montando a cena…</span></div></div>`;}
  const nOpts=s.choices.length;
  if(!exp){
    const spk=s.kind==='dialogue'?charById(s.speaker):null;
    const sum=s.text?`${spk?`<span class="who" style="color:${spk.color||'var(--text)'}">${esc(spk.name)}</span>`:''}<span class="${spk?'':'narr'}">${esc(s.text)}</span>`:'<span class="none">sem texto · clique para editar</span>';
    const opts=s.choices.map((ch,i)=>{const pc=portCls(s.id,ch.id,lnk);return`<div class="orow c${ch.gen?' optgen':''}${ch.target?'':' draft'}${rowFresh('opt:'+ch.id)}"><span class="onum">${i+1}</span><span class="olabel" data-act="clabel" data-i="${i}">${ch.label?esc(ch.label):'<i class="none">sem texto</i>'}</span>${ch.target?'':'<span class="tag warn">sem destino</span>'}<button class="port out ${pc}${ch.target?'':' draft'}" data-out="${s.id}" data-ch="${ch.id}" aria-label="Saída da ação ${esc(ch.label)}${ch.target?'':', sem destino'}"></button></div>`;}).join('');
    const single=!nOpts?`<div class="orow c"><span class="nextlabel">${s.next?'continuar → '+esc(scene(s.next)?.title||''):'continuar'}</span><button class="port out ${portCls(s.id,'',lnk)}" data-out="${s.id}" data-ch="" aria-label="Saída única de ${esc(s.title)}"></button></div>`:'';
    return`<div class="${cls.join(' ')}" data-id="${s.id}" style="${style}">${head}<div class="mid"><div class="sec">${stageMini(s)}${lkText?lockBadge(lkText):''}<div class="sum">${sum}</div></div></div>${opts}${single}</div>`;}
  const full=s.chars.length>=MAXCH;
  const cast=s.chars.map((cc,i)=>{const c=charById(cc.c);if(!c)return'';const sp=spriteOf(c,cc.s);return`<div class="cast-row${rowFresh('cast:'+s.id+':'+c.id)}"><img src="${sp?sp.img:''}" alt=""><span class="cast-name" style="color:${c.color||'inherit'}" title="${esc(c.name)}">${esc(c.name)}<span class="slot">${i+1}</span></span><select class="msel" data-act="sprite" data-i="${i}" aria-label="Sprite de ${esc(c.name)}">${c.sprites.map(p=>`<option value="${p.id}"${p.id===cc.s?' selected':''}>${esc(p.name)}</option>`).join('')}</select><button class="iconbtn sm" data-act="rmchar" data-i="${i}" aria-label="Tirar ${esc(c.name)} da cena"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></button></div>`;}).join('');
  const add=`<select class="msel" data-act="addchar" ${full||!avail.length?'disabled':''} aria-label="Adicionar personagem"><option value="">${full?'limite de 6 personagens':avail.length?`+ personagem  (${s.chars.length}/6)`:'todo o elenco já está na cena'}</option>${avail.map(c=>`<option value="${c.id}"${c.sprites.length?'':' disabled'}>${esc(c.name)}${c.sprites.length?'':' · sem sprites'}</option>`).join('')}</select>`;
  const speaker=s.kind==='dialogue'?`<div class="speaker"><span class="lbl">quem fala</span><select class="msel" data-act="speaker" aria-label="Quem fala">${s.chars.map(cc=>{const c=charById(cc.c);if(!c)return'';return`<option value="${c.id}"${c.id===s.speaker?' selected':''}>${esc(c.name)}</option>`}).join('')}</select></div>`:'';
  const opts=s.choices.map((ch,i)=>{const pc=portCls(s.id,ch.id,lnk);const og=ch.gen?' optgen':'';const lk=lockOf('choice:'+ch.id+':label');return`<div class="orow${og}${ch.target?'':' draft'}${rowFresh('opt:'+ch.id)}"><span class="onum">${i+1}</span><input class="oin${lk?' locked':''}" data-act="clabel" data-i="${i}" value="${esc(ch.label)}" placeholder="Texto da ação" aria-label="Ação do jogador"${lk?` readonly title="${esc(lk.name)} está escrevendo…" style="--lc:${lk.color}"`:''}><button class="iconbtn sm" data-act="rmchoice" data-i="${i}" aria-label="Remover ação"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></button><button class="port out ${pc}${ch.target?'':' draft'}" data-out="${s.id}" data-ch="${ch.id}" aria-label="Saída da ação ${esc(ch.label)}${ch.target?'':', sem destino'}"></button></div>`;}).join('');
  const single=!nOpts?`<div class="orow"><span class="nextlabel">${s.next?'continuar → '+esc(scene(s.next)?.title||''):'continuar'}</span><button class="port out ${portCls(s.id,'',lnk)}" data-out="${s.id}" data-ch="" aria-label="Saída única de ${esc(s.title)}"></button></div>`:'';
  return`<div class="${cls.join(' ')}" data-id="${s.id}" style="${style}">${head}
  <div class="mid"><div class="sec">${stageMini(s)}<select class="msel" data-act="bg" aria-label="Background"><option value="">sem background</option>${state.backgrounds.map(b=>`<option value="${b.id}"${b.id===s.bg?' selected':''}>${esc(b.name)}</option>`).join('')}</select></div>
  <div class="sec grow-in">${cast}${add}</div>
  <div class="sec grow-in"><div class="seg" role="group" aria-label="Tipo de texto"><button data-act="kind" data-v="narration" aria-pressed="${s.kind==='narration'}">Narração</button><button data-act="kind" data-v="dialogue" aria-pressed="${s.kind==='dialogue'}">Fala</button></div>${speaker}${lkText?lockBadge(lkText):''}<textarea class="ntext${s.kind==='narration'?' narr':''}${lkText?' locked':''}" data-act="text" placeholder="${s.kind==='narration'?'Descreva o ambiente…':'O que o personagem diz…'}" aria-label="Texto da cena"${lkText?` readonly style="--lc:${lkText.color}"`:''}>${esc(s.text)}</textarea></div></div>
  ${opts}${single}
  <div class="nfoot grow-in"><button class="addbtn" data-act="addchoice" data-hover="add">+ ação</button><button class="addbtn ai" data-act="complete" title="Completar o texto com IA">IA: completar</button><span class="hintsm">${nOpts?nOpts+(nOpts>1?' ações':' ação'):'saída única'}</span></div></div>`;}
function portCls(sid,ch,lnk){let c=lnk.has(edgeKey(sid,ch))?'linked':'';if(!drag&&hover&&hover.sid===sid&&hover.ch===ch&&shiftOn)c+=' primed';if(drag&&drag.type==='wire'&&drag.s.id===sid&&drag.ch===ch)c+=drag.ai?' charging':' active';return c;}
function renderNodes(){const{list,reach}=warnings();const ws=new Set(list.map(w=>w.id).filter(Boolean));const es=edges();const lnk=new Set(es.map(e=>e.key));const inc=new Set(es.map(e=>e.to));
  const focus=document.activeElement;let keep=null;if(focus&&nodesEl.contains(focus)){const n=focus.closest('.node');keep={id:n?.dataset.id,act:focus.dataset.act,i:focus.dataset.i,s:focus.selectionStart,e:focus.selectionEnd};}
  const prevTops=new Map;nodesEl.querySelectorAll('.node').forEach(n=>prevTops.set(n.dataset.id,parseFloat(getComputedStyle(n).top)));
  const prevMid=new Map;nodesEl.querySelectorAll('.node').forEach(n=>{const m=n.querySelector('.mid');if(m)prevMid.set(n.dataset.id,{h:m.offsetHeight,exp:n.classList.contains('exp')});});
  nodesEl.innerHTML=state.scenes.map(s=>nodeHTML(s,ws,reach,lnk,inc)).join('');
  applyPush(prevTops);
  if(!reduced)prevMid.forEach((v,id)=>{const n=nodeEl(id);const m=n&&n.querySelector('.mid');if(!m)return;const ex=n.classList.contains('exp');if(ex===v.exp)return;const h=m.offsetHeight;m.animate([{height:v.h+'px'},{height:h+'px'}],{duration:360,easing:'cubic-bezier(.2,1,.3,1)'});n.classList.add(ex?'opening':'closing');setTimeout(()=>n.classList.remove('opening','closing'),380);animUntil=performance.now()+400;});
  if(keep&&keep.id){const n=nodeEl(keep.id);const el=n&&n.querySelector(`[data-act="${keep.act}"]${keep.i!=null?`[data-i="${keep.i}"]`:''}`);if(el){el.focus({preventScroll:true});try{if(keep.s!=null)el.setSelectionRange(keep.s,keep.e);}catch(_){}}}
  renderStats(list);renderSelbar();dirty=true;}
function refresh(){renderNodes();scheduleSync();}
function renderStats(list){const nA=state.scenes.reduce((a,s)=>a+s.choices.length,0);$('#stats').innerHTML=`${state.scenes.length} cenas · ${nA} ações · ${list.length?`<button class="warnlink" id="warnBtn">${list.length} aviso${list.length>1?'s':''}</button>`:'sem avisos'}`;
  const b=$('#warnBtn');if(b)b.onclick=e=>{e.stopPropagation();const h=$('#warnHost');if(h.innerHTML){h.innerHTML='';return;}h.innerHTML=`<div class="warnpop"><h3>Avisos de qualidade</h3><div class="hint">Não bloqueiam o salvamento; a publicação pede confirmação.</div><ul>${list.map(w=>`<li>${esc(w.t)}</li>`).join('')}</ul></div>`;};}
function renderSelbar(){const h=$('#selbarHost');const n=[...selected].filter(id=>scene(id)).length;if(!n||(touchUI&&!selectMode&&n<2)){h.innerHTML='';delete h.dataset.n;return;}if(h.dataset.n==String(n)&&h.innerHTML)return;h.dataset.n=n;h.innerHTML=`<div class="selbar"><span>${n} ${n===1?'selecionada':'selecionadas'}</span><button class="btn sm" id="selDel">Excluir</button><button class="btn sm" id="selClear">Limpar</button></div>`;$('#selDel').onclick=()=>deleteScenes([...selected]);$('#selClear').onclick=()=>{selected.clear();syncSel();};}
function syncSel(){if(!selected.size)selectMode=false;nodesEl.querySelectorAll('.node').forEach(n=>n.classList.toggle('sel',selected.has(n.dataset.id)));renderSelbar();}
function renderAll(){if(document.activeElement!==$('#storyTitle'))$('#storyTitle').value=state.title;renderNodes();renderRail();syncUndo();scheduleSync();}

/* ---------- geometry ---------- */
function centerOf(el){const r=el.getBoundingClientRect();return toWorld(r.left+r.width/2,r.top+r.height/2);}
function outPos(sid,ch){const el=nodesEl.querySelector(`.port.out[data-out="${sid}"][data-ch="${ch}"]`);return el?centerOf(el):null;}
function inPos(id){const el=nodesEl.querySelector(`.node[data-id="${id}"] .port.in`);return el?centerOf(el):null;}
const ctrl=(a,b)=>Math.max(50,Math.abs(b.x-a.x)*.5);
const curve=(a,b)=>{const dx=ctrl(a,b),f=v=>v.toFixed(1);return`M ${f(a.x)} ${f(a.y)} C ${f(a.x+dx)} ${f(a.y)}, ${f(b.x-dx)} ${f(b.y)}, ${f(b.x)} ${f(b.y)}`;};
function bez(a,b,t){const dx=ctrl(a,b),u=1-t;return{x:u*u*u*a.x+3*u*u*t*(a.x+dx)+3*u*t*t*(b.x-dx)+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*a.y+3*u*t*t*b.y+t*t*t*b.y};}
function poly(a,b,s0,s1){if(s1-s0<.004)return'';let d='';for(let i=0;i<=14;i++){const p=bez(a,b,s0+(s1-s0)*i/14);d+=(i?' L ':'M ')+p.x.toFixed(1)+' '+p.y.toFixed(1);}return d;}

/* ---------- wire drawing (every frame while something moves) ---------- */
function edgeStyle(key,now){const tw=tweens.get(key);const fd=fades.get(key);
  if(lit.has(key)){const c='hsl('+Math.round(255+45*Math.sin(now/320))+', 85%, 70%)';return{stroke:c,sw:3.5,dash:'16 8',off:(-(now*.06)%24).toFixed(1),gs:c,gw:12,go:.55};}
  const t0=fd!=null?fd:(tw&&tw.ai?tw.t0:null);
  if(t0!=null){const x=Math.min(1,(now-t0)/800),k=1-Math.pow(1-x,3);const mix=(a,b)=>Math.round(a+(b-a)*k);const c=`rgb(${mix(167,242)},${mix(139,165)},${mix(250,65)})`;const gap=8*(1-k);return{stroke:c,sw:(3.5-k).toFixed(2),dash:gap<.3?'none':'16 '+gap.toFixed(2),off:(-(now*.06)%24).toFixed(1),gs:c,gw:(12-9.5*k).toFixed(1),go:(.55*(1-k)).toFixed(2)};}
  return{stroke:'#f2a541',sw:2.5,dash:'none',off:0,gs:'#f2a541',gw:2,go:0};}
const cutBtns=new Map;
function drawWires(now){let h='';geom.clear();const es=edges();const live=new Set;
  for(const e of es){const a=outPos(e.from,e.ch),pf=inPos(e.to);if(!a||!pf)continue;let b=pf;const tw=tweens.get(e.key);
    if(tw&&tw.fx!=null){const p=Math.min(1,(now-tw.t0)/420);const s=1+3*Math.pow(p-1,3)+2*Math.pow(p-1,2);b={x:tw.fx+(pf.x-tw.fx)*s,y:tw.fy+(pf.y-tw.fy)*s};}
    const st=edgeStyle(e.key,now);const d=curve(a,b);
    h+=`<path class="eglow" d="${d}" style="stroke:${st.gs};stroke-width:${st.gw}px;opacity:${st.go}"/><path class="wpath" d="${d}" style="stroke:${st.stroke};stroke-width:${st.sw}px;stroke-dasharray:${st.dash};stroke-dashoffset:${st.off};opacity:.9"/>`;
    geom.set(e.key,{a,b:pf});live.add(e.key);
    let btn=cutBtns.get(e.key);if(!btn){btn=document.createElement('button');btn.className='cutbtn';btn.setAttribute('aria-label','Cortar ligação');btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>';btn.dataset.key=e.key;btn.addEventListener('pointerdown',ev=>ev.stopPropagation());btn.onclick=ev=>{ev.stopPropagation();cutEdge(btn.dataset.key);};cutsEl.appendChild(btn);cutBtns.set(e.key,btn);}
    const m=bez(a,b,.5);btn.style.left=m.x.toFixed(1)+'px';btn.style.top=m.y.toFixed(1)+'px';btn.hidden=lit.has(e.key)||(tw&&tw.fx!=null&&now-tw.t0<420);}
  for(const[k,b]of cutBtns)if(!live.has(k)){b.remove();cutBtns.delete(k);}
  ghosts=ghosts.filter(g=>now-g.t0<520);
  for(const g of ghosts){const p=Math.min(1,(now-g.t0)/480),k=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;let d1='',d2='';
    if(g.kind==='cut'){d1=poly(g.a,g.b,0,g.t*(1-k));d2=poly(g.a,g.b,g.t+(1-g.t)*k,1);}else if(g.kind==='start')d1=poly(g.a,g.b,0,1-k);else d1=poly(g.a,g.b,k,1);
    const sw=(2.5*(1-.5*k)).toFixed(2),o=(.9*(1-.7*k*k)).toFixed(2);if(d1)h+=`<path class="wpath" d="${d1}" style="stroke:${g.col};stroke-width:${sw}px;opacity:${o}"/>`;if(d2)h+=`<path class="wpath" d="${d2}" style="stroke:${g.col};stroke-width:${sw}px;opacity:${o}"/>`;}
  h+=draftWires();
  wiresEl.innerHTML=h;
  // landed glow
  nodesEl.querySelectorAll('.node.landed,.node.landed-plain').forEach(n=>{const t=[...tweens.values()].find(x=>x.to===n.dataset.id&&!x.noland&&now-x.t0>280);if(!t)n.classList.remove('landed','landed-plain');});
  for(const t of tweens.values()){if(t.noland||now-t.t0<=280)continue;const n=nodeEl(t.to);if(n)n.classList.add(t.ai?'landed':'landed-plain');}
  drawDrag(now);}
let phase=0;
function drawDrag(now){let h='';let ghostHTML='',badgeHTML='';
  if(drag&&drag.type==='wire'){const a=outPos(drag.s.id,drag.ch);if(a){const tgt=drag.over?nodeEl(drag.over):null;const b=tgt?inPos(drag.over):{x:drag.mx,y:drag.my};const d=curve(a,b);const sh=drag.ai;
      if(sh){h+=`<path class="eglow" d="${d}" style="stroke:hsl(${Math.round(255+60*Math.sin(now/230))},85%,72%);stroke-width:12px;opacity:.55"/>`;}
      h+=`<path class="wpath" d="${d}" style="stroke:${sh?`hsl(${Math.round(255+60*Math.sin(now/230))},85%,72%)`:(drag.bad?'#ff6b6b':'#f2a541')};stroke-width:${sh?3.5:2.5}px;stroke-dasharray:${sh?'16 8':'5 7'};stroke-dashoffset:${sh?(-(now*.08)%24).toFixed(1):0};opacity:${sh?1:.85}"/>`;
      if(sh){phase=(phase+.009)%1;for(let k=0;k<20;k++){const t=((k/20)+phase)%1,p=bez(a,b,t),wob=Math.sin(t*24+k)*5,s=2+4*Math.sin(t*Math.PI)*(.55+.45*Math.sin(k*1.7));h+=`<circle class="spark" cx="${p.x.toFixed(1)}" cy="${(p.y+wob).toFixed(1)}" r="${(Math.max(2,s)/2).toFixed(1)}" opacity="${(.25+.75*Math.sin(t*Math.PI)).toFixed(2)}"/>`;}}
      if(!tgt&&drag.moved)ghostHTML=`<div class="ghost${sh?' shift':''}" style="left:${Math.round(drag.mx)}px;top:${Math.round(drag.my-20)}px"><span class="ghostlabel">${SPARK}${sh?'A IA vai montar esta cena':'Nova cena'}</span><span class="skel" style="width:100%;height:64px;border-radius:7px"></span><span class="skel" style="width:80%"></span><span class="skel" style="width:86%"></span><span class="skel" style="width:54%"></span></div>`;
      const txt=tgt?(drag.bad?'Fecharia um ciclo':`Ligar a “${scene(drag.over).title}”`):(sh?'Solte para gerar':touchUI?'Solte para criar · para IA, segure antes de arrastar':'Solte para criar · segure Shift para IA');
      if(drag.moved)badgeHTML=`<div class="badge${drag.bad?' bad':sh&&!tgt?' shift':''}" style="left:${Math.round(drag.mx+18)}px;top:${Math.round(drag.my-52)}px">${sh&&!tgt?SPARK:''}${esc(txt)}</div>`;}}
  else if(drag&&drag.type==='cut'){if(Math.hypot(drag.x2-drag.x1,drag.y2-drag.y1)>4)h+=`<path d="M ${drag.x1.toFixed(1)} ${drag.y1.toFixed(1)} L ${drag.x2.toFixed(1)} ${drag.y2.toFixed(1)}" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round"/>`;}
  else if(drag&&drag.type==='box'){const x=Math.min(drag.x1,drag.x2),y=Math.min(drag.y1,drag.y2),w=Math.abs(drag.x2-drag.x1),hh=Math.abs(drag.y2-drag.y1);if(w+hh>3)ghostHTML=`<div class="marquee" style="left:${x}px;top:${y}px;width:${w}px;height:${hh}px"></div>`;}
  else if(hover){const p=hover.ch==='add'?null:outPos(hover.sid,hover.ch);const el=hover.el;if(el&&el.isConnected){const c=centerOf(el);const isAdd=hover.ch==='add';const txt=isAdd?(shiftOn?'Clique: a IA escreve a ação':'Clique · segure Shift para IA'):(shiftOn?'Clique ou arraste: a IA monta a cena':'Clique ou arraste · Shift = IA');badgeHTML=`<div class="badge${shiftOn?' shift':''}" style="left:${Math.round(isAdd?c.x-30:c.x+22)}px;top:${Math.round(isAdd?c.y-50:c.y-14)}px">${shiftOn?SPARK:''}${txt}</div>`;}}
  dragEl.innerHTML=h;
  const tmp=fxEl.querySelector('.dyn')||Object.assign(document.createElement('div'),{className:'dyn'});if(!tmp.isConnected)fxEl.appendChild(tmp);tmp.innerHTML=ghostHTML+badgeHTML;
  $('#wash').classList.toggle('on',!!((drag&&drag.type==='wire'&&drag.ai)||(!drag&&hover&&shiftOn)));}
function loop(now){stepRemote(now);autoPan();const anim=dirty||now<animUntil||lit.size||fades.size||tweens.size||ghosts.length||drag||hover||remoteDrag.size;
  for(const[k,t]of fades)if(now-t>900)fades.delete(k);for(const[k,t]of tweens)if(now-t.t0>1100)tweens.delete(k);
  if(anim){drawWires(now);dirty=false;}requestAnimationFrame(loop);}

function ensureVisible(id){const el=nodeEl(id),sc=scene(id);if(!el||!sc||drag&&drag.type==='pan')return;const cr=canvas.getBoundingClientRect();const r={left:cr.left,top:cr.top,right:cr.right,bottom:cr.bottom};const L=cr.left+view.x+sc.x*view.z,T=cr.top+view.y+sc.y*view.z;const b={left:L,top:T,right:L+300*view.z,bottom:T+el.offsetHeight*view.z};const m=40;let dx=0,dy=0;
  if(b.right>r.right-m)dx=r.right-m-b.right;if(b.left+dx<r.left+m)dx=r.left+m-b.left;if(b.top<r.top+70)dy=r.top+70-b.top;else if(b.top>r.bottom-200)dy=r.bottom-200-b.top;
  if(!dx&&!dy)return;const x0=view.x,y0=view.y,t0=performance.now();const step=now=>{const k=Math.min(1,(now-t0)/450),e=1-Math.pow(1-k,3);view.x=x0+dx*e;view.y=y0+dy*e;applyView();if(k<1)requestAnimationFrame(step);};if(reduced){view.x=x0+dx;view.y=y0+dy;applyView();}else requestAnimationFrame(step);}
/* ---------- bursts / shake ---------- */
function burst(x,y,kind){const b=document.createElement('div');b.className='burst '+kind;b.style.left=Math.round(x)+'px';b.style.top=Math.round(y)+'px';let h='<span class="ring"></span><span class="ring r2"></span>';const ai=kind.includes('ai'),mini=kind.includes('mini');const k=ai?(mini?6:16):0;
  for(let i=0;i<k;i++){const a=mini?Math.round(i*360/k+Math.random()*30):Math.round(i*360/k+Math.random()*18);const d=mini?Math.round(260+Math.random()*140):Math.round(420+Math.random()*380);const w=mini?Math.round(5+Math.random()*5):Math.round(10+Math.random()*20);h+=`<span class="shardwrap" style="transform:rotate(${a}deg)"><span class="shard" style="width:${w}px;animation-duration:${d}ms"></span></span>`;}
  b.innerHTML=h;fxEl.appendChild(b);setTimeout(()=>b.remove(),1000);}
function shake(){if(reduced)return;const s=$('#shaker');s.classList.remove('shake');void s.offsetWidth;s.classList.add('shake');setTimeout(()=>s.classList.remove('shake'),400);}
function nodeShake(id){const el=nodeEl(id);if(el){el.classList.remove('err');void el.offsetWidth;el.classList.add('err');}}

/* ---------- create / connect / cut ---------- */
function blankScene(x,y){return{id:uid('s'),title:'Nova cena',x:Math.round(x),y:Math.round(y),bg:null,chars:[],kind:'narration',speaker:null,text:'',choices:[],next:null};}
function freeSpot(sp,k=1){let x=sp.x+120,y=sp.y-20;const clash=(cx,cy)=>state.scenes.some(n=>cx<n.x+330&&cx+340*(k-1)+330>n.x&&cy<dispY(n)+nodeH(n.id)+30&&cy+480>dispY(n));for(let i=0;i<40;i++){if(!clash(x,y))break;y+=90;if(i%8===7){x+=340;y=sp.y-20;}}return{x,y};}
function createScene(src,ch,at,ai,opts={}){const sp=outPos(src.id,ch)||{x:src.x+300,y:src.y+200};const click=!at;const p=at||freeSpot(sp);
  if(!opts.skipUndo)pushUndo();const ns=blankScene(p.x,click?p.y:p.y-20);state.scenes.push(ns);const prevT=targetOf(src,ch);setTarget(src,ch,ns.id);const key=edgeKey(src.id,ch);
  fresh.set(ns.id,{t0:performance.now(),cls:ai?'pop-ai':'pop'});
  if(click)tweens.set(key,{fx:sp.x,fy:sp.y,t0:performance.now(),ai:false,noland:true,to:ns.id});
  burst(click?ns.x:p.x,click?ns.y+20:p.y,ai?'ai':'plain');
  if(!ai)expanded=ns.id;
  if(ai){ns.ai=true;ns.title='Gerando…';gens.set(ns.id,{full:'',i:0,comp:null,key,labelCh:opts.labelCh||null});lit.add(key);shake();}
  refresh();ensureVisible(ns.id);if(ai)runSuggest(ns.id,src.id,ch);return ns;}
// A cena já existe para todos com ai = 'generating'; o worker só devolve o conteúdo.
function runSuggest(id,srcId,chId){const g=gens.get(id);
  aiJob('scene',{sourceSceneId:srcId,choiceId:chId||'',instruction:'',context:aiContext()}).then(o=>{
    if(gens.get(id)!==g)return; // apagada ou desfeita enquanto gerava
    const chars=o.characters.filter(x=>spriteOf(charById(x.character_id),x.sprite_id)).map(x=>({c:x.character_id,s:x.sprite_id}));
    const speaker=o.text_kind==='dialogue'&&chars.some(x=>x.c===o.speaker_character_id)?o.speaker_character_id:null;
    g.comp={title:o.title,bg:bgById(o.background_id)?o.background_id:null,chars,kind:speaker?'dialogue':'narration',speaker,text:o.body};g.full=o.body;
    const src=scene(srcId),ch=g.labelCh&&src&&src.choices.find(c=>c.id===g.labelCh);if(ch&&ch.gen)ch.gen.full=o.action_label;
  }).catch(err=>{if(gens.get(id)!==g)return;genFailed(id,err);});} // catch: um erro ao aplicar também não pode deixar a cena presa
function genFailed(id,err){const g=gens.get(id);gens.delete(id);const s=scene(id);if(g){lit.delete(g.key);}
  for(const t of state.scenes)for(const c of t.choices)if(c.gen&&!c.gen.full)delete c.gen; // a ação fica sem texto: o aviso pede um rótulo
  if(s){s.aiStatus='failed';s.ai=false;s.title='Nova cena';}refresh();toast('A IA não conseguiu montar a cena: '+aiMessage(err),'err');}
function retryGen(s){let src=null,chId='';for(const t of state.scenes){if(t.next===s.id){src=t;break;}const c=t.choices.find(c=>c.target===s.id);if(c){src=t;chId=c.id;break;}}
  if(!src){toast('Ligue uma saída a esta cena para a IA saber de onde continuar.','err');return;}
  const key=edgeKey(src.id,chId);const ch=chId&&src.choices.find(c=>c.id===chId);if(ch&&!ch.label)ch.gen={full:'',i:0}; // a IA escreve também a ação
  s.aiStatus='';s.ai=true;s.title='Gerando…';gens.set(s.id,{full:'',i:0,comp:null,key,labelCh:ch&&ch.gen?chId:null});lit.add(key);refresh();runSuggest(s.id,src.id,chId);}
function finishGen(id){const g=gens.get(id);const s=scene(id);gens.delete(id);if(!s)return;s.aiStatus='';const c=g.comp;Object.assign(s,{title:c.title,bg:c.bg,chars:c.chars,kind:c.kind,speaker:c.speaker,text:c.text});
  lit.delete(g.key);fades.set(g.key,performance.now());reveal.set(id,performance.now());setTimeout(()=>reveal.delete(id),1700);
  const n=performance.now();s.chars.forEach(cc=>freshRows.set('cast:'+id+':'+cc.c,n));
  s.ai=true;refresh();const pi=inPos(id);if(pi)burst(pi.x,pi.y,'ai mini');setTimeout(()=>{const t=scene(id);if(t){t.ai=false;refresh();}},2600);}
function tryConnect(src,ch,toId,at,ai){if(toId===src.id||reaches(toId,src.id)){toast('Essa ligação fecharia um ciclo. A história não volta a cenas anteriores.','err');nodeShake(toId);const ip=inPos(toId);if(ip)burst(ip.x,ip.y,'red');return false;}
  pushUndo();setTarget(src,ch,toId);const key=edgeKey(src.id,ch);tweens.set(key,{fx:at.x,fy:at.y,t0:performance.now(),ai,to:toId});refresh();setTimeout(()=>{const tp=inPos(toId);if(tp)burst(tp.x,tp.y,ai?'ai mini':'plain');},300);return true;}
function cutEdge(key){const gm=geom.get(key);const[sid,ch]=key.split('|');const s=scene(sid);if(!s)return;pushUndo();setTarget(s,ch,null);if(gm){ghosts.push({kind:'cut',a:gm.a,b:gm.b,t:.5,col:'#f2a541',t0:performance.now()});const m=bez(gm.a,gm.b,.5);burst(m.x,m.y,'plain');}refresh();}
function segHit(x1,y1,x2,y2,x3,y3,x4,y4){const d=(x2-x1)*(y4-y3)-(y2-y1)*(x4-x3);if(Math.abs(d)<1e-9)return false;const t=((x3-x1)*(y4-y3)-(y3-y1)*(x4-x3))/d,u=((x3-x1)*(y2-y1)-(y3-y1)*(x2-x1))/d;return t>=0&&t<=1&&u>=0&&u<=1;}
function applyCut(d){const dead=[];for(const[key,g]of geom){let prev=bez(g.a,g.b,0);for(let i=1;i<=32;i++){const cur=bez(g.a,g.b,i/32);if(segHit(d.x1,d.y1,d.x2,d.y2,prev.x,prev.y,cur.x,cur.y)){dead.push({key,at:cur,t:i/32,g});break;}prev=cur;}}
  if(!dead.length)return;pushUndo();dead.forEach(x=>{const[sid,ch]=x.key.split('|');setTarget(scene(sid),ch,null);ghosts.push({kind:'cut',a:x.g.a,b:x.g.b,t:x.t,col:'#f2a541',t0:performance.now()});burst(x.at.x,x.at.y,'plain');});refresh();toast(dead.length>1?`${dead.length} fios cortados`:'Fio cortado');}
function deleteScenes(ids){ids=ids.filter(id=>{if(id===state.start){toast('A cena inicial não pode ser excluída.','err');nodeShake(id);return false;}return true;});if(!ids.length)return;
  for(const[key,g]of geom){const[sid]=key.split('|');const s=scene(sid);const to=s&&targetOf(s,key.split('|')[1]);if(ids.includes(to))ghosts.push({kind:'start',a:g.a,b:g.b,col:'#f2a541',t0:performance.now()});else if(ids.includes(sid))ghosts.push({kind:'end',a:g.a,b:g.b,col:'#f2a541',t0:performance.now()});}
  pushUndo();state.scenes=state.scenes.filter(s=>!ids.includes(s.id));state.scenes.forEach(s=>{if(ids.includes(s.next))s.next=null;s.choices.forEach(c=>{if(ids.includes(c.target))c.target=null;});});ids.forEach(i=>{selected.delete(i);gens.delete(i);});refresh();toast(ids.length>1?`${ids.length} cenas excluídas`:'Cena excluída');}

/* ---------- IA (procedures e fila do worker) ---------- */
const pick=a=>a[Math.floor(Math.random()*a.length)];
// Imagens geradas: image_key relativo à base pública (R2 no deploy; /placeholders no modo mock).
const IMG_BASE=import.meta.env.VITE_IMAGE_BASE||'/';
const imgUrl=k=>/^(data:|https?:)/.test(k)?k:IMG_BASE+k;
// No spike o elenco e os backgrounds ficam no cliente, então vão como contexto para a IA.
function aiContext(){return{characters:state.characters.map(c=>({id:c.id,name:c.name,desc:c.desc,sprites:c.sprites.map(s=>({id:s.id,name:s.name,desc:s.desc}))})),backgrounds:state.backgrounds.map(b=>({id:b.id,name:b.name,desc:b.desc}))};}
const AI_ERRS={AI_DISABLED:'a IA está desabilitada neste servidor.',RATE_LIMITED:'limite de pedidos de IA por minuto atingido. Tente de novo em instantes.',AI_PROVIDER_ERROR:'o provedor de IA falhou. Tente de novo.',TIMEOUT:'o provedor demorou demais. Tente de novo.',AI_INVALID_OUTPUT:'a resposta da IA não respeitou as regras da cena.',WORKER_RESTARTED:'o serviço de IA reiniciou no meio do pedido. Tente de novo.',NOT_FOUND:'a cena de origem não existe mais.',INVALID:'pedido inválido.',OFFLINE:'sem conexão com o servidor.'};
function aiMessage(err){const m=String(err&&err.message||err);const c=Object.keys(AI_ERRS).find(k=>m.includes(k));return c?AI_ERRS[c]:m.slice(0,120);}
// Procedures devolvem {ok, ...} ou {error}.
async function callProc(name,args){if(!connected)throw new Error('OFFLINE');const r=JSON.parse(await conn.procedures[name](args));if(r.error)throw new Error(r.error);return r;}
// Pedidos ao worker: resolve quando o ai_job termina (chega pela view my_ai_job).
const jobWaiters=new Map;
function requestAi(kind,input){const id=uid('j');return conn.reducers.requestAi({id,kind,input:JSON.stringify(input)}).then(()=>id);}
function waitJob(id){const j=conn.db.myAiJob.id.find(id);if(j&&(j.status==='done'||j.status==='failed'))return Promise.resolve(j);return new Promise(res=>jobWaiters.set(id,res));}
// Pedido de texto ao worker (cena, completar, ação): devolve o resultado já lido.
const aiJob=(kind,input)=>requestAi(kind,input).then(waitJob).then(j=>{if(j.status!=='done')throw new Error(j.error);return JSON.parse(j.result);});
function onJobRow(row){const w=jobWaiters.get(row.id);if(w&&(row.status==='done'||row.status==='failed')){jobWaiters.delete(row.id);w(row);}if(row.kind==='chat')chatJobChanged(row);}

/* ---------- typing ticker (reference: 2 chars / 30ms) ---------- */
setInterval(()=>{let changed=false;
  for(const[id,g]of gens){if(!g.comp)continue;g.i+=1;const el=nodeEl(id)?.querySelector('[data-typing]');if(g.i>=g.full.length){finishGen(id);changed=true;continue;}if(el)el.innerHTML=esc(g.full.slice(0,g.i))+'<span class="caret"></span>';}
  for(const s of state.scenes)for(const c of s.choices){if(!c.gen||!c.gen.full)continue;c.gen.i+=1;const inp=nodeEl(s.id)?.querySelector(`[data-act="clabel"][data-i="${s.choices.indexOf(c)}"]`);if(c.gen.i>=c.gen.full.length){c.label=c.gen.full;delete c.gen;changed=true;}else{c.label=c.gen.full.slice(0,c.gen.i);if(inp){if(inp.tagName==='INPUT')inp.value=c.label;else inp.textContent=c.label;}}}
  if(changed)refresh();},30);

/* ---------- node events ---------- */
let pendingSnap=null;
nodesEl.addEventListener('focusin',e=>{if(e.target.matches('[data-act=text],[data-act=title],[data-act=clabel]')&&!e.target.readOnly){pendingSnap=snapStr();typingTouched=new Set;takeFieldLock(e.target);}});
nodesEl.addEventListener('focusout',e=>{if(e.target.matches('[data-act=text],[data-act=title],[data-act=clabel]'))dropFieldLock(e.target);});
nodesEl.addEventListener('input',e=>{const n=e.target.closest('.node');if(!n)return;const s=scene(n.dataset.id);const a=e.target.dataset.act;
  if(a==='text'){s.text=e.target.value;if(expanded===s.id)applyPush();dirty=true;}else if(a==='title')s.title=e.target.value;else if(a==='clabel')s.choices[+e.target.dataset.i].label=e.target.value;
  if(['text','title','clabel'].includes(a))syncSoon();});
nodesEl.addEventListener('change',e=>{const n=e.target.closest('.node');if(!n)return;const s=scene(n.dataset.id);const a=e.target.dataset.act;const v=e.target.value;
  if(['text','title','clabel'].includes(a)){endTyping();renderStats(warnings().list);return;}
  if(a==='bg'){pushUndo();s.bg=v||null;if(v){reveal.set(s.id,performance.now());setTimeout(()=>reveal.delete(s.id),1700);}refresh();}
  else if(a==='sprite'){pushUndo();s.chars[+e.target.dataset.i].s=v;refresh();}
  else if(a==='speaker'){pushUndo();s.speaker=v;refresh();}
  else if(a==='addchar'&&v){if(s.chars.length>=MAXCH){toast('Uma cena tem no máximo 6 personagens.','err');return;}const c=charById(v);pushUndo();s.chars.push({c:c.id,s:c.sprites[0].id});freshRows.set('cast:'+s.id+':'+c.id,performance.now());reveal.set(s.id,performance.now());setTimeout(()=>reveal.delete(s.id),1700);refresh();}});
nodesEl.addEventListener('click',e=>{const b=e.target.closest('[data-act]');const n=e.target.closest('.node');if(!b||!n)return;const s=scene(n.dataset.id);const a=b.dataset.act;
  if(a==='rmchar'){const i=+b.dataset.i;if(s.kind==='dialogue'&&s.speaker===s.chars[i].c){toast(`${charById(s.chars[i].c).name} é quem fala nesta cena. Troque quem fala ou mude para Narração antes de tirar.`,'err');nodeShake(s.id);return;}pushUndo();s.chars.splice(i,1);refresh();}
  else if(a==='kind'){const v=b.dataset.v;if(v===s.kind)return;if(v==='dialogue'&&!s.chars.length){toast('Para criar uma fala, adicione antes um personagem à cena.','err');nodeShake(s.id);return;}pushUndo();s.kind=v;s.speaker=v==='dialogue'?s.chars[0].c:null;refresh();}
  else if(a==='addchoice'){if(heldAdd){heldAdd=false;return;}addChoice(s,e.shiftKey);}
  else if(a==='rmchoice'){const i=+b.dataset.i;const ch=s.choices[i];const g=geom.get(edgeKey(s.id,ch.id));if(g)ghosts.push({kind:'end',a:g.a,b:g.b,col:'#f2a541',t0:performance.now()});pushUndo();s.choices.splice(i,1);refresh();}
  else if(a==='menu'){e.stopPropagation();showMenu(n,s);}
  else if(a==='toggle'){setExpanded(expanded===s.id?null:s.id);}
  else if(a==='complete'){completeText(s);}
  else if(a==='retry'){retryGen(s);}});
function addChoice(s,ai){pushUndo();const ch={id:uid('ch'),label:ai?'':'Nova ação',target:null};if(!s.choices.length&&s.next){ch.target=s.next;s.next=null;}s.choices.push(ch);freshRows.set('opt:'+ch.id,performance.now());
  // Shift: a IA escreve só o rótulo da ação; a cena seguinte fica por conta do autor.
  if(ai){ch.gen={full:'',i:0};refresh();const p=outPos(s.id,ch.id);if(p)burst(p.x,p.y,'ai mini');
    aiJob('option',{sceneId:s.id,choiceId:ch.id,context:aiContext()}).then(r=>{if(ch.gen)ch.gen.full=r.label;},err=>{
      if(!ch.gen)return;delete ch.gen;if(!ch.label)ch.label='Nova ação';refresh();toast('A IA não conseguiu sugerir a ação: '+aiMessage(err),'err');});}
  else refresh();}
nodesEl.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;heldAdd=false;const b=e.target.closest('[data-act="addchoice"]');if(!b)return;const n=b.closest('.node');const x0=e.clientX,y0=e.clientY;
  const stop=()=>{clearTimeout(holdTimer);b.classList.remove('holding');removeEventListener('pointerup',stop);removeEventListener('pointercancel',stop);removeEventListener('pointermove',mv);};
  const mv=ev=>{if(Math.hypot(ev.clientX-x0,ev.clientY-y0)>10)stop();};
  addEventListener('pointerup',stop);addEventListener('pointercancel',stop);addEventListener('pointermove',mv);b.classList.add('holding');clearTimeout(holdTimer);
  holdTimer=setTimeout(()=>{stop();const s=scene(n.dataset.id);if(!s)return;heldAdd=true;navigator.vibrate?.(15);const c=centerOf(b);burst(c.x,c.y,'ai mini');addChoice(s,true);},HOLD_MS);});
// com o teclado do celular aberto, mantém o campo em edição à vista
function keepFieldVisible(el){if(!el||!el.isConnected||!nodesEl.contains(el)||!el.matches('input,textarea'))return;const r=el.getBoundingClientRect(),cr=canvas.getBoundingClientRect(),vv=window.visualViewport;
  const top=$('.hud').getBoundingClientRect().bottom+12,bottom=Math.min(cr.bottom,vv?vv.offsetTop+vv.height:innerHeight)-16;
  if(r.top>=top&&r.bottom<=bottom)return;const want=Math.max(top,Math.min(r.top,bottom-r.height));flyTo(view.x,view.y+(want-r.top),view.z);}
if(touchUI){nodesEl.addEventListener('focusin',e=>setTimeout(()=>keepFieldVisible(e.target),350));window.visualViewport?.addEventListener('resize',()=>keepFieldVisible(document.activeElement));}
nodesEl.addEventListener('mouseover',e=>{const p=e.target.closest('.port.out,[data-hover="add"]');if(!p||drag)return;const n=p.closest('.node');const h={sid:n.dataset.id,ch:p.classList.contains('port')?p.dataset.ch:'add',el:p};if(hover&&hover.el===p)return;hover=h;shiftOn=e.shiftKey;updatePrimed(true);dirty=true;});
nodesEl.addEventListener('mouseout',e=>{const p=e.target.closest('.port.out,[data-hover="add"]');if(!p||!hover||hover.el!==p)return;if(e.relatedTarget&&p.contains(e.relatedTarget))return;hover=null;updatePrimed(false);dirty=true;});
function updatePrimed(burstIt){nodesEl.querySelectorAll('.primed').forEach(x=>x.classList.remove('primed'));if(hover&&shiftOn&&!drag){hover.el.classList.add('primed');hover.el.closest('.node')?.classList.add('primed');if(burstIt!==false){const c=centerOf(hover.el);burst(c.x,c.y,'ai mini');}}}
function showMenu(n,s){closeMenu();const m=document.createElement('div');m.className='menu';m.innerHTML=`<button data-m="start">Definir como cena inicial</button><button data-m="play">Jogar a partir daqui</button><button data-m="del" class="danger">Excluir cena</button>`;n.appendChild(m);openMenu=m;
  m.onclick=e=>{const k=e.target.dataset.m;closeMenu();if(k==='start'){pushUndo();state.start=s.id;refresh();toast(`“${s.title}” agora é a cena inicial`);}else if(k==='play')openPlay(s.id);else if(k==='del')deleteScenes([s.id]);};}
function closeMenu(){if(openMenu){openMenu.remove();openMenu=null;}}

/* ---------- canvas pointer ---------- */
canvas.addEventListener('contextmenu',e=>{if(!e.target.closest('input,textarea'))e.preventDefault();});
canvas.addEventListener('pointerdown',e=>{if(e.target.closest('.hud,.zoombar,.selbar,.warnpop,.menu,.cutbtn'))return;closeMenu();$('#warnHost').innerHTML='';
  const touch=e.pointerType==='touch';
  if(touch){touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.size===2&&(!drag||drag.type==='pan'||(drag.type==='wire'&&!drag.moved))){e.preventDefault();clearTimeout(holdTimer);if(drag&&drag.type==='wire'){drag=null;refreshPorts();}startPinch();canvas.setPointerCapture(e.pointerId);return;}
    if(touches.size>1)return;}
  const port=e.target.closest('.port.out');
  if(port&&e.button===0){e.preventDefault();const s=scene(port.dataset.out);if(gens.has(s.id))return;const p=toWorld(e.clientX,e.clientY);drag={type:'wire',pid:e.pointerId,touch,s,ch:port.dataset.ch,sx:p.x,sy:p.y,mx:p.x,my:p.y,ai:e.shiftKey,held:false,moved:false,over:null,bad:false};hover=null;updatePrimed(false);canvas.setPointerCapture(e.pointerId);refreshPorts();
    if(touch){clearTimeout(holdTimer);const d=drag;holdTimer=setTimeout(()=>{if(drag!==d||d.moved)return;d.held=d.ai=true;refreshPorts();const c=centerOf(port);burst(c.x,c.y,'ai mini');navigator.vibrate?.(15);dirty=true;},HOLD_MS);}
    return;}
  if(e.button===2||e.button===1||(e.button===0&&spaceDown)||(touch&&!e.target.closest('.node'))){e.preventDefault();if(touch)canvas.focus({preventScroll:true});drag={type:'pan',pid:e.pointerId,touch,moved:false,cx:e.clientX,cy:e.clientY,vx:view.x,vy:view.y};canvas.classList.add('panning');canvas.setPointerCapture(e.pointerId);return;}
  if(e.button!==0)return;
  if(e.altKey){e.preventDefault();const p=toWorld(e.clientX,e.clientY);drag={type:'cut',x1:p.x,y1:p.y,x2:p.x,y2:p.y};canvas.setPointerCapture(e.pointerId);return;}
  const nodeHit=e.target.closest('.node');const titleHit=e.target.closest('.ntitle');
  if(nodeHit&&!(titleHit&&document.activeElement===titleHit)&&(titleHit||!e.target.closest('textarea,select,button,input,label,.menu,.port'))){e.preventDefault();if(document.activeElement&&nodesEl.contains(document.activeElement))document.activeElement.blur();const id=nodeHit.dataset.id;if(remoteDrag.has(id)){toast(`${remoteDrag.get(id).name} está movendo esta cena.`,'err');return;}if(touch&&selectMode);// no modo de seleção o toque só marca/desmarca ao soltar
    else if(e.shiftKey||e.ctrlKey||e.metaKey){selected.has(id)?selected.delete(id):selected.add(id);}else if(!selected.has(id)){selected.clear();selected.add(id);}syncSel();
    const p=toWorld(e.clientX,e.clientY);const el=nodeEl(id);nodesEl.appendChild(el);const group=touch&&selectMode&&!selected.has(id)?[id]:[...selected];
    drag={type:'move',pid:e.pointerId,touch,px:p.x,py:p.y,cx:e.clientX,cy:e.clientY,title:titleHit,orig:group.map(i=>({s:scene(i),x:scene(i).x,y:scene(i).y})),snap:snapStr(),moved:false,held:false,id};canvas.setPointerCapture(e.pointerId);
    if(touch){clearTimeout(holdTimer);const d=drag;el.classList.add('holding');holdTimer=setTimeout(()=>{el.classList.remove('holding');if(drag!==d||d.moved)return;d.held=true;navigator.vibrate?.(15);
      if(!selectMode){selectMode=true;selected.clear();if(expanded)setExpanded(null);toast('Seleção: toque em outras cenas para marcar. Toque no fundo para sair.');}
      selected.add(id);d.orig=[...selected].map(i=>({s:scene(i),x:scene(i).x,y:scene(i).y}));syncSel();},HOLD_MS);}
    return;}
  if(e.target.closest('.node'))return;
  e.preventDefault();canvas.focus({preventScroll:true});const add=e.shiftKey||e.ctrlKey||e.metaKey;if(!add){selected.clear();if(expanded)setExpanded(null);}syncSel();const p=toWorld(e.clientX,e.clientY);drag={type:'box',x1:p.x,y1:p.y,x2:p.x,y2:p.y,base:new Set(selected)};canvas.setPointerCapture(e.pointerId);});
function onPointerMove(e){if(drag&&(drag.type==='wire'||drag.type==='move'))lastMove={clientX:e.clientX,clientY:e.clientY,shiftKey:e.shiftKey,pointerId:e.pointerId,pointerType:e.pointerType};
  if(e.pointerType==='touch'&&touches.has(e.pointerId)){touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(drag&&drag.type==='pinch'){if(touches.size>=2)doPinch();return;}}
  if(!drag||(drag.pid!=null&&drag.pid!==e.pointerId))return;
  if(drag.type==='pan'){if(Math.hypot(e.clientX-drag.cx,e.clientY-drag.cy)>6)drag.moved=true;view.x=drag.vx+e.clientX-drag.cx;view.y=drag.vy+e.clientY-drag.cy;applyView();return;}
  const p=toWorld(e.clientX,e.clientY);
  if(drag.type==='cut'){drag.x2=p.x;drag.y2=p.y;dirty=true;return;}
  if(drag.type==='box'){drag.x2=p.x;drag.y2=p.y;const x1=Math.min(drag.x1,p.x),x2=Math.max(drag.x1,p.x),y1=Math.min(drag.y1,p.y),y2=Math.max(drag.y1,p.y);selected.clear();drag.base.forEach(i=>selected.add(i));state.scenes.forEach(s=>{if(s.x<x2&&s.x+300>x1&&dispY(s)<y2&&dispY(s)+nodeH(s.id)>y1)selected.add(s.id);});syncSel();dirty=true;return;}
  if(drag.type==='move'){const dx=p.x-drag.px,dy=p.y-drag.py;if(!drag.moved){if(Math.hypot(e.clientX-drag.cx,e.clientY-drag.cy)<(e.pointerType==='touch'?10:4))return;drag.moved=true;canvas.classList.add('moving');nodesEl.querySelectorAll('.node.holding').forEach(n=>n.classList.remove('holding'));drag.orig.forEach(o=>nodeEl(o.s.id)?.classList.add('lifting'));}drag.orig.forEach(o=>{o.s.x=Math.round(o.x+dx);o.s.y=Math.round(o.y+dy);const el=nodeEl(o.s.id);if(el){el.style.left=o.s.x+'px';el.style.top=dispY(o.s)+'px';}});sendDrag(drag.orig,false);dirty=true;return;}
  if(drag.type==='wire'){drag.mx=p.x;drag.my=p.y;if(Math.hypot(p.x-drag.sx,p.y-drag.sy)>(drag.touch?12/view.z:6))drag.moved=true;const was=drag.ai;drag.ai=e.shiftKey||drag.held;if(was!==drag.ai)refreshPorts();
    const under=document.elementFromPoint(e.clientX,e.clientY)?.closest('.node');const over=under&&under.dataset.id!==drag.s.id?under.dataset.id:(under?under.dataset.id:null);
    nodesEl.querySelectorAll('.node.target').forEach(n=>{if(n.dataset.id!==over)n.classList.remove('target','bad');nodesEl.querySelectorAll('.port.in.hot').forEach(x=>x.classList.remove('hot'));});
    drag.over=over;drag.bad=!!over&&(over===drag.s.id||reaches(over,drag.s.id));if(over){const el=nodeEl(over);el.classList.add('target');el.classList.toggle('bad',drag.bad);if(!drag.bad)el.querySelector('.port.in')?.classList.add('hot');}dirty=true;}}
canvas.addEventListener('pointermove',onPointerMove);
// arrastando uma ligação ou cena perto da borda, a tela anda sozinha
let lastMove=null;
function autoPan(){if(!drag||!lastMove||!drag.moved||!(drag.type==='wire'||drag.type==='move'))return;const r=canvas.getBoundingClientRect(),m=touchUI?56:32,sp=touchUI?14:10;
  const edge=(v,lo,hi)=>v<lo+m?(lo+m-v)/m:v>hi-m?-(v-(hi-m))/m:0;const dx=edge(lastMove.clientX,r.left,r.right),dy=edge(lastMove.clientY,r.top,r.bottom);
  if(!dx&&!dy)return;view.x+=dx*sp;view.y+=dy*sp;applyView();onPointerMove(lastMove);}
canvas.addEventListener('pointercancel',e=>{lastMove=null;touches.delete(e.pointerId);clearTimeout(holdTimer);if(drag&&['pinch','pan','wire','box'].includes(drag.type)){drag=null;pinch=null;refreshPorts();canvas.classList.remove('panning');dirty=true;}});
canvas.addEventListener('pointerup',e=>{lastMove=null;
  if(e.pointerType==='touch'){touches.delete(e.pointerId);clearTimeout(holdTimer);nodesEl.querySelectorAll('.node.holding').forEach(n=>n.classList.remove('holding'));
    if(drag&&drag.type==='pinch'){if(touches.size===1){const[[pid,t]]=[...touches];drag={type:'pan',pid,touch:true,moved:true,cx:t.x,cy:t.y,vx:view.x,vy:view.y};}else if(!touches.size){drag=null;pinch=null;canvas.classList.remove('panning');}return;}}
  if(!drag||(drag.pid!=null&&drag.pid!==e.pointerId))return;const d=drag;drag=null;canvas.classList.remove('panning');nodesEl.querySelectorAll('.node.target').forEach(n=>n.classList.remove('target','bad'));nodesEl.querySelectorAll('.port.hot').forEach(x=>x.classList.remove('hot'));
  if(d.type==='move'){canvas.classList.remove('moving');nodesEl.querySelectorAll('.node.lifting').forEach(n=>{n.classList.remove('lifting');n.classList.add('dropped');setTimeout(()=>n.classList.remove('dropped'),320);});if(d.moved){pushUndo(d.snap);applyPush();sendDrag(d.orig,true);syncNow();}
    else if(d.touch&&(d.held||selectMode)){if(!d.held){selected.has(d.id)?selected.delete(d.id):selected.add(d.id);syncSel();}}
    else{if(!e.shiftKey&&selected.size>1){selected.clear();selected.add(d.id);syncSel();}if(!e.shiftKey&&!e.ctrlKey&&!e.metaKey){setExpanded(d.id);if(e.pointerType==='touch')focusScene(d.id);}const tt=d.title?nodeEl(d.id)?.querySelector('.ntitle'):null;if(tt){tt.focus({preventScroll:true});const L=tt.value.length;try{tt.setSelectionRange(L,L);}catch(_){}}}dirty=true;return;}
  if(d.type==='cut'){applyCut(d);dirty=true;return;}
  if(d.type==='pan'&&d.touch&&!d.moved){selected.clear();if(expanded)setExpanded(null);syncSel();}
  if(d.type==='box'||d.type==='pan'){dirty=true;return;}
  if(d.type==='wire'){const ai=e.shiftKey||d.ai;const cur=targetOf(d.s,d.ch);refreshPorts();
    if(!d.moved){if(!cur)createScene(d.s,d.ch,null,ai);dirty=true;return;}
    if(d.over){if(d.over===cur){dirty=true;return;}tryConnect(d.s,d.ch,d.over,{x:d.mx,y:d.my},ai);}
    else{createScene(d.s,d.ch,{x:d.mx,y:d.my},ai);}
    dirty=true;}});
function refreshPorts(){nodesEl.querySelectorAll('.port.out').forEach(p=>{p.classList.remove('charging','active');if(drag&&drag.type==='wire'&&drag.s.id===p.dataset.out&&drag.ch===p.dataset.ch)p.classList.add(drag.ai?'charging':'active');});}
canvas.addEventListener('wheel',e=>{const t=e.target;if(t&&t.tagName==='TEXTAREA'&&t.scrollHeight>t.clientHeight)return;e.preventDefault();zoomAt(view.z*Math.exp(-e.deltaY*(e.ctrlKey?.01:.0015)),e.clientX,e.clientY);},{passive:false});
canvas.addEventListener('keydown',e=>{const p=e.target.closest('.port.out');if(p&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();const s=scene(p.dataset.out);if(!targetOf(s,p.dataset.ch))createScene(s,p.dataset.ch,null,e.shiftKey);}});
const inField=t=>t&&(t.matches('input,textarea,select')||t.isContentEditable);
addEventListener('keydown',e=>{if(e.key==='Shift'&&!shiftOn){shiftOn=true;if(hover){updatePrimed(true);}if(drag&&drag.type==='wire'){drag.ai=true;refreshPorts();}dirty=true;}
  if(e.key==='Alt')altOn=true;
  if(document.querySelector('.modal-wrap')){if(e.key==='Escape')closeModal();return;}
  if(play){if(e.key==='Escape')closePlay();else if(/^[1-9]$/.test(e.key)){const b=play.el.querySelectorAll('.pchoice')[+e.key-1];if(b)b.click();}else if(e.key==='Enter'||e.key===' '){const c=play.el.querySelector('.pcont .pbtn');if(c){e.preventDefault();c.click();}}return;}
  if(inField(e.target))return;
  if(e.code==='Space'){spaceDown=true;e.preventDefault();}
  const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
  if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();}
  else if(mod&&k==='y'){e.preventDefault();redo();}
  else if(mod&&k==='a'){e.preventDefault();state.scenes.forEach(s=>selected.add(s.id));syncSel();}
  else if(e.key==='Delete'||e.key==='Backspace'){if(selected.size){e.preventDefault();deleteScenes([...selected]);}}
  else if(e.key==='Escape'){if(drag){drag=null;refreshPorts();}selected.clear();syncSel();closeMenu();if(expanded)setExpanded(null);dirty=true;}});
addEventListener('keyup',e=>{if(e.key==='Shift'){shiftOn=false;updatePrimed(false);if(drag&&drag.type==='wire'){drag.ai=false;refreshPorts();}dirty=true;}if(e.key==='Alt')altOn=false;if(e.code==='Space')spaceDown=false;});
addEventListener('blur',()=>{shiftOn=false;altOn=false;spaceDown=false;updatePrimed(false);dirty=true;});
addEventListener('resize',()=>{dirty=true;});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.menu,[data-act="menu"]'))closeMenu();if(!e.target.closest('.warnpop,#warnBtn'))$('#warnHost').innerHTML='';});

/* ---------- HUD ---------- */
$('#storyTitle').addEventListener('focus',e=>{if(e.target.readOnly)return;pendingSnap=snapStr();typingTouched=new Set;takeFieldLock(e.target);});
$('#storyTitle').addEventListener('blur',e=>dropFieldLock(e.target));
$('#storyTitle').addEventListener('input',e=>{state.title=e.target.value;syncSoon();});
$('#storyTitle').addEventListener('change',endTyping);
// Fim de uma digitação: grava o texto já e vira um passo de desfazer.
function endTyping(){clearTimeout(syncTimer);syncNow();if(pendingSnap&&typingTouched&&typingTouched.size)pushUndo(pendingSnap,typingTouched);pendingSnap=null;typingTouched=null;}
$('#btnUndo').onclick=undo;$('#btnRedo').onclick=redo;
const ctr=()=>{const r=canvas.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2];};
$('#btnZoomIn').onclick=()=>zoomAt(view.z*1.25,...ctr());$('#btnZoomOut').onclick=()=>zoomAt(view.z*.8,...ctr());$('#btnZoomReset').onclick=fitView;
$('#btnAddScene').onclick=()=>{const[cx,cy]=ctr();const p=toWorld(cx-150,cy-200);pushUndo();const s=blankScene(p.x,p.y);state.scenes.push(s);expanded=s.id;if(!scene(state.start))state.start=s.id;fresh.set(s.id,{t0:performance.now(),cls:'pop'});refresh();burst(s.x,s.y+20,'plain');};
$('#btnPlay').onclick=()=>openPlay();
const appEl=$('.app');const mqNarrow=matchMedia('(max-width:900px)');
const panels={rail:true,chat:true};try{const sv=JSON.parse(localStorage.getItem('vn-panels')||'null');if(sv){panels.rail=sv.rail!==false;panels.chat=sv.chat!==false;}}catch(_){}
function syncToggles(){const nr=mqNarrow.matches;const rOpen=nr?$('#rail').classList.contains('open'):panels.rail;const cOpen=nr?$('#chat').classList.contains('open'):panels.chat;$('#tglRail').setAttribute('aria-expanded',rOpen);$('#tglChat').setAttribute('aria-expanded',cOpen);}
function setPanel(which,open,animate=true){
  if(mqNarrow.matches){const el=$('#'+which),other=$('#'+(which==='rail'?'chat':'rail'));el.classList.toggle('open',open);if(open)other.classList.remove('open');syncToggles();return;}
  if(panels[which]===open)return;panels[which]=open;try{localStorage.setItem('vn-panels',JSON.stringify(panels));}catch(_){}
  const anchor=canvas.getBoundingClientRect().left+view.x;
  appEl.classList.toggle(which+'-off',!open);syncToggles();
  if(!animate||reduced){if(which==='rail'){view.x=anchor-canvas.getBoundingClientRect().left;applyView();}dirty=true;return;}
  const t0=performance.now();const follow=now=>{if(which==='rail'){view.x=anchor-canvas.getBoundingClientRect().left;applyView();}dirty=true;if(now-t0<520)requestAnimationFrame(follow);};requestAnimationFrame(follow);}
const togglePanel=w=>setPanel(w,mqNarrow.matches?!$('#'+w).classList.contains('open'):!panels[w]);
$('#tglRail').onclick=()=>togglePanel('rail');$('#tglChat').onclick=()=>togglePanel('chat');
$('#railClose').onclick=()=>setPanel('rail',false);$('#chatClose').onclick=()=>setPanel('chat',false);
mqNarrow.addEventListener('change',()=>{$('#rail').classList.remove('open');$('#chat').classList.remove('open');syncToggles();dirty=true;});
appEl.classList.add('no-anim');appEl.classList.toggle('rail-off',!panels.rail);appEl.classList.toggle('chat-off',!panels.chat);syncToggles();requestAnimationFrame(()=>requestAnimationFrame(()=>appEl.classList.remove('no-anim')));

/* ---------- left rail ---------- */
let railTab='chars';const openCards=new Set;const freshCards=new Map;
$('#tabChars').onclick=()=>{railTab='chars';renderRail();};$('#tabBgs').onclick=()=>{railTab='bgs';renderRail();};
function usage(kind,id){return state.scenes.filter(s=>kind==='bg'?s.bg===id:kind==='char'?s.chars.some(c=>c.c===id):s.chars.some(c=>c.s===id)).map(s=>s.title);}
const X='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
function cardFresh(id,src){const t=freshCards.get(id);if(t==null)return'';const a=ago(t);if(a>1400){freshCards.delete(id);return'';}return` fresh${src==='ai'?' ai':''}" style="animation-delay:-${Math.min(a,500)}ms`;}
function renderRail(){$('#tabChars').setAttribute('aria-selected',railTab==='chars');$('#tabBgs').setAttribute('aria-selected',railTab==='bgs');$('#nChars').textContent=state.characters.length;$('#nBgs').textContent=state.backgrounds.length;
  const acts=$('#railActions'),body=$('#railBody');
  if(railTab==='chars'){
    acts.innerHTML=`<button class="addbtn" id="newChar">+ novo (upload)</button><button class="btn sm violet" id="genChar">${SPARK.replace('<svg','<svg style="width:13px;height:13px"')}Gerar com IA</button><button class="btn sm" id="mkChar">Marketplace</button>`;
    body.innerHTML=state.characters.length?state.characters.map(c=>{const o=openCards.has(c.id);return`<div class="card${cardFresh(c.id,c.source)}" data-c="${c.id}"><div class="card-row" data-toggle><img class="avatar" src="${c.sprites[0]?.img||''}" alt=""><div style="min-width:0;flex:1"><div class="card-name"><span class="swatch" style="background:${c.color||'transparent'}"></span><span style="color:${c.color||'inherit'}">${esc(c.name)}</span></div><div class="card-sub">${c.sprites.length} sprite${c.sprites.length===1?'':'s'}${c.source==='marketplace'?' · marketplace':c.source==='ai'?' · gerado por IA':''}</div></div><span class="chev">${o?'−':'+'}</span></div>
      ${o?`<div class="card-edit"><label class="field"><span class="lbl">nome</span><input class="inp" data-cf="name" value="${esc(c.name)}"></label>
      <div class="field"><span class="lbl">cor do nome · opcional</span><div class="row"><label class="row" style="gap:6px;font-size:12.5px;color:var(--text-2)"><input type="checkbox" data-cf="hascolor"${c.color?' checked':''}> usar cor</label><input type="color" data-cf="color" value="${c.color||'#f2a541'}"${c.color?'':' disabled'} aria-label="Cor" style="width:34px;height:24px;border:0;background:none;padding:0"><span style="font-weight:600;color:${c.color||'var(--text)'}">${esc(c.name)}</span></div></div>
      <label class="field"><span class="lbl">descrição</span><textarea class="inp" data-cf="desc">${esc(c.desc)}</textarea></label>
      <div class="field"><span class="lbl">sprites · emoções</span>${c.sprites.map(s=>`<div class="sprite" data-sp="${s.id}"><img src="${s.img}" alt="${esc(s.name)}"><div class="sprite-f"><input class="inp" data-sf="name" value="${esc(s.name)}" placeholder="Nome da emoção" aria-label="Nome do sprite"><input class="inp" data-sf="desc" value="${esc(s.desc)}" placeholder="Descrição para a IA" aria-label="Descrição do sprite"></div><button class="iconbtn sm" data-sdel aria-label="Excluir sprite">${X}</button></div>`).join('')||'<div class="empty">Sem sprites. Envie ao menos um para usar este personagem em cenas.</div>'}
      <label class="addbtn" style="align-self:flex-start;display:inline-flex;align-items:center">+ sprite (upload)<input type="file" accept="image/*" data-upsprite hidden></label></div>
      <div class="row"><button class="btn sm" data-pub>Publicar no marketplace</button><button class="btn sm danger" data-cdel>Excluir</button></div></div>`:''}</div>`;}).join(''):'<div class="empty">Nenhum personagem. Envie sprites, gere com IA ou copie do Marketplace.</div>';
    $('#newChar').onclick=()=>{pushUndo();const c={id:uid('c'),name:'Novo personagem',desc:'',color:'',source:'upload',sprites:[]};state.characters.push(c);openCards.add(c.id);freshCards.set(c.id,performance.now());renderRail();refresh();};
    $('#genChar').onclick=genCharModal;$('#mkChar').onclick=()=>marketModal('chars');
  }else{
    acts.innerHTML=`<label class="addbtn" style="display:inline-flex;align-items:center">+ upload<input type="file" accept="image/*" id="upBg" hidden></label><button class="btn sm violet" id="genBg">${SPARK.replace('<svg','<svg style="width:13px;height:13px"')}Gerar com IA</button><button class="btn sm" id="mkBg">Marketplace</button>`;
    body.innerHTML=state.backgrounds.length?state.backgrounds.map(b=>{const o=openCards.has(b.id);return`<div class="card${cardFresh(b.id,b.source)}" data-b="${b.id}"><div class="card-row" data-toggle><img class="bg-thumb" src="${b.img}" alt=""><div style="min-width:0;flex:1"><div class="card-name"><span>${esc(b.name)}</span></div><div class="card-sub">${usage('bg',b.id).length} cena(s)${b.source==='marketplace'?' · marketplace':b.source==='ai'?' · gerado por IA':''}</div></div><span class="chev">${o?'−':'+'}</span></div>
      ${o?`<div class="card-edit"><img src="${b.img}" alt="" style="width:100%;border-radius:8px;aspect-ratio:16/9;object-fit:cover"><label class="field"><span class="lbl">nome</span><input class="inp" data-bf="name" value="${esc(b.name)}"></label><label class="field"><span class="lbl">descrição</span><textarea class="inp" data-bf="desc">${esc(b.desc)}</textarea></label><label class="addbtn" style="align-self:flex-start;display:inline-flex;align-items:center">trocar imagem<input type="file" accept="image/*" data-upbg hidden></label><div class="row"><button class="btn sm" data-pub>Publicar no marketplace</button><button class="btn sm danger" data-bdel>Excluir</button></div></div>`:''}</div>`;}).join(''):'<div class="empty">Nenhum background. Envie uma imagem, gere com IA ou copie do Marketplace.</div>';
    $('#upBg').onchange=e=>readFile(e.target.files[0],img=>{pushUndo();const b={id:uid('b'),name:(e.target.files[0].name||'Background').replace(/\.[^.]+$/,''),desc:'',source:'upload',img};state.backgrounds.push(b);openCards.add(b.id);freshCards.set(b.id,performance.now());renderRail();refresh();toast('Background enviado');});
    $('#genBg').onclick=genBgModal;$('#mkBg').onclick=()=>marketModal('bgs');
  }}
function readFile(f,cb){if(!f)return;const r=new FileReader();r.onload=()=>cb(r.result);r.readAsDataURL(f);}
const railBody=$('#railBody');
railBody.addEventListener('click',e=>{const card=e.target.closest('.card');if(!card)return;const cid=card.dataset.c,bid=card.dataset.b;
  if(e.target.closest('[data-toggle]')){const k=cid||bid;openCards.has(k)?openCards.delete(k):openCards.add(k);renderRail();return;}
  if(cid){const c=charById(cid);
    if(e.target.closest('[data-cdel]')){const u=usage('char',cid);if(u.length){toast(`Não dá para excluir ${c.name}: está em ${u.map(t=>'“'+t+'”').join(', ')}. Tire das cenas antes.`,'err');return;}pushUndo();state.characters=state.characters.filter(x=>x.id!==cid);renderRail();refresh();toast('Personagem excluído');}
    else if(e.target.closest('[data-sdel]')){const spid=e.target.closest('[data-sp]').dataset.sp;const u=usage('sprite',spid);if(u.length){toast(`Sprite em uso em ${u.map(t=>'“'+t+'”').join(', ')}. Troque o sprite nessas cenas antes.`,'err');return;}pushUndo();c.sprites=c.sprites.filter(s=>s.id!==spid);renderRail();refresh();}
    else if(e.target.closest('[data-pub]'))publish('chars',c);}
  if(bid){const b=bgById(bid);
    if(e.target.closest('[data-bdel]')){const u=usage('bg',bid);if(u.length){toast(`Não dá para excluir “${b.name}”: está em ${u.map(t=>'“'+t+'”').join(', ')}.`,'err');return;}pushUndo();state.backgrounds=state.backgrounds.filter(x=>x.id!==bid);renderRail();refresh();toast('Background excluído');}
    else if(e.target.closest('[data-pub]'))publish('bgs',b);}});
railBody.addEventListener('focusin',e=>{if(e.target.matches('input:not([type=checkbox]):not([type=file]),textarea'))pendingSnap=snapStr();});
railBody.addEventListener('input',e=>{const card=e.target.closest('.card');if(!card)return;const t=e.target;
  if(card.dataset.c){const c=charById(card.dataset.c);if(t.dataset.cf==='name'||t.dataset.cf==='desc')c[t.dataset.cf]=t.value;if(t.dataset.cf==='color')c.color=t.value;const sp=t.closest('[data-sp]');if(sp&&t.dataset.sf)c.sprites.find(s=>s.id===sp.dataset.sp)[t.dataset.sf]=t.value;}
  else if(card.dataset.b){const b=bgById(card.dataset.b);if(t.dataset.bf)b[t.dataset.bf]=t.value;}});
railBody.addEventListener('change',e=>{const card=e.target.closest('.card');if(!card)return;const t=e.target;
  if(t.dataset.cf==='hascolor'){pushUndo();const c=charById(card.dataset.c);c.color=t.checked?(card.querySelector('[data-cf=color]').value||'#f2a541'):'';renderRail();refresh();return;}
  if(t.matches('[data-upsprite]')){const c=charById(card.dataset.c);readFile(t.files[0],img=>{pushUndo();c.sprites.push({id:uid('sp'),name:'Nova emoção',desc:'',img});renderRail();refresh();toast('Sprite enviado. Dê um nome e uma descrição a ele.');});return;}
  if(t.matches('[data-upbg]')){const b=bgById(card.dataset.b);readFile(t.files[0],img=>{pushUndo();b.img=img;renderRail();refresh();});return;}
  if(pendingSnap&&pendingSnap!==snapStr())pushUndo(pendingSnap);pendingSnap=null;renderRail();refresh();});
function publish(kind,item){const copy=JSON.parse(JSON.stringify(item));copy.id=uid(kind==='chars'?'c':'b');copy.author='@você';copy.source='marketplace';if(kind==='chars')copy.sprites.forEach(s=>s.id=uid('sp'));market[kind==='chars'?'characters':'backgrounds'].unshift(copy);toast(`“${item.name}” publicado no marketplace`);}

/* ---------- modals ---------- */
function modal(html,cls){closeModal();const w=document.createElement('div');w.className='modal-wrap';w.innerHTML=`<div class="modal ${cls||''}" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(w);w.addEventListener('pointerdown',e=>{if(e.target===w)closeModal();});w.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);const f=w.querySelector('input,textarea');if(f)f.focus();return w;}
function closeModal(){const m=document.querySelector('.modal-wrap');if(m)m.remove();}
function marketModal(tab){const draw=()=>{const items=tab==='chars'?market.characters:market.backgrounds;
  const w=modal(`<div class="modal-head"><h2>Marketplace</h2><div class="tabs" style="width:250px"><button class="tab" data-mt="chars" aria-selected="${tab==='chars'}">Personagens</button><button class="tab" data-mt="bgs" aria-selected="${tab==='bgs'}">Backgrounds</button></div><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
  <div class="modal-body"><div class="hint">Itens publicados por usuários. Ao incluir, uma cópia vai para esta história e passa a ser independente do original.</div><div class="mk-grid">${items.map((it,i)=>`<div class="mk-card" style="animation:rowpop .4s cubic-bezier(.2,1.4,.4,1) both;animation-delay:${i*50}ms"><div class="mk-art">${tab==='chars'?`<div class="strip">${it.sprites.slice(0,3).map(s=>`<img src="${s.img}" alt="">`).join('')}</div>`:`<img class="full" src="${it.img}" alt="">`}</div><div class="mk-info"><b style="color:${it.color||'inherit'}">${esc(it.name)}</b><span class="hint">${esc(it.desc)}</span>${tab==='chars'?`<span class="card-sub">${it.sprites.map(s=>esc(s.name)).join(' · ')}</span>`:''}<span class="card-sub">por ${esc(it.author)}</span><button class="btn sm primary" data-add="${i}" style="align-self:flex-start;margin-top:6px">Incluir na história</button></div></div>`).join('')}</div></div>`);
  w.querySelectorAll('[data-mt]').forEach(b=>b.onclick=()=>{tab=b.dataset.mt;draw();});
  w.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const it=JSON.parse(JSON.stringify(items[+b.dataset.add]));delete it.author;pushUndo();it.id=uid(tab==='chars'?'c':'b');it.source='marketplace';if(tab==='chars'){it.sprites.forEach(s=>s.id=uid('sp'));state.characters.push(it);railTab='chars';}else{state.backgrounds.push(it);railTab='bgs';}freshCards.set(it.id,performance.now());renderRail();refresh();toast(`“${it.name}” incluído na história`);b.textContent='Incluído ✓';b.disabled=true;const r=b.getBoundingClientRect();screenBurst(r.left+r.width/2,r.top+r.height/2);});};draw();}
function screenBurst(x,y,ai){const b=document.createElement('div');b.className='burst '+(ai?'ai':'plain');b.style.position='fixed';b.style.left=x+'px';b.style.top=y+'px';b.style.zIndex=90;b.innerHTML='<span class="ring"></span><span class="ring r2"></span>';document.body.appendChild(b);setTimeout(()=>b.remove(),900);}
function genCharModal(){const w=modal(`<div class="modal-head"><h2>Gerar personagem com IA</h2><span class="tag ai">${SPARK}IA</span><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
  <div class="modal-body"><div class="row" style="align-items:flex-end"><label class="field" style="flex:1"><span class="lbl">nome</span><input class="inp" id="gcName" value="Marta"></label><div class="field"><span class="lbl">cor · opcional</span><span class="row" style="height:30px"><input type="checkbox" id="gcHas" checked aria-label="Usar cor"><input type="color" id="gcColor" value="#5eead4" aria-label="Cor" style="width:34px;height:24px;border:0;background:none;padding:0"></span></div></div>
  <label class="field"><span class="lbl">descrição física</span><textarea class="inp" id="gcDesc">Mulher de 30 anos, alta, pele morena, cabelo preto longo preso em trança, usa jaqueta de couro.</textarea></label>
  <div class="field"><span class="lbl">emoções desejadas · nome e descrição viram o sprite</span><div id="gcEmos" style="display:flex;flex-direction:column;gap:6px"></div><button class="addbtn" id="gcAdd" style="align-self:flex-start">+ emoção</button></div>
  <div class="gen-strip" id="gcStrip" hidden></div></div>
  <div class="modal-foot"><button class="btn" data-close>Cancelar</button><button class="btn violet solid" id="gcGo">${SPARK.replace('<svg','<svg style="width:13px;height:13px"')}Gerar todos os sprites</button></div>`,'ai-glow');
  const row=([n,d],anim)=>{const r=document.createElement('div');r.className='emo-row'+(anim?' fresh':'');r.innerHTML=`<input class="inp" value="${esc(n)}" placeholder="Nome" aria-label="Nome da emoção"><input class="inp" value="${esc(d)}" placeholder="Descrição" aria-label="Descrição da emoção"><button class="iconbtn sm" aria-label="Remover emoção">${X}</button>`;r.querySelector('button').onclick=()=>r.remove();w.querySelector('#gcEmos').appendChild(r);};
  [['Neutro','expressão calma'],['Feliz','sorriso confiante'],['Brava','olhar duro, sobrancelhas franzidas'],['Surpresa','olhos arregalados']].forEach(x=>row(x));w.querySelector('#gcAdd').onclick=()=>row(['',''],true);
  w.querySelector('#gcHas').onchange=e=>w.querySelector('#gcColor').disabled=!e.target.checked;
  w.querySelector('#gcGo').onclick=e=>{const name=w.querySelector('#gcName').value.trim();const list=[...w.querySelectorAll('.emo-row')].map(r=>[r.children[0].value.trim(),r.children[1].value.trim()]).filter(x=>x[0]);if(!name||!list.length){toast('Informe o nome e ao menos uma emoção.','err');return;}
    const btn=e.currentTarget,label=btn.innerHTML;btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Gerando…';const strip=w.querySelector('#gcStrip');strip.hidden=false;strip.innerHTML=list.map(()=>'<span class="slotph"></span>').join('');
    const desc=w.querySelector('#gcDesc').value,color=w.querySelector('#gcHas').checked?w.querySelector('#gcColor').value:'';
    requestAi('character',{name,desc,color,emotions:list.map(([n,d])=>({name:n,desc:d}))}).then(waitJob).then(job=>{
      if(job.status!=='done')throw new Error(job.error);
      const c={id:uid('c'),name,desc,color,source:'ai',sprites:JSON.parse(job.result).sprites.map(s=>({id:uid('sp'),name:s.name,desc:s.description,img:imgUrl(s.image_key)}))};
      const add=()=>{pushUndo();state.characters.push(c);openCards.add(c.id);freshCards.set(c.id,performance.now());railTab='chars';if(w.isConnected)closeModal();renderRail();refresh();toast(`${name} gerado com ${c.sprites.length} sprites`,'ai');};
      if(!w.isConnected){add();return;}
      c.sprites.forEach((s,i)=>setTimeout(()=>{const ph=strip.children[i];if(ph){const img=document.createElement('img');img.src=s.img;img.alt=s.name;img.title=s.name;ph.replaceWith(img);}},i*180));
      setTimeout(add,c.sprites.length*180+500);
    }).catch(err=>{toast('Não foi possível gerar o personagem: '+aiMessage(err),'err');if(w.isConnected){btn.disabled=false;btn.innerHTML=label;strip.hidden=true;}});};}
function genBgModal(){const w=modal(`<div class="modal-head"><h2>Gerar background com IA</h2><span class="tag ai">${SPARK}IA</span><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div>
  <div class="modal-body"><label class="field"><span class="lbl">nome</span><input class="inp" id="gbName" value="Floresta do manguezal"></label><label class="field"><span class="lbl">descrição</span><textarea class="inp" id="gbDesc">Mata fechada perto do mangue, fim de tarde, raízes aparentes e luz filtrada entre as árvores.</textarea></label><div class="stage-mini" id="gbPrev" hidden></div></div>
  <div class="modal-foot"><button class="btn" data-close>Cancelar</button><button class="btn violet solid" id="gbGo">${SPARK.replace('<svg','<svg style="width:13px;height:13px"')}Gerar background</button></div>`,'narrow ai-glow');
  w.querySelector('#gbGo').onclick=e=>{const n=w.querySelector('#gbName').value.trim();if(!n){toast('Dê um nome ao background.','err');return;}const btn=e.currentTarget,label=btn.innerHTML;btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Gerando…';const pv=w.querySelector('#gbPrev');pv.hidden=false;pv.classList.remove('reveal');pv.innerHTML='<div class="gen-veil"><span class="skel" style="width:70%"></span><span class="skel" style="width:52%"></span><span class="skel" style="width:61%"></span></div>';
    const desc=w.querySelector('#gbDesc').value;
    requestAi('background',{name:n,desc}).then(waitJob).then(job=>{
      if(job.status!=='done')throw new Error(job.error);
      const b={id:uid('b'),name:n,desc,source:'ai',img:imgUrl(JSON.parse(job.result).image_key)};
      const add=()=>{pushUndo();state.backgrounds.push(b);openCards.add(b.id);freshCards.set(b.id,performance.now());railTab='bgs';if(w.isConnected)closeModal();renderRail();refresh();toast(`Background “${n}” gerado`,'ai');};
      if(!w.isConnected){add();return;}
      pv.classList.add('reveal');pv.innerHTML=`<img class="bgimg" src="${b.img}" alt="">`;setTimeout(add,1000);
    }).catch(err=>{toast('Não foi possível gerar o background: '+aiMessage(err),'err');if(w.isConnected){btn.disabled=false;btn.innerHTML=label;pv.hidden=true;}});};}
function completeText(s){if(gens.has(s.id))return;const prev=snapStr();const old=s.text;let result=null,iv=0,req=0;
  const w=modal(`<div class="modal-head"><h2>Completar texto</h2><span class="tag ai">${SPARK}IA</span><button class="iconbtn" data-close aria-label="Fechar">${X}</button></div><div class="modal-body"><label class="field"><span class="lbl">instrução opcional</span><span class="row"><input class="inp" id="ctInstr" placeholder="ex.: deixar mais tenso" style="flex:1"><button class="btn sm" id="ctAgain">Gerar de novo</button></span></label><div class="field"><span class="lbl">sugestão</span><div class="suggest" id="ctSug"></div></div><div class="hint">O texto só é substituído se você aceitar.</div></div><div class="modal-foot"><button class="btn" data-close>Recusar</button><button class="btn violet solid" id="ctOk" disabled>Aceitar</button></div>`,'narrow ai-glow');
  const sug=w.querySelector('#ctSug'),ok=w.querySelector('#ctOk'),again=w.querySelector('#ctAgain');
  const gen=()=>{const my=++req;clearInterval(iv);result=null;ok.disabled=true;again.disabled=true;sug.innerHTML=`${esc(old)}<span class="add"></span><span class="spinner" style="margin-left:6px"></span>`;
    aiJob('complete',{sceneId:s.id,text:old,textKind:s.kind,speakerName:s.kind==='dialogue'?(charById(s.speaker)?.name||''):'',instruction:w.querySelector('#ctInstr').value.trim()}).then(r=>{
      if(my!==req||!w.isConnected)return;again.disabled=false;result=r.text;
      // Continuação mostra só o trecho novo; reescrita mostra o texto inteiro.
      const cont=result.startsWith(old.trimEnd());const extra=cont?result.slice(old.trimEnd().length):result;
      sug.innerHTML=`${cont?esc(old.trimEnd()):''}<span class="add"></span><span class="caret"></span>`;const add=sug.querySelector('.add');let i=0;
      iv=setInterval(()=>{if(!add.isConnected){clearInterval(iv);return;}i+=2;add.textContent=extra.slice(0,i);if(i>=extra.length){clearInterval(iv);sug.querySelector('.caret')?.remove();ok.disabled=false;}},30);
    },err=>{if(my!==req||!w.isConnected)return;again.disabled=false;sug.innerHTML=`${esc(old)}<div class="hint" style="color:#ffb4a8;margin-top:6px">${esc('Falhou: '+aiMessage(err))}</div>`;});};
  again.onclick=gen;w.querySelector('#ctInstr').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();gen();}});gen();
  ok.onclick=()=>{if(result==null)return;if(!scene(s.id)){toast('A cena foi apagada.','err');closeModal();return;}pushUndo(prev);s.text=result;closeModal();refresh();const n=nodeEl(s.id);if(n){n.classList.add('landed');setTimeout(()=>n.classList.remove('landed'),900);}toast('Texto atualizado','ai');};}

/* ---------- chat de IA ----------
   Pedido por request_ai; os pedaços chegam por chat_chunk (só os meus) e a mensagem final,
   com as propostas, por my_chat_message. A conversa fica no servidor e volta ao recarregar. */
const log=$('#chatLog');
function addMsg(html,who){const d=document.createElement('div');d.className='msg '+who;d.innerHTML=html;log.appendChild(d);log.scrollTop=log.scrollHeight;return d;}
const greet=()=>addMsg('Conheço o grafo, o elenco e os backgrounds desta história. Peça algo como <b>“crie a cena da ação sem destino”</b> ou <b>“continue a partir do final”</b>. Toda mudança chega como proposta para você aceitar.','bot');
greet();
const chatJobs=new Map;const chatSeen=new Set; // jobId -> {el, next, held, text, done}
let chatLive=false; // depois do histórico: propostas novas abrem o rascunho sozinhas
const chatDropped=new Set; // pedidos em andamento quando o chat foi limpo: pedaços e falhas são ignorados
function chatJob(jobId){let j=chatJobs.get(jobId);if(!j){j={el:addMsg('<span class="typingdots"><i></i><i></i><i></i></span>','bot'),next:0,held:new Map,text:'',done:false};chatJobs.set(jobId,j);}return j;}
function onChatChunk(row){if(chatDropped.has(row.jobId))return;const j=chatJob(row.jobId);if(j.done)return;j.held.set(row.seq,row.text);
  while(j.held.has(j.next)){j.text+=j.held.get(j.next);j.held.delete(j.next);j.next++;}
  if(j.text){j.el.innerHTML=esc(j.text)+'<span class="caret"></span>';log.scrollTop=log.scrollHeight;}}
function chatJobChanged(row){if(row.status!=='failed'||chatDropped.has(row.id))return;const j=chatJob(row.id);if(j.done)return;j.done=true;j.el.innerHTML=(j.text?esc(j.text)+'<br>':'')+`<span style="color:#ffb4a8">A IA falhou: ${esc(aiMessage(row.error))}</span>`;}
function renderChatRow(row){if(chatSeen.has(row.id))return;chatSeen.add(row.id);
  if(row.role==='user'){addMsg(esc(row.content),'me');const job=conn.db.myAiJob.id.find(row.jobId);if(job&&(job.status==='pending'||job.status==='running'))chatJob(row.jobId);else if(job)chatJobChanged(job);return;}
  const j=chatJob(row.jobId);j.done=true;j.el.innerHTML=esc(row.content);
  let props=[];try{props=JSON.parse(row.proposals);}catch(_){}const cards=props.map(p=>log.appendChild(proposalCard(p)));log.scrollTop=log.scrollHeight;
  const i=chatLive?cards.findIndex(c=>!c.classList.contains('done')):-1;if(i>=0)showDraft(props[i],cards[i]);}
/* Rascunho da proposta: as cenas novas aparecem tracejadas no canvas, onde vão cair, sem entrar no grafo. */
const draftsEl=$('#drafts');let draft=null; // {p, card, plan}
// Saída de onde a proposta parte e as cenas novas com posição: lado a lado, num espaço livre.
function proposalPlan(p){const ns=p.ops.filter(o=>o.op==='upsert_scene'&&!scene(o.scene.id)).map(o=>o.scene);if(!ns.length)return null;
  const link=p.ops.find(o=>o.op==='upsert_choice'&&o.choice.target===ns[0].id);if(!link)return null;
  const made=p.ops.find(o=>o.op==='upsert_choice'&&o.choice.id===link.choice.id&&o.choice.sceneId);
  // Ação nova numa cena final: o fio sai da saída única dela.
  const sid=made?made.choice.sceneId:state.scenes.find(s=>s.choices.some(c=>c.id===link.choice.id))?.id,ch=made?'':link.choice.id;
  const src=sid&&scene(sid);if(!src)return null;
  const at=freeSpot(outPos(sid,ch)||{x:src.x+300,y:src.y+200},ns.length);
  return{sid,ch,scenes:ns.map((s,i)=>({...s,x:Math.round(at.x+340*i),y:Math.round(at.y)}))};}
function draftHTML(s,i,n){let chars=[];try{chars=JSON.parse(s.chars||'[]');}catch(_){}
  const spk=s.kind==='dialogue'?charById(s.speaker):null;
  const sum=s.text?`${spk?`<span class="who" style="color:${spk.color||'var(--text)'}">${esc(spk.name)}</span>`:''}<span class="${spk?'':'narr'}">${esc(s.text)}</span>`:'<span class="none">sem texto</span>';
  return`<div class="node dnode" style="left:${s.x}px;top:${s.y}px;animation-delay:${i*90}ms"><div class="nhead"><span class="port in"></span><span class="dtitle">${esc(s.title)}</span><span class="tag ai">${SPARK}rascunho</span>${i<n-1?'<span class="port out"></span>':''}</div><div class="mid"><div class="sec">${stageMini({...s,chars})}<div class="sum">${sum}</div></div></div></div>`;}
function draftWires(){if(!draft)return'';const ins=[...draftsEl.querySelectorAll('.port.in')].map(centerOf),outs=[...draftsEl.querySelectorAll('.port.out')].map(centerOf);
  const pairs=[[outPos(draft.plan.sid,draft.plan.ch),ins[0]],...outs.map((a,i)=>[a,ins[i+1]])];
  return pairs.filter(([a,b])=>a&&b).map(([a,b])=>`<path class="wpath" d="${curve(a,b)}" style="stroke:#a78bfa;stroke-width:2.5px;stroke-dasharray:8 6;opacity:.85"/>`).join('');}
function draftBtn(card,on){card.classList.toggle('previewing',on);const b=card.querySelector('[data-draft]');if(b)b.textContent=on?'Ocultar do canvas':'Ver no canvas';}
function clearDraft(){if(!draft)return;draftBtn(draft.card,false);draft=null;draftsEl.innerHTML='';dirty=true;}
function showDraft(p,card){clearDraft();const plan=proposalPlan(p);if(!plan){toast('A proposta não vale mais: a saída de origem mudou.','err');return;}
  draft={p,card,plan};draftBtn(card,true);draftsEl.innerHTML=plan.scenes.map((s,i)=>draftHTML(s,i,plan.scenes.length)).join('');dirty=true;
  focusAt(plan.scenes[0].x,plan.scenes[0].y);}
function proposalCard(p){const card=document.createElement('div');card.className='proposal';
  const newScene=p.ops.find(o=>o.op==='upsert_scene')?.scene.id;const done=newScene&&scene(newScene);
  card.innerHTML=`<h3>${SPARK}proposta · 1 passo de desfazer</h3><ul>${p.summary.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><div class="row">${done?'<span class="hint">Aceita</span>':'<button class="btn sm violet solid" data-ok>Aceitar</button><button class="btn sm" data-no>Recusar</button><button class="btn sm" data-draft>Ver no canvas</button>'}</div>`;
  if(done)card.classList.add('done');
  card.querySelector('[data-ok]')?.addEventListener('click',()=>{if(acceptProposal(p)){card.classList.add('done');card.querySelector('.row').innerHTML='<span class="hint">Aceita · Ctrl+Z desfaz tudo de uma vez</span>';}});
  card.querySelector('[data-draft]')?.addEventListener('click',()=>{if(draft&&draft.card===card)clearDraft();else showDraft(p,card);});
  card.querySelector('[data-no]')?.addEventListener('click',()=>{if(draft&&draft.card===card)clearDraft();card.classList.add('done');card.querySelector('.row').innerHTML='<span class="hint">Recusada</span>';});
  return card;}
// Aceitar valida contra o estado atual, que pode ter mudado desde a proposta.
function acceptProposal(p){const f=flatOf(state);const ops=JSON.parse(JSON.stringify(p.ops));
  // As cenas caem onde o rascunho mostrou; sem rascunho na tela, o lugar é calculado agora.
  const plan=draft&&draft.p===p?draft.plan:proposalPlan(p);if(draft&&draft.p===p)clearDraft();
  // Confere em ordem, como o reducer: uma operação pode usar a ação criada pela anterior.
  const work=cloneFlat(f);
  for(const o of ops){if(o.op==='upsert_choice'){const c=o.choice;const sid=c.sceneId??work.choices.get(c.id)?.sceneId;
      if(!sid||!work.scenes.has(sid)){toast('A proposta não vale mais: a cena de origem foi apagada.','err');return false;}
      const cur=f.choices.get(c.id);if(cur&&cur.target&&c.target&&cur.target!==c.target&&f.scenes.has(cur.target)){toast('A proposta não vale mais: essa ação já foi ligada a outra cena.','err');return false;}}
    applyOps(work,[o]);}
  const sop=ops.find(o=>o.op==='upsert_scene'&&!f.scenes.has(o.scene.id));
  for(const o of ops){const d=o.op==='upsert_scene'&&plan?.scenes.find(x=>x.id===o.scene.id);if(d){o.scene.x=d.x;o.scene.y=d.y;}}
  pushUndo();applyOps(f,ops);writeFlat(f);
  if(sop){const ns=scene(sop.scene.id);if(ns){ns.ai=true;fresh.set(ns.id,{t0:performance.now(),cls:'pop-ai'});reveal.set(ns.id,performance.now());setTimeout(()=>reveal.delete(ns.id),1700);setTimeout(()=>{const t=scene(ns.id);if(t){t.ai=false;refresh();}},2600);}}
  refresh();if(sop){ensureVisible(sop.scene.id);const n=scene(sop.scene.id);if(n)burst(n.x,n.y+20,'ai');shake();}return true;}
$('#chatForm').onsubmit=e=>{e.preventDefault();const t=$('#chatInput').value.trim();if(!t)return;if(!connected){toast('Sem conexão com o servidor.','err');return;}
  const btn=$('#chatForm button[type=submit]');btn.disabled=true;
  requestAi('chat',{message:t,context:aiContext()}).then(()=>{$('#chatInput').value='';},err=>toast('A IA não recebeu o pedido: '+aiMessage(err),'err')).finally(()=>{btn.disabled=false;});};
$('#chatClear').onclick=()=>{if(!connected){toast('Sem conexão com o servidor.','err');return;}
  if(!confirm('Limpar a conversa com o assistente? As propostas ainda não aceitas somem.'))return;
  conn.reducers.clearChat({}).then(()=>{
    for(const j of conn.db.myAiJob.iter())if(j.kind==='chat'&&(j.status==='pending'||j.status==='running'))chatDropped.add(j.id);
    clearDraft();chatJobs.clear();chatSeen.clear();log.replaceChildren();greet();
  },err=>toast('Não foi possível limpar o chat: '+aiMessage(err),'err'));};
$('#chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chatForm').requestSubmit();}});

/* ---------- play mode ---------- */
let play=null;
function openPlay(from){const st=from||state.start;if(!scene(st)){toast('Defina uma cena inicial.','err');return;}const el=document.createElement('div');el.className='play';document.body.appendChild(el);play={el,cur:st,hist:[],from:st};drawPlay();}
function closePlay(){if(play){clearInterval(play.iv);play.el.remove();play=null;}}
function go(t){if(!t){toast('Esta ação não tem destino (rascunho). No player público ela fica oculta.','err');return;}play.hist.push(play.cur);play.cur=t;drawPlay();}
function drawPlay(){clearInterval(play.iv);const s=scene(play.cur);const n=s.chars.length,pos=SLOTS[n]||[];const bg=bgById(s.bg);const w=n>3?Math.max(18,100/n*1.25):30;
  const chars=s.chars.map((cc,i)=>{const c=charById(cc.c),sp=spriteOf(c,cc.s);return sp?`<img class="schar" style="left:${pos[i]}%;max-width:${w}%;animation-delay:${i*90}ms" src="${sp.img}" alt="${esc(c.name)} (${esc(sp.name)})">`:''}).join('');
  const spk=s.kind==='dialogue'?charById(s.speaker):null;
  const box=s.text?(spk?`<div class="tbox dialogue"><div class="nametag" style="color:${spk.color||'var(--text)'}">${esc(spk.name)}</div><span data-t></span><span class="tcaret"></span></div>`:`<div class="tbox narration"><span><span data-t></span><span class="tcaret"></span></span></div>`):'';
  play.el.innerHTML=`<div class="phead"><span>${esc(state.title)} · ${esc(s.title)}</span><span class="grow"></span><button class="pbtn" data-back ${play.hist.length?'':'disabled'}>Voltar</button><button class="pbtn" data-restart>Reiniciar</button><button class="pbtn" data-exit>Voltar ao editor</button></div><div class="stage"><div class="pic">${bg?`<img class="bgimg" src="${bg.img}" alt="${esc(bg.name)}">`:''}${chars}</div>${box}<div data-after></div></div>`;
  const after=()=>{const host=play.el.querySelector('[data-after]');const cr=play.el.querySelector('.tcaret');if(cr)cr.remove();let h='';
    if(s.choices.length)h=`<div class="pchoices">${s.choices.map((c,i)=>`<button class="pchoice" data-go="${c.target||''}" ${c.target?'':'title="Ação sem destino"'} style="animation-delay:${i*80}ms"><span class="pnum">${i+1}</span>${esc(c.label||'(ação sem texto)')}${c.target?'':' <span class="mono" style="color:#ffc98a;font-size:12px">· sem destino</span>'}</button>`).join('')}</div>`;
    else if(s.next)h=`<div class="pcont"><button class="pbtn" data-go="${s.next}" style="background:rgba(28,29,33,.94)">Continuar ▸</button></div>`;
    else h=`<div class="pend"><div><span>— fim —</span><button class="btn primary" data-restart>Recomeçar</button></div></div>`;
    host.innerHTML=h;};
  const tEl=play.el.querySelector('[data-t]');
  if(tEl&&!reduced){let i=0;const full=s.text;play.skip=()=>{clearInterval(play.iv);tEl.textContent=full;play.skip=null;after();};play.iv=setInterval(()=>{i+=2;tEl.textContent=full.slice(0,i);if(i>=full.length)play.skip();},22);}
  else{if(tEl)tEl.textContent=s.text;play.skip=null;after();}
  play.el.onclick=e=>{const b=e.target.closest('button');if(!b){if(play.skip&&e.target.closest('.stage'))play.skip();return;}if(b.hasAttribute('data-go'))go(b.dataset.go);else if(b.hasAttribute('data-back')){play.cur=play.hist.pop();drawPlay();}else if(b.hasAttribute('data-restart')){play.hist=[];play.cur=play.from;drawPlay();}else if(b.hasAttribute('data-exit'))closePlay();};}

/* ---------- tempo real (SpacetimeDB) ----------
   O grafo local é sempre: servidor ⊕ lotes em voo ⊕ edições ainda não enviadas.
   `base` = servidor ⊕ lotes em voo; o que o usuário mudou é diff(base, local).
   Personagens e backgrounds ficam só no cliente neste spike. */
const STDB_URI=import.meta.env.VITE_STDB_URI||'ws://localhost:3000';
const STDB_DB=import.meta.env.VITE_STDB_DB||'roteiro-spike';
const TOKEN_KEY='stdb-token:'+STDB_URI+'/'+STDB_DB; // o token de um servidor não vale em outro
const WHERE=/localhost|127\.0\.0\.1/.test(STDB_URI)?'local':'Maincloud';
let conn=null,myId=null,myConn=null,connected=false,ready=false,resetting=false;
let base=null;const inflight=[];let retryOps=[];

const emptyFlat=()=>({title:'',start:'',scenes:new Map,choices:new Map});
const cloneFlat=f=>({title:f.title,start:f.start,scenes:new Map([...f.scenes].map(([k,v])=>[k,{...v}])),choices:new Map([...f.choices].map(([k,v])=>[k,{...v}]))});
function flatOf(st){const f=emptyFlat();f.title=st.title;f.start=st.start||'';
  for(const s of st.scenes){f.scenes.set(s.id,{title:s.title,x:Math.round(s.x),y:Math.round(s.y),bg:s.bg||'',chars:JSON.stringify(s.chars.map(x=>({c:x.c,s:x.s}))),kind:s.kind,speaker:s.speaker||'',text:s.text,next:s.next||'',ai:gens.has(s.id)?'generating':(s.aiStatus==='failed'&&s.text?'':(s.aiStatus||''))});
    s.choices.forEach((c,i)=>f.choices.set(c.id,{sceneId:s.id,label:c.label,target:c.target||'',position:i}));}
  return f;}
function flatServer(){const f=emptyFlat();const st=[...conn.db.story.iter()].find(r=>r.id==='main');f.exists=!!st;if(st){f.title=st.title;f.start=st.startScene;}
  for(const r of conn.db.scene.iter())f.scenes.set(r.id,{title:r.title,x:r.x,y:r.y,bg:r.bg,chars:r.chars,kind:r.kind,speaker:r.speaker,text:r.text,next:r.next,ai:r.ai});
  for(const r of conn.db.choice.iter())f.choices.set(r.id,{sceneId:r.sceneId,label:r.label,target:r.target,position:r.position});
  return f;}
// Mesma semântica do reducer: valores finais, campos parciais, seguro de repetir.
function applyOps(f,ops){for(const o of ops){
  if(o.op==='upsert_scene'){const{id,...rest}=o.scene;f.scenes.set(id,{...(f.scenes.get(id)||{title:'Nova cena',x:0,y:0,bg:'',chars:'[]',kind:'narration',speaker:'',text:'',next:'',ai:''}),...rest});}
  else if(o.op==='delete_scene'){if(!f.scenes.has(o.id))continue;f.scenes.delete(o.id);
    for(const[k,c]of f.choices){if(c.sceneId===o.id)f.choices.delete(k);else if(c.target===o.id)f.choices.set(k,{...c,target:''});}
    for(const[k,s]of f.scenes)if(s.next===o.id)f.scenes.set(k,{...s,next:''});}
  else if(o.op==='upsert_choice'){const{id,...rest}=o.choice;f.choices.set(id,{...(f.choices.get(id)||{sceneId:'',label:'',target:'',position:0}),...rest});}
  else if(o.op==='delete_choice')f.choices.delete(o.id);
  else if(o.op==='set_start')f.start=o.id;
  else if(o.op==='set_title')f.title=o.title;}
  return f;}
function diffFlat(a,b,skipPos){const ups=[],cups=[],cdel=[],sdel=[],meta=[];
  for(const[id,s]of b.scenes){const o=a.scenes.get(id);if(!o){ups.push({op:'upsert_scene',scene:{id,...s}});continue;}
    const ch={};for(const k in s){if(skipPos&&skipPos.has(id)&&(k==='x'||k==='y'))continue;if(s[k]!==o[k])ch[k]=s[k];}
    if(Object.keys(ch).length)ups.push({op:'upsert_scene',scene:{id,...ch}});}
  for(const[id,c]of b.choices){const o=a.choices.get(id);if(!o){cups.push({op:'upsert_choice',choice:{id,...c}});continue;}
    const ch={};for(const k in c)if(c[k]!==o[k])ch[k]=c[k];if(Object.keys(ch).length)cups.push({op:'upsert_choice',choice:{id,...ch}});}
  for(const[id,c]of a.choices)if(!b.choices.has(id)&&b.scenes.has(c.sceneId))cdel.push({op:'delete_choice',id});
  for(const id of a.scenes.keys())if(!b.scenes.has(id))sdel.push({op:'delete_scene',id});
  if(b.start&&a.start!==b.start)meta.push({op:'set_start',id:b.start});
  if(a.title!==b.title)meta.push({op:'set_title',title:b.title});
  return[...ups,...cups,...cdel,...meta,...sdel];}
function touchKeys(o,f){if(o.op==='upsert_scene')return['s:'+o.scene.id];if(o.op==='upsert_choice')return['c:'+o.choice.id];if(o.op==='delete_choice')return['c:'+o.id];
  if(o.op==='delete_scene')return['s:'+o.id,...[...f.choices].filter(([,c])=>c.sceneId===o.id).map(([k])=>'c:'+k)];return[o.op==='set_title'?'title':'start'];}
// Escreve um grafo no estado do demo sem trocar os objetos (arrasto, IA e menus guardam referências).
function writeFlat(f){state.title=f.title;state.start=f.start;
  const per=new Map;for(const[id,c]of f.choices){if(!per.has(c.sceneId))per.set(c.sceneId,[]);per.get(c.sceneId).push([id,c]);}
  const byId=new Map(state.scenes.map(s=>[s.id,s]));const order=[...state.scenes.map(s=>s.id).filter(id=>f.scenes.has(id)),...[...f.scenes.keys()].filter(id=>!byId.has(id))];
  state.scenes=order.map(id=>{const v=f.scenes.get(id);let s=byId.get(id);
    if(!s){s={id,choices:[],next:null};if(ready)fresh.set(id,{t0:performance.now(),cls:v.ai==='generating'?'pop-ai':'pop'});}
    Object.assign(s,{title:v.title,x:v.x,y:v.y,bg:v.bg||null,kind:v.kind,speaker:v.speaker||null,text:v.text,next:v.next||null});
    try{s.chars=JSON.parse(v.chars);}catch(_){s.chars=[];}
    if(!gens.has(id))s.aiStatus=v.ai;
    const old=new Map(s.choices.map(c=>[c.id,c]));
    s.choices=(per.get(id)||[]).sort((a,b)=>a[1].position-b[1].position).map(([cid,c])=>{const o=old.get(cid)||{id:cid};if(!o.gen)o.label=c.label;o.target=c.target||null;return o;});
    return s;});}

/* envio */
let syncQueued=false,syncTimer=0;
function scheduleSync(){if(syncQueued)return;syncQueued=true;queueMicrotask(()=>{syncQueued=false;syncNow();});}
function syncSoon(){clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,800);}
function syncNow(){if(!base||!connected||resetting)return;const skip=drag&&drag.type==='move'?new Set(drag.orig.map(o=>o.s.id)):null;
  const ops=diffFlat(base,flatOf(state),skip);if(!ops.length)return;
  const touched=typingTouched||collector;for(const o of ops)touchKeys(o,base).forEach(k=>touched.add(k));
  applyOps(base,ops);const b={ops,t0:performance.now()};inflight.push(b);
  conn.reducers.applyOperations({ops:JSON.stringify(ops)}).then(()=>{rtt.add('op',performance.now()-b.t0);settle(b);},err=>{settle(b);rejected(err,ops);});}
function settle(b){const i=inflight.indexOf(b);if(i>=0)inflight.splice(i,1);scheduleRebuild();}
const ERRS={CYCLE:'Essa ligação fecharia um ciclo. Alguém pode ter criado o outro fio agora há pouco.',LOCKED:'Outra pessoa está escrevendo nesse campo.',START:'A cena inicial não pode ser excluída.',NO_START:'A história ficaria sem cena inicial.',BOTH:'Uma cena não pode ter ações e saída única ao mesmo tempo.',NOT_FOUND:'Essa cena foi apagada por outra pessoa.',TOO_MANY:'Uma cena tem no máximo 6 personagens.',DUP_CHAR:'Esse personagem já está na cena.',SPEAKER:'Quem fala precisa estar na cena.',INVALID:'Alteração inválida.'};
function rejected(err,ops){const m=String(err&&err.message||err);const code=(m.match(/\b(CYCLE|LOCKED|START|NO_START|BOTH|NOT_FOUND|TOO_MANY|DUP_CHAR|SPEAKER|INVALID)\b(?::\d+(?::([\w-]+))?)?/)||[]);
  if(code[1]){toast('Recusado pelo servidor: '+ERRS[code[1]],'err');if(code[2]&&scene(code[2]))nodeShake(code[2]);else shake();return;}
  // Queda de conexão: o lote pode ou não ter sido aplicado; como é seguro repetir, reenviamos depois.
  retryOps.push(ops);toast('Sem conexão — a alteração será reenviada ao reconectar.','err');}

/* recebimento */
let rebuildQueued=false;
// setTimeout, não requestAnimationFrame: abas em segundo plano não recebem frames e ficariam desatualizadas.
function scheduleRebuild(){if(rebuildQueued)return;rebuildQueued=true;setTimeout(()=>{rebuildQueued=false;rebuild();},0);}
function rebuild(){if(!conn||!ready)return;const srv=flatServer();
  const unsent=base&&!resetting?diffFlat(base,flatOf(state),null):[];
  for(const b of inflight)applyOps(srv,b.ops);
  const local=cloneFlat(srv);for(const ops of retryOps)applyOps(local,ops);applyOps(local,unsent);
  const hadRetry=retryOps.length>0;retryOps=[];base=srv;writeFlat(local);renderNodes();
  if(document.activeElement!==$('#storyTitle'))$('#storyTitle').value=state.title;
  if(hadRetry&&connected)scheduleSync();}

function resetDemo(){if(!conn||!connected)return;resetting=true;undoS.length=0;redoS.length=0;syncUndo();gens.clear();lit.clear();
  const ops=diffFlat(emptyFlat(),flatOf(SEED),null).filter(o=>o.op!=='set_title'&&o.op!=='set_start');
  const t0=performance.now();
  conn.reducers.resetStory({title:SEED.title,startScene:SEED.start,ops:JSON.stringify(ops)}).then(()=>{rtt.add('op',performance.now()-t0);resetting=false;base=null;state.scenes=[];rebuild();requestAnimationFrame(fitView);toast('História de exemplo restaurada');},err=>{resetting=false;toast('Falha ao reiniciar: '+(err&&err.message||err),'err');});}

/* latência */
const rtt={op:[],ping:[],add(k,v){const a=this[k];a.push(v);if(a.length>200)a.shift();renderNet();}};
const pct=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return Math.round(s[Math.min(s.length-1,Math.floor(p*s.length))]);};
setInterval(()=>{if(!connected)return;const t0=performance.now();conn.reducers.ping({}).then(()=>rtt.add('ping',performance.now()-t0),()=>{});},2000);

/* presença, cursores e arrasto ao vivo */
const NAMES=['Ana','Bruno','Carla','Diego','Elisa','Fábio','Gabi','Heitor','Iara','João','Lara','Miguel'];
const COLORS=['#f2a541','#5eead4','#a78bfa','#f472b6','#60a5fa','#4ade80','#fb7185','#facc15'];
let me={name:sessionStorage.getItem('vn-name')||pick(NAMES),color:sessionStorage.getItem('vn-color')||pick(COLORS)};
sessionStorage.setItem('vn-name',me.name);sessionStorage.setItem('vn-color',me.color);
const hex=id=>id.toHexString();
function profOf(identity){const p=conn&&[...conn.db.profile.iter()].find(r=>r.identity.isEqual(identity));return p?{name:p.name,color:p.color}:{name:'Alguém',color:'#9aa0aa'};}
const isMine=cid=>myConn&&cid.isEqual(myConn);
function lockOf(target){if(!conn)return null;for(const l of conn.db.locks.iter())if(l.target===target)return isMine(l.connectionId)?null:profOf(l.identity);return null;}
function lockBadge(p){return`<div class="lockbadge" style="--lc:${p.color}" role="status"><span class="ldot"></span>${esc(p.name)} está escrevendo…</div>`;}

let lastDrag=0;
function sendDrag(orig,done){if(!connected)return;const now=performance.now();if(!done&&now-lastDrag<50)return;lastDrag=now;
  conn.reducers.sendDrag({moves:JSON.stringify(orig.map(o=>[o.s.id,o.s.x,o.s.y])),done}).catch(()=>{});}
function onRemoteDrag(row){if(isMine(row.connectionId))return;let moves;try{moves=JSON.parse(row.moves);}catch(_){return;}const p=profOf(row.identity);const now=performance.now();
  for(const[id,x,y]of moves){const s=scene(id);if(!s)continue;let r=remoteDrag.get(id);
    if(!r){r={x:s.x,y:dispY(s),color:p.color,name:p.name};remoteDrag.set(id,r);const el=nodeEl(id);if(el){el.classList.add('rdrag');el.style.setProperty('--rc',p.color);el.dataset.who=p.name;}}
    Object.assign(r,{tx:x,ty:y,seen:now,done:row.done});}
  dirty=true;}
const cursors=new Map;let cursorLayer=null;
// Suavização pelo tempo real entre quadros (não por quadro), para não depender do fps.
let lastStep=0;
function stepRemote(now){const dt=Math.min(250,lastStep?now-lastStep:16);lastStep=now;const k=1-Math.exp(-dt/60);
  for(const[id,r]of remoteDrag){const s=scene(id);r.x+=(r.tx-r.x)*k;r.y+=(r.ty-r.y)*k;
    if(r.done&&now-r.seen>400){r.x=r.tx;r.y=r.ty;}
    const settled=Math.abs(r.x-r.tx)<.5&&Math.abs(r.y-r.ty)<.5;
    const landed=r.done&&settled&&(!s||(Math.abs(s.x-r.tx)<1&&Math.abs(s.y-r.ty)<1)||now-r.seen>1500);
    const el=nodeEl(id);
    if(!s||landed||(!r.done&&now-r.seen>2000)){remoteDrag.delete(id);if(el){el.classList.remove('rdrag');el.style.left=(s?s.x:0)+'px';el.style.top=(s?dispY(s):0)+'px';}continue;}
    if(el){el.style.left=r.x+'px';el.style.top=r.y+'px';if(!el.classList.contains('rdrag')){el.classList.add('rdrag');el.style.setProperty('--rc',r.color);el.dataset.who=r.name;}}}
  for(const c of cursors.values()){c.x+=(c.tx-c.x)*k;c.y+=(c.ty-c.y)*k;c.el.style.transform=`translate(${c.x}px,${c.y}px) scale(${1/view.z})`;}}
function syncCursors(){if(!conn)return;if(!cursorLayer){cursorLayer=document.createElement('div');cursorLayer.className='rcursors';world.appendChild(cursorLayer);}
  const live=new Set;
  for(const p of conn.db.presence.iter()){const key=p.connectionId.toHexString();if(isMine(p.connectionId)||!p.hasCursor)continue;live.add(key);const pr=profOf(p.identity);let c=cursors.get(key);
    if(!c){const el=document.createElement('div');el.className='rcursor';cursorLayer.appendChild(el);c={el,x:p.cursorX,y:p.cursorY};cursors.set(key,c);}
    c.tx=p.cursorX;c.ty=p.cursorY;c.el.style.setProperty('--cc',pr.color);c.el.innerHTML=`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1l5.5 13 2-5.5L14 6.5z"/></svg><span>${esc(pr.name)}</span>`;}
  for(const[k,c]of cursors)if(!live.has(k)){c.el.remove();cursors.delete(k);}}
function renderPeople(){const host=$('#people');if(!host||!conn)return;const seen=new Map;
  for(const p of conn.db.presence.iter()){const h=hex(p.identity);if(!seen.has(h))seen.set(h,{p,mine:myId&&p.identity.isEqual(myId)});}
  const list=[...seen.values()].sort((a,b)=>b.mine-a.mine);
  host.innerHTML=list.map(({p,mine})=>{const pr=profOf(p.identity);return`<button class="pav${mine?' me':''}" data-conn="${p.connectionId.toHexString()}" style="--pc:${pr.color}" title="${esc(pr.name)}${mine?' (você) — clique para trocar o nome':' — clique para ir até o cursor'}">${esc(pr.name.slice(0,1).toUpperCase())}</button>`;}).join('')+`<span class="pcount">${list.length} na história</span>`;}
document.addEventListener('click',e=>{const b=e.target.closest('.pav');if(!b)return;
  if(b.classList.contains('me')){const n=prompt('Seu nome nesta aba:',me.name);if(n&&n.trim()){me.name=n.trim().slice(0,40);sessionStorage.setItem('vn-name',me.name);conn.reducers.setProfile({name:me.name,color:me.color});}return;}
  const c=cursors.get(b.dataset.conn);if(!c)return;const r=canvas.getBoundingClientRect();view.x=r.width/2-c.tx*view.z;view.y=r.height/2-c.ty*view.z;applyView();});
let lastCur=0;
canvas.addEventListener('pointermove',e=>{if(!connected)return;const now=performance.now();if(now-lastCur<50)return;lastCur=now;const p=toWorld(e.clientX,e.clientY);conn.reducers.updateCursor({x:p.x,y:p.y,visible:true}).catch(()=>{});});
canvas.addEventListener('pointerleave',()=>{if(connected)conn.reducers.updateCursor({x:0,y:0,visible:false}).catch(()=>{});});

/* trava suave de texto */
let curLock=null;
function fieldTarget(el){if(!el||!el.matches)return null;if(el.id==='storyTitle')return'story:title';const n=el.closest('.node');if(!n)return null;const a=el.dataset.act;
  if(a==='title'||a==='text')return`scene:${n.dataset.id}:${a}`;if(a==='clabel'){const c=scene(n.dataset.id)?.choices[+el.dataset.i];return c?`choice:${c.id}:label`:null;}return null;}
function takeFieldLock(el){const t=fieldTarget(el);if(!t||!connected||(curLock&&curLock.target===t))return;if(curLock)releaseLock();curLock={target:t};
  conn.reducers.lockField({target:t}).catch(err=>{if(!/LOCKED/.test(String(err&&err.message||err)))return;if(curLock&&curLock.target===t)curLock=null;const who=lockOf(t);toast(`${who?who.name:'Outra pessoa'} está escrevendo neste campo.`,'err');if(fieldTarget(document.activeElement)===t)document.activeElement.blur();});}
function releaseLock(){if(!curLock)return;const t=curLock.target;curLock=null;if(connected)conn.reducers.releaseField({target:t}).catch(()=>{});}
// Um re-render troca o elemento focado; só solta a trava se o foco saiu mesmo do campo.
function dropFieldLock(el){const t=curLock&&curLock.target;setTimeout(()=>{if(t&&fieldTarget(document.activeElement)!==t){if(pendingSnap)endTyping();if(curLock&&curLock.target===t)releaseLock();}},0);}
setInterval(()=>{if(!curLock||!connected)return;if(fieldTarget(document.activeElement)===curLock.target)conn.reducers.renewFieldLock({target:curLock.target}).catch(()=>{});else releaseLock();},5000);

/* HUD: presença, rede e reinício */
const hud=$('.hud');hud.insertAdjacentHTML('afterbegin','<div class="people" id="people"></div>');
$('#stats').insertAdjacentHTML('beforebegin','<button class="chip net" id="net" title="Ida e volta até o SpacetimeDB">conectando…</button>');
$('#btnAddScene').insertAdjacentHTML('beforebegin','<button class="zbtn" id="btnReset" title="Apaga tudo e recria a história de exemplo para todos">↺ demo</button><span class="zsep"></span>');
$('#btnReset').onclick=()=>{if(confirm('Apagar tudo e recriar a história de exemplo para todos que estão conectados?'))resetDemo();};
document.body.insertAdjacentHTML('beforeend','<div class="netbanner" id="netbanner" role="status" hidden></div>');
let netState='connecting',retryIn=0;
function renderNet(){const el=$('#net');if(!el)return;const p50=pct(rtt.ping,.5),p95=pct(rtt.ping,.95),o50=pct(rtt.op,.5),o95=pct(rtt.op,.95);
  el.className='chip net '+netState;
  el.innerHTML=netState==='on'?`<span class="ndot"></span>${WHERE} · ping ${p50??'–'} ms <span class="dim">p95 ${p95??'–'}</span> · ações ${o50??'–'} ms <span class="dim">p95 ${o95??'–'} (n=${rtt.op.length})</span>`:netState==='off'?'<span class="ndot"></span>sem conexão':'<span class="ndot"></span>conectando…';
  const b=$('#netbanner');b.hidden=netState==='on'||netState==='connecting';b.textContent=netState==='err'?`Não foi possível conectar a ${STDB_URI} (banco ${STDB_DB}).`:`Sem conexão — reconectando${retryIn?` em ${Math.ceil(retryIn/1000)} s`:''}…`;
  appEl.classList.toggle('offline',netState!=='on');}
$('#net').onclick=()=>{const all=rtt.op;toast(`Ações confirmadas: ${all.length} · p50 ${pct(all,.5)??'–'} ms · p95 ${pct(all,.95)??'–'} ms · máx ${all.length?Math.round(Math.max(...all)):'–'} ms. Meta da especificação: p95 ≤ 300 ms.`);};

function onReady(){ready=true;const srv=flatServer();if(!srv.exists){resetDemo();return;}base=null;rebuild();renderPeople();syncCursors();requestAnimationFrame(fitView);
  // Conversa salva no servidor: volta ao recarregar a aba (mesma identidade).
  [...conn.db.myChatMessage.iter()].sort((a,b)=>Number(a.createdAt.microsSinceUnixEpoch-b.createdAt.microsSinceUnixEpoch)||(a.role==='user'?-1:1)).forEach(renderChatRow);chatLive=true;}
function connect(){
  conn=DbConnection.builder().withUri(STDB_URI).withDatabaseName(STDB_DB).withToken(sessionStorage.getItem(TOKEN_KEY)||undefined).withAutomaticReconnect()
    .onConnect((c,identity,token)=>{sessionStorage.setItem(TOKEN_KEY,token);myId=identity;myConn=c.connectionId;connected=true;netState='on';renderNet();
      c.reducers.setProfile({name:me.name,color:me.color}).catch(()=>{});
      const re=()=>scheduleRebuild();
      for(const t of[c.db.story,c.db.scene,c.db.choice]){t.onInsert(re);t.onUpdate(re);t.onDelete(re);}
      c.db.scene.onDelete((ctx,row)=>{const s=scene(row.id);if(s&&(expanded===row.id||nodeEl(row.id)?.contains(document.activeElement))&&!inflight.some(b=>b.ops.some(o=>o.op==='delete_scene'&&o.id===row.id)))toast(`A cena “${row.title}” foi apagada por outra pessoa.${s.text?' Seu texto: “'+s.text.slice(0,120)+'”':''}`,'err');});
      const rl=()=>renderNodes();c.db.locks.onInsert(rl);c.db.locks.onUpdate(rl);c.db.locks.onDelete(rl);
      const pp=()=>{renderPeople();syncCursors();};for(const t of[c.db.presence,c.db.profile]){t.onInsert(pp);t.onUpdate(pp);t.onDelete(pp);}
      c.db.profile.onUpdate(()=>renderNodes());
      c.db.drags.onInsert((_ctx,row)=>onRemoteDrag(row));
      c.db.chatChunk.onInsert((_ctx,row)=>onChatChunk(row));
      c.db.myAiJob.onInsert((_ctx,row)=>onJobRow(row));c.db.myAiJob.onUpdate((_ctx,_old,row)=>onJobRow(row));
      c.db.myChatMessage.onInsert((_ctx,row)=>{if(ready)renderChatRow(row);});
      c.subscriptionBuilder().onApplied(onReady).onError((_ctx,err)=>toast('Erro na assinatura: '+(err&&err.message||err),'err')).subscribe(['SELECT * FROM story','SELECT * FROM scene','SELECT * FROM choice','SELECT * FROM profile','SELECT * FROM presence','SELECT * FROM drags','SELECT * FROM locks',
        'SELECT * FROM my_ai_job','SELECT * FROM my_chat_message','SELECT * FROM chat_chunk WHERE requester = :sender']);})
    .onAutomaticReconnect((c,identity,token)=>{sessionStorage.setItem(TOKEN_KEY,token);myId=identity;myConn=c.connectionId;connected=true;netState='on';renderNet();curLock=null;scheduleRebuild();scheduleSync();})
    .onDisconnect((_ctx,_err,attempt,delayMs)=>{connected=false;netState='off';retryIn=attempt===undefined?0:delayMs||0;renderNet();})
    .onConnectError((_ctx,err)=>{connected=false;netState='err';renderNet();console.error(err);})
    .build();}

/* ---------- boot ---------- */
applyView();renderAll();renderNet();requestAnimationFrame(loop);connect();
if(touchUI){let seen=false;try{seen=!!localStorage.getItem('roteiro:dica-toque');localStorage.setItem('roteiro:dica-toque','1');}catch(_){}
  if(!seen)setTimeout(()=>toast('Dica: segure uma saída ou “+ ação” para a IA criar. Arraste com um dedo para mover a tela, dois para zoom.','ai'),1200);}
// Só em desenvolvimento: acesso para testes pelo console.
if(import.meta.env.DEV)window.__spike={get conn(){return conn;},state,rtt,scene,inflight,refresh,pushUndo,undo,stepRemote,remoteDrag};
