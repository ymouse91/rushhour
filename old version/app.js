/* Rush Hour – satunnainen tiheä generaattori + BFS-ratkaisija (worker)
   - "Nollaa" palauttaa lähtötilanteeseen
   - "Ratkaise" näyttää minimipolun ja voi toistaa sen laudalla
*/

const BOARD_N = 6;
const EXIT_ROW = 2;
const EXIT_COL = 5;

// ===== Rush DB loader (rushx.txt) =====
// Each line: "<moves> <board[36]> <cluster>"
// Example: 50 ooo... 1845
let RUSH_DB = null; // cached [{moves, board, cluster}]
let RUSH_THRESH = null; // {beginner:[lo,hi], intermediate:[lo,hi], advanced:[lo,hi], expert:[lo,hi]}

async function loadRushDb(){
  if(RUSH_DB) return RUSH_DB;
  try{
    const txt = await fetch('rushx.txt', {cache:'no-store'}).then(r=>r.text());
    const lines = txt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const rx = /^(\d+)\s+([A-Za-zox]{36})\s+(\d+)$/;
    const arr = [];
    for(const line of lines){
      const m = line.match(rx);
      if(!m) continue;
      const moves = parseInt(m[1],10);
      const board = m[2];
      const cluster = parseInt(m[3],10);
      arr.push({moves, board, cluster});
    }
    if(!arr.length) throw new Error('rushx.txt parsed, but no valid rows');
    RUSH_DB = arr;

    // Build dynamic difficulty thresholds from move counts (quartiles)
    const vals = arr.map(o=>o.moves).sort((a,b)=>a-b);
    const q = (p)=>{
      const idx = (vals.length-1)*p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      const w = idx-lo;
      return (hi>=vals.length?vals[lo]:vals[lo]*(1-w)+vals[hi]*w);
    };
    const q25 = Math.floor(q(0.25)), q50 = Math.floor(q(0.50)), q75 = Math.floor(q(0.75));
    RUSH_THRESH = {
      beginner:     [vals[0], q25],
      intermediate: [q25+1, q50],
      advanced:     [q50+1, q75],
      expert:       [q75+1, vals[vals.length-1]]
    };
    console.log('Rush DB loaded:', arr.length, 'rows', RUSH_THRESH);
  }catch(err){
    console.warn('Failed to load rushx.txt:', err);
    RUSH_DB = [];
  }
  return RUSH_DB;
}

// Convert 36-char board string -> vehicles array compatible with the app
function vehiclesFromBoard(boardStr){
  // map letters to list of [r,c]
  const cells = {};
  for(let i=0;i<boardStr.length;i++){
    const ch = boardStr[i];
    if(ch === 'o' || ch === 'x' || ch === '.' ) continue;
    if(!cells[ch]) cells[ch]=[];
    const r = Math.floor(i/BOARD_N);
    const c = i%BOARD_N;
    cells[ch].push([r,c]);
  }
  // For each letter, determine orientation and top-left
  const vehs = [];
  // Keep insertion order from scan (row-major). Move 'A' to front only.
  let letters = Object.keys(cells); // insertion order
  const ai = letters.indexOf('A');
  if(ai>0){ letters.splice(ai,1); letters.unshift('A'); }
  for(const ch of letters){
    const pts = cells[ch];
    // infer orientation: if any two share same row -> H, else V
    let dir = 'H';
    if(pts.length>=2){
      const sameRow = pts.some((p,i)=> pts.some((q,j)=> i!==j && p[0]===q[0]));
      dir = sameRow ? 'H' : 'V';
    }
    const rs = pts.map(p=>p[0]), cs = pts.map(p=>p[1]);
    const minr = Math.min(...rs), minc = Math.min(...cs);
    const len = pts.length; // 2 or 3
    const kind = (ch==='A') ? 'red' : (len===3 ? 'truck' : 'car');
    vehs.push({dir, r:minr, c:minc, len, kind});
  }
  return vehs;
}



// ---- DOM ----
const boardEl = document.getElementById('board');
const movesEl = document.getElementById('moves');
const minEl   = document.getElementById('min');
const levelSel= document.getElementById('level');
const btnNew  = document.getElementById('new');
const btnReset= document.getElementById('reset');
const UP=document.getElementById('up'), DOWN=document.getElementById('down'),
      LEFT=document.getElementById('left'), RIGHT=document.getElementById('right');

// Luodaan Ratkaise-nappi jos sitä ei ole valmiiksi
let btnSolve = document.getElementById('solve');
if(!btnSolve){
  const hud = document.querySelector('.hud') || document.body;
  btnSolve = document.createElement('button');
  btnSolve.id = 'solve';
  btnSolve.textContent = 'Ratkaise';
  hud.appendChild(btnSolve);
}

// ---- Pelitila ----
let state = {
  vehicles: [],      // index 0 = punainen (H, len=2)
  moves: 0,
  selected: 0,
  startSnapshot: null,
  minMoves: null,
  solution: null,     // [{vi, delta}] minimipolku
  playing: false
};

// ---------- Util ----------
function rc2i(r,c){ return r*BOARD_N + c; }
function cloneVehicles(vs){ return vs.map(v=>({...v})); }
function emptyGrid(){ return new Array(BOARD_N*BOARD_N).fill(-1); }
function rngInt(a,b){ return (Math.random()*(b-a+1)|0)+a; }
function randBool(p){ return Math.random()<p; }

function paintGrid(vs){
  const g = emptyGrid();
  for(let i=0;i<vs.length;i++){
    const v = vs[i];
    if(v.dir==='H'){
      for(let x=0;x<v.len;x++){
        const c=v.c+x; if(c>=0&&c<BOARD_N) g[rc2i(v.r,c)]=i;
      }
    }else{
      for(let x=0;x<v.len;x++){
        const r=v.r+x; if(r>=0&&r<BOARD_N) g[rc2i(r,v.c)]=i;
      }
    }
  }
  return g;
}
function isSolved(vs){
  const red=vs[0];
  return red.dir==='H' && red.r===EXIT_ROW && (red.c+red.len-1)===EXIT_COL;
}

// ---------- Liikkeet ----------
function legalMoves(vs){
  const grid = paintGrid(vs);
  const out = [];
  for(let vi=0; vi<vs.length; vi++){
    const v = vs[vi], steps=[];
    if(v.dir==='H'){
      let c=v.c-1,d=-1; while(c>=0 && grid[rc2i(v.r,c)]===-1){ steps.push(d); c--; d--; }
      c=v.c+v.len; d=1; while(c<BOARD_N && grid[rc2i(v.r,c)]===-1){ steps.push(d); c++; d++; }
    }else{
      let r=v.r-1,d=-1; while(r>=0 && grid[rc2i(r,v.c)]===-1){ steps.push(d); r--; d--; }
      r=v.r+v.len; d=1; while(r<BOARD_N && grid[rc2i(r,v.c)]===-1){ steps.push(d); r++; d++; }
    }
    out.push({vi,steps});
  }
  return out;
}
function applyStep(vs,vi,delta){
  const nv=cloneVehicles(vs);
  const v=nv[vi];
  if(v.dir==='H') v.c+=delta; else v.r+=delta;
  return nv;
}

// ---------- Satunnainen tiheä aloitus ----------
function randomVehicle(isTruck){
  const len = isTruck?3:2;
  const dir = randBool(0.5)?'H':'V';
  let r,c;
  if(dir==='H'){ r=rngInt(0,5); c=rngInt(0,BOARD_N-len); }
  else{ r=rngInt(0,BOARD_N-len); c=rngInt(0,5); }
  return {r,c,len,dir,kind:isTruck?'truck':'car'};
}
function fits(v, grid){
  if(v.dir==='H'){
    for(let x=0;x<v.len;x++){ if(grid[rc2i(v.r,v.c+x)]!==-1) return false; }
  }else{
    for(let x=0;x<v.len;x++){ if(grid[rc2i(v.r+x,v.c)]!==-1) return false; }
  }
  return true;
}
function stamp(v, grid, id){
  if(v.dir==='H'){ for(let x=0;x<v.len;x++) grid[rc2i(v.r,v.c+x)]=id; }
  else{ for(let x=0;x<v.len;x++) grid[rc2i(v.r+x,v.c)]=id; }
}
function buildRandomLevel(level){
  const conf = VEH_COUNTS[level] || VEH_COUNTS.beginner;
  const total = rngInt(conf.min, conf.max);
  const redC = rngInt(0,3); // ei maalissa valmiiksi
  const red = {r:EXIT_ROW,c:redC,len:2,dir:'H',kind:'red'};
  const vs=[red];
  const grid = emptyGrid(); stamp(red,grid,0);

  let trucks=0, wantTrucks=Math.round(total*conf.truckRatio), tries=0;
  while(vs.length<total+1 && tries++<2000){
    const isTruck = (trucks<wantTrucks) ? randBool(0.6) : false;
    const v = randomVehicle(isTruck);
    if(randBool(0.25)){
      if(v.dir==='H') v.r = EXIT_ROW;
      else v.c = rngInt(Math.max(0, redC-1), Math.min(5, redC+2));
      if(v.dir==='H') v.c = Math.min(v.c, 6 - v.len);
      else v.r = Math.min(v.r, 6 - v.len);
    }
    if(fits(v,grid)){
      vs.push(v); stamp(v,grid,vs.length-1);
      if(isTruck) trucks++;
    }
  }
  return vs;
}

// ---------- Web Worker BFS (minimipolku!) ----------
const workerCode = `
const BOARD_N=6, EXIT_ROW=2, EXIT_COL=5;
function rc2i(r,c){return r*BOARD_N+c}
function clone(vs){return vs.map(v=>({...v}))}
function paint(vs){
  const g=new Array(36).fill(-1);
  for(let i=0;i<vs.length;i++){
    const v=vs[i];
    if(v.dir==='H'){ for(let x=0;x<v.len;x++){ const c=v.c+x; if(c>=0&&c<6) g[rc2i(v.r,c)]=i; } }
    else{ for(let x=0;x<v.len;x++){ const r=v.r+x; if(r>=0&&r<6) g[rc2i(r,v.c)]=i; } }
  }
  return g;
}
function isSolved(vs){ const r=vs[0]; return r.dir==='H' && r.r===EXIT_ROW && (r.c+r.len-1)===EXIT_COL; }
function legal(vs){
  const g=paint(vs), out=[];
  for(let i=0;i<vs.length;i++){
    const v=vs[i], steps=[];
    if(v.dir==='H'){
      let c=v.c-1,d=-1; while(c>=0 && g[rc2i(v.r,c)]===-1){ steps.push(d); c--; d--; }
      c=v.c+v.len; d=1; while(c<6 && g[rc2i(v.r,c)]===-1){ steps.push(d); c++; d++; }
    }else{
      let r=v.r-1,d=-1; while(r>=0 && g[rc2i(r,v.c)]===-1){ steps.push(d); r--; d--; }
      r=v.r+v.len; d=1; while(r<6 && g[rc2i(r,v.c)]===-1){ steps.push(d); r++; d++; }
    }
    out.push({vi:i,steps});
  }
  return out;
}
function apply(vs,vi,d){ const nv=clone(vs); const v=nv[vi]; if(v.dir==='H')v.c+=d; else v.r+=d; return nv; }
function enc(vs){ return vs.map(v=>\`\${v.dir}\${v.r},\${v.c}\`).join(';'); }

onmessage = (e)=>{
  const {vs, cap} = e.data;
  if(isSolved(vs)){ postMessage({min:0, path:[]}); return; }
  const q=[vs], seen=new Set([enc(vs)]);
  const parent=new Map(); // key -> {pkey, vi, delta}
  let depth=0;
  while(q.length){
    const size=q.length;
    for(let i=0;i<size;i++){
      const cur=q.shift();
      const curKey=enc(cur);
      const moves=legal(cur);
      for(const m of moves){
        for(const d of m.steps){
          const nxt=apply(cur,m.vi,d);
          const key=enc(nxt);
          if(seen.has(key)) continue;
          parent.set(key,{pkey:curKey,vi:m.vi,delta:d});
          if(isSolved(nxt)){
            // rakenna polku
            const path=[];
            let k=key;
            while(parent.has(k)){
              const info=parent.get(k);
              path.push({vi:info.vi, delta:info.delta});
              k=info.pkey;
            }
            path.reverse();
            postMessage({min:depth+1, path});
            return;
          }
          seen.add(key); q.push(nxt);
        }
      }
    }
    depth++;
    if(depth>cap){ postMessage({min:null, path:null}); return; }
  }
  postMessage({min:null, path:null});
};
`;
const solver = new Worker(URL.createObjectURL(new Blob([workerCode], {type:'text/javascript'})));
function solveAsync(vs, depthCap=200){
  return new Promise(res=>{
    const onMsg = (e)=>{ solver.removeEventListener('message', onMsg); res(e.data); };
    solver.addEventListener('message', onMsg);
    solver.postMessage({vs, cap: depthCap});
  });
}

// ---------- Generoi kunnes BFS hyväksyy ----------
async function generatePuzzleCheckedRandom(level){
// (original body unchanged)

  const LOCAL_TGT = { beginner:[12,18], intermediate:[19,35], advanced:[36,60], expert:[61,120] };
  const [lo,hi] = LOCAL_TGT[level] || LOCAL_TGT.beginner;
  let best=null, bestDiff=1e9;

  for(let attempt=0; attempt<200; attempt++){
    const vs = buildRandomLevel(level);

    // triviaalin esto: redin oikealla puolella oltava joku
    const g=paintGrid(vs);
    let blocker=false;
    for(let c=vs[0].c+vs[0].len;c<BOARD_N;c++){
      if(g[rc2i(EXIT_ROW,c)]!==-1){ blocker=true; break; }
    }
    if(!blocker) continue;

    const res = await solveAsync(vs, 200);
    if(res.min==null) continue;

    const diff = (res.min<lo?lo-res.min:res.min>hi?res.min-hi:0);
    if(diff===0){ vs[0].kind='red'; return {vehicles:vs, min:res.min, path:res.path}; }
    if(diff<bestDiff){ bestDiff=diff; best={vehicles:vs, min:res.min, path:res.path}; }
  }
  if(best){ best.vehicles[0].kind='red'; return best; }
  const vs = buildRandomLevel('beginner');
  const res = await solveAsync(vs, 200);
  vs[0].kind='red';
  return {vehicles:vs, min:res.min, path:res.path};
}

// ---------- UI ----------
function buildBoard(){
  boardEl.innerHTML='';
  for(let i=0;i<BOARD_N*BOARD_N;i++){
    const d=document.createElement('div'); d.className='cell'; boardEl.appendChild(d);
  }
  const exit=document.createElement('div'); exit.className='exit'; boardEl.appendChild(exit);
}
function placeVehicles(vs){
  boardEl.querySelectorAll('.veh').forEach(e=>e.remove());
  const root = getComputedStyle(document.documentElement);
  const cell = parseFloat(root.getPropertyValue('--cell')) || 64;
  const gap  = parseFloat(root.getPropertyValue('--gap'))  || 6;
  const pad  = gap;
  for(let i=0;i<vs.length;i++){
    const v=vs[i];
    const el=document.createElement('div');
    el.className = 'veh ' + (v.kind==='red'?'red ':'') + (v.kind==='truck'?'truck ':'car');
    if(v.kind==='red') el.style.background='var(--red)';
    if(i===state.selected) el.classList.add('sel');
    const w=(v.dir==='H'?v.len:1)*cell + ((v.dir==='H'?v.len-1:0)*gap);
    const h=(v.dir==='V'?v.len:1)*cell + ((v.dir==='V'?v.len-1:0)*gap);
    const x=pad + v.c*(cell+gap);
    const y=pad + v.r*(cell+gap);
    el.style.width=w+'px'; el.style.height=h+'px'; el.style.transform=`translate(${x}px,${y}px)`;
	// ID näkyviin ilman layoutin muutosta
el.textContent = (i===0 ? 'R' : String(i));
el.style.color = (v.kind==='red' ? '#000' : '#fff');

    el.addEventListener('click',()=>{ state.selected=i; placeVehicles(state.vehicles); });
    boardEl.appendChild(el);
  }
}
function refreshHUD(){
  movesEl.textContent = state.moves|0;
  minEl.textContent   = (state.minMoves==null?'–':state.minMoves);
}


// Choose puzzle by difficulty using rushx.txt database. Fallback to random.

async function generatePuzzleChecked(level){
  // Always try to load DB; fall back if not available
  await loadRushDb();

  // Kiinteät rajat (molemmille avainsanoille)
  const FIXED = {
    beginner:    [5, 9],
    intermediate:[10,13],
    advanced:    [14,19],
    expert:      [20,30],
    helppo:      [5, 9],
    tavallinen:  [10,13],
    haastava:    [14,19],
    vaikea:      [20,30]
  };
  const [lo, hi] = FIXED[level] || FIXED.beginner;

  if (RUSH_DB && RUSH_DB.length){
    const pool = RUSH_DB.filter(p => p.moves >= lo && p.moves <= hi);
    const base = pool.length ? pool : RUSH_DB;
    const pick = base[(Math.random()*base.length)|0];

    const vs = vehiclesFromBoard(pick.board);
    // Siirrä vain A eteen, säilytä skannausjärjestys
    const redIdx = vs.findIndex(v=>v.kind==='red');
    if(redIdx>0){ const red=vs.splice(redIdx,1)[0]; vs.unshift(red); }

    return { vehicles: vs, min: pick.moves, path: null };
  }

  // fallback satunnaiseen jos rushx puuttuu
  return await generatePuzzleCheckedRandom(level);
}


async function newPuzzle(){
  const lv = levelSel.value || 'beginner';
  const res = await generatePuzzleChecked(lv);
  state.vehicles = res.vehicles;
  state.vehicles[0].kind='red';
  state.minMoves = (res.min!=null?res.min:'–');
  state.solution = res.path || null;
  state.moves=0; state.selected=0; state.startSnapshot=cloneVehicles(state.vehicles);
  buildBoard(); placeVehicles(state.vehicles); refreshHUD();
}

function resetPuzzle(){
  if(!state.startSnapshot) return;
  state.vehicles=cloneVehicles(state.startSnapshot);
  state.moves=0; state.selected=0;
  placeVehicles(state.vehicles); refreshHUD();
}

function legalMovesForIndex(i){
  return legalMoves(state.vehicles).find(m=>m.vi===i) || {steps:[]};
}

function tryMoveSelected(dir){
  if(state.playing) return; // estä manuaalinen siirto toiston aikana
  const i=state.selected|0, v=state.vehicles[i]; if(!v) return;
  const moves=legalMovesForIndex(i);
  const want =
    (dir==='L' && v.dir==='H') ? -1 :
    (dir==='R' && v.dir==='H') ? +1 :
    (dir==='U' && v.dir==='V') ? -1 :
    (dir==='D' && v.dir==='V') ? +1 : 0;
  if(!want) return;
  if(moves.steps.includes(want)){
    state.vehicles=applyStep(state.vehicles,i,want);
    state.moves++;
    buildBoard(); placeVehicles(state.vehicles); refreshHUD();
    if(isSolved(state.vehicles)){
      setTimeout(()=>alert(`Ratkaistu! Siirrot: ${state.moves} (minimi ${state.minMoves})`), 20);
    }
  }
}

// --------- Ratkaisun näyttö / toisto ----------
function prettyMove(vs, mv){
  const v = vs[mv.vi];
  const arrow = v.dir==='H' ? (mv.delta>0?'→':'←') : (mv.delta>0?'↓':'↑');
  const steps = Math.abs(mv.delta);
  const id = (mv.vi===0 ? 'R' : String(mv.vi));
  return `${id} ${arrow}${steps}`;
}



// ======= Ratkaisun modaalidialogi (näyttää pitkätkin polut kokonaan) =======
function ensureSolutionModal(){
  let modal = document.getElementById('solModal');
  if(modal) return modal;
  modal = document.createElement('div');
  modal.id = 'solModal';
  modal.style.cssText = `position:fixed; inset:0; display:none; place-items:center; z-index:9999; background:rgba(0,0,0,.4);`;
  modal.innerHTML = `
    <div style="width:min(920px,92vw); max-height:84vh; background:#fff; border-radius:12px; box-shadow:0 12px 34px rgba(0,0,0,.28); display:flex; flex-direction:column; overflow:hidden;">
      <div style="padding:12px 16px; border-bottom:1px solid #e5e7eb; display:flex; gap:8px; align-items:center; justify-content:space-between;">
        <div id="solTitle" style="font-weight:600"></div>
        <div style="display:flex; gap:8px;">
          <button id="solPlay" class="btn">Toista laudalla</button>
          <button id="solCopy" class="btn">Kopioi</button>
          <button id="solClose" class="btn">Sulje</button>
        </div>
      </div>
      <pre id="solBody" style="margin:0; padding:12px 16px; overflow:auto; white-space:pre-wrap; font:13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;"></pre>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e)=>{ if(e.target===modal) { modal.style.display='none'; }});
  modal.querySelector('#solClose').addEventListener('click', ()=>{ modal.style.display='none'; });
  modal.querySelector('#solCopy').addEventListener('click', ()=>{
    const txt = modal.querySelector('#solBody').innerText;
    navigator.clipboard && navigator.clipboard.writeText(txt).catch(()=>{});
  });
  return modal;
}

function showSolutionModal(min, lines, onPlay){
  const modal = ensureSolutionModal();
  modal.querySelector('#solTitle').textContent = `Minimi ${min} siirtoa — askeleet`;
  modal.querySelector('#solBody').textContent  = lines.join('\\n');
  const playBtn = modal.querySelector('#solPlay');
  playBtn.onclick = ()=>{ modal.style.display='none'; try{ onPlay && onPlay(); }catch(e){} };
  modal.style.display = 'grid';
}

async function showSolution(){
  // jos nykyinen asema ei ole lähtöasetus, lasketaan uudelleen
  const same = encode(state.vehicles)===encode(state.startSnapshot||[]);
  let path = null, min = null;
  if(same && state.solution){
    path = state.solution; min = state.minMoves;
  }else{
    const res = await solveAsync(state.vehicles, 220);
    path = res.path; min = res.min;
  }
  if(!path){ alert('Ratkaisua ei löytynyt syvyysrajalla.'); return; }

  // listaus
  const lines = path.map(m=>prettyMove(state.startSnapshot||state.vehicles, m));
  console.log('Ratkaisu:', lines.join(' | '));
  alert(`Minimi ${min} siirtoa:\n` + lines.join('\n'));

  // tarjotaan myös toisto lähtötilanteesta
  if(!state.startSnapshot) return;
  if(confirm('Toistetaanko ratkaisu laudalla?')){
    await playSolution(path);
  }
}

function encode(vs){ return vs.map(v=>`${v.dir}${v.r},${v.c}`).join(';'); }

function playSolution(path){
  return new Promise(async (resolve)=>{
    state.playing = true;
    // paluu lähtötilanteeseen
    resetPuzzle();
    await new Promise(r=>setTimeout(r, 60));
    let i=0;
    const stepOnce = ()=>{
      if(i>=path.length){ state.playing=false; resolve(); return; }
      const mv = path[i++];
      state.vehicles = applyStep(state.vehicles, mv.vi, mv.delta);
      state.moves++;
      buildBoard(); placeVehicles(state.vehicles); refreshHUD();
      setTimeout(stepOnce, 120);
    };
    stepOnce();
  });
}

// ---------- Eventit ----------
btnNew.addEventListener('click', ()=>{ newPuzzle(); });
btnReset.addEventListener('click', resetPuzzle);
btnSolve.addEventListener('click', showSolution);
LEFT.addEventListener('click', ()=>tryMoveSelected('L'));
RIGHT.addEventListener('click',()=>tryMoveSelected('R'));
UP.addEventListener('click',   ()=>tryMoveSelected('U'));
DOWN.addEventListener('click', ()=>tryMoveSelected('D'));
window.addEventListener('keydown', e=>{
  if(e.key==='ArrowLeft')  tryMoveSelected('L');
  else if(e.key==='ArrowRight') tryMoveSelected('R');
  else if(e.key==='ArrowUp')    tryMoveSelected('U');
  else if(e.key==='ArrowDown')  tryMoveSelected('D');
});

// ---------- Init ----------
function buildBoard(){
  boardEl.innerHTML='';
  for(let i=0;i<BOARD_N*BOARD_N;i++){
    const d=document.createElement('div'); d.className='cell'; boardEl.appendChild(d);
  }
  const exit=document.createElement('div'); exit.className='exit'; boardEl.appendChild(exit);
}
buildBoard();
newPuzzle();

// ---------- SW ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
}
