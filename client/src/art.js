// Desenhos do elenco da história de exemplo e do marketplace (SVG). Viram arquivos estáticos em
// client/public/example/ (npm run example-art); o banco guarda só o link (image_key example/…).
export const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
export function emotionKind(name,desc){const t=norm(name+' '+desc);
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
export function spriteArt(look,emotionName,emotionDesc){const k=emotionKind(emotionName,emotionDesc),{hair,skin,outfit,style}=look;
  const longHair=style==='long'?`<path d="M42 100c-4 60 6 95 22 110h72c16-15 26-50 22-110z" fill="${hair}"/>`:'';
  const beard=style==='beard'?`<path d="M56 120c4 40 22 52 44 52s40-12 44-52c-10 18-26 22-44 22s-34-4-44-22z" fill="${hair}"/>`:'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">${longHair}<ellipse cx="100" cy="92" rx="60" ry="64" fill="${hair}"/><path d="M28 300c0-70 30-102 72-102s72 32 72 102z" fill="${outfit}"/><path d="M70 205l30 30 30-30" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="5"/><rect x="88" y="150" width="24" height="52" rx="8" fill="${skin}"/><ellipse cx="100" cy="108" rx="47" ry="55" fill="${skin}"/>${beard}<path d="M50 98c2-48 98-48 100 0-20-22-80-22-100 0z" fill="${hair}"/>${face(k)}</svg>`;
  return svg;}
export function lookFrom(desc,color){const t=norm(desc);
  const hair=/loir|dourad/.test(t)?'#e7c262':/ruiv|laranj/.test(t)?'#c4532b':/pret|negro/.test(t)?'#25202a':/castanh|marrom/.test(t)?'#6b4130':/azul/.test(t)?'#3e6fd3':/rosa/.test(t)?'#e07aa8':/branc|grisalh|cinza/.test(t)?'#d8d5cf':/verde/.test(t)?'#3e9a6c':/roxo|lilas/.test(t)?'#7c4cc6':'#4b3a33';
  const skin=/pele (escura|negra)|negr[oa]/.test(t)?'#8a5a3c':/moren/.test(t)?'#c08a62':/palid|clar/.test(t)?'#f6dcc6':'#f0c6a3';
  const style=/barb/.test(t)?'beard':/(cabelo )?(longo|comprid)/.test(t)?'long':'short';
  return{hair,skin,outfit:color||'#5a6478',style};}
export function bgArt(name,desc){const t=norm(name+' '+desc);let body='';
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">${body}</svg>`;}

// Elenco de exemplo e do marketplace. A ordem importa: os ids do exemplo saem de um contador
// (c1, sp2…) e histórias antigas, de antes do elenco em tabelas, ainda apontam para eles.
export const EXAMPLE={
  characters:[
    {slug:'lia',name:'Lia',desc:'Jovem de 19 anos, cabelo ruivo curto, sardas, volta à vila onde cresceu.',color:'#d9467a',emotions:[['Neutro','expressão calma, boca reta'],['Feliz','sorriso aberto, olhos fechados de alegria'],['Surpresa','olhos arregalados, boca aberta'],['Triste','sobrancelhas caídas, olhar baixo']]},
    {slug:'davi',name:'Davi',desc:'Amigo de infância de Lia, cabelo preto, pescador, desconfiado de forasteiros.',color:'',emotions:[['Neutro','rosto sério'],['Feliz','sorriso largo'],['Bravo','sobrancelhas franzidas, mandíbula tensa']]},
    {slug:'cida',name:'Dona Cida',desc:'Dona do café da vila, cabelo grisalho, conhece todos os segredos do lugar.',color:'#e0b25c',emotions:[['Neutro','olhar atento'],['Feliz','sorriso acolhedor']]},
  ],
  backgrounds:[
    {slug:'praia',name:'Praia ao entardecer',desc:'Praia da vila com sol baixo, mar calmo e um coqueiro.'},
    {slug:'farol',name:'Farol à noite',desc:'Farol listrado de vermelho sobre a pedra, céu estrelado.'},
    {slug:'cafe',name:'Café da vila',desc:'Interior do café de Dona Cida, prateleiras de potes e janela para o mar.'},
  ]};
export const MARKET={
  characters:[
    {slug:'yumi',author:'@marina.ilustra',name:'Yumi',desc:'Estudante tímida, cabelo azul longo, uniforme escolar.',color:'#3e6fd3',emotions:[['Neutro','olhar tranquilo'],['Feliz','sorriso tímido'],['Surpresa','olhos arregalados'],['Envergonhada','bochechas coradas, olhar desviado']]},
    {slug:'breno',author:'@caio.vn',name:'Capitão Breno',desc:'Pirata veterano, barba castanha, chapéu e casaco.',color:'#e8925a',emotions:[['Neutro','postura firme'],['Feliz','gargalhada'],['Bravo','olhar furioso']]},
    {slug:'atila',author:'@estudio.lume',name:'Professor Átila',desc:'Professor de história, cabelo grisalho, óculos imaginários, fala devagar.',color:'#7fd1a3',emotions:[['Neutro','expressão serena'],['Pensativo','olhar distante, desconfiado'],['Surpreso','espanto contido']]},
  ],
  backgrounds:[
    {slug:'sala-de-aula',author:'@estudio.lume',name:'Sala de aula',desc:'Sala de aula com quadro verde e carteiras de madeira.'},
    {slug:'floresta',author:'@marina.ilustra',name:'Floresta encantada',desc:'Floresta com vaga-lumes e árvores altas.'},
    {slug:'rua-noite',author:'@caio.vn',name:'Rua da cidade à noite',desc:'Rua com prédios iluminados à noite.'},
    {slug:'quarto',author:'@bea.pixel',name:'Quarto aconchegante',desc:'Quarto com sofá, abajur e janela para a lua.'},
  ]};
export const spriteKey=(slug,i)=>`example/${slug}-${i+1}.svg`;
export const bgKey=slug=>`example/bg-${slug}.svg`;

// Todos os arquivos, para o script que grava client/public/example/.
export function exampleFiles(){const out=[];
  for(const set of[EXAMPLE,MARKET]){
    for(const c of set.characters){const look=lookFrom(c.desc,c.color||null);c.emotions.forEach(([n,d],i)=>out.push({key:spriteKey(c.slug,i),svg:spriteArt(look,n,d)}));}
    for(const b of set.backgrounds)out.push({key:bgKey(b.slug),svg:bgArt(b.name,b.desc)});}
  return out;}
