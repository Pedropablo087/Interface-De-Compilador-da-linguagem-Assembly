/*--sample source--*/
const sampleASM = `; Hello, world (NASM, Linux x86_64)
; compile: nasm -f elf64 hello.asm && ld -o hello hello.o

section .data
    msg db "Hello, world!", 10
    len equ $ - msg

section .text
    global _start

_start:
    mov rax, 1         ; sys_write
    mov rdi, 1         ; fd=stdout
    mov rsi, msg       ; buf
    mov rdx, len       ; count
    syscall

    mov rax, 60        ; sys_exit
    xor rdi, rdi       ; status 0
    syscall`;

const LS_KEY = "asmstudio.files.v1";
function emptyRegs(){
  return {
    RAX:"0000000000000000", RBX:"0000000000000000",
    RCX:"0000000000000000", RDX:"0000000000000000",
    RSI:"0000000000000000", RDI:"0000000000000000",
    RSP:"000000000000FF00", RBP:"0000000000000000",
    RIP:"0000000000000000", FLAGS:"00000000",
  };
}   

let state = {
  arch: "x86_64",
  files: [],
  activeId: "",
  regs: emptyRegs(),
  problems: [],
  listing: "",
};

function loadFiles(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length){
        state.files = parsed;
        state.activeId = parsed[0].id;
        return;
      }
    }
  }catch(e){}
  // default
  state.files = [
    {id:"hello.asm", name:"hello.asm", content: sampleASM},
    {id:"macros.inc", name:"macros.inc", content: "; macros aqui\n%macro print 1\n ; ...\n%endmacro"}
  ];
  state.activeId = "hello.asm";
}
function saveFiles(){ localStorage.setItem(LS_KEY, JSON.stringify(state.files)); }

/* ---------------------- Fake assembler ---------------------- */
function assembleFake(source){
  const lines = String(source||"").split(/\r?\n/);
  const errors = [];
  const out = [];
  // 1st pass: labels (ignored size)
  let addr = 0;
  for(const raw of lines){
    const line = raw.replace(/;.*$/,"").trim();
    if(!line) continue;
    if(/^[A-Za-z_][\w]*:/.test(line)) continue;
    addr += 4; // pretend 4 bytes per instruction
  }
  // 2nd pass: validate
  addr = 0;
  lines.forEach((raw, i)=>{
    const line = raw.replace(/;.*$/,"").trim();
    if(!line) return;
    if(/^[A-Za-z_][\w]*:/.test(line)) return;

    const m = line.match(/^(mov|xor|syscall|jmp|add|sub|push|pop)\b/i);
    if(!m){
      errors.push({line:i+1, message:`Instrução desconhecida: "${line.split(/\s+/)[0]}"`});
    }else{
      out.push(`${addr.toString(16).padStart(4,"0")}: ${line}`);
    }
    addr += 4;
  });
  return { errors, listing: out.join("\n"), bytes: addr };
}

/* ---------------------- DOM refs ---------------------- */
const explList = document.getElementById("explList");
const code = document.getElementById("code");
const gutter = document.getElementById("gutter");
const fileTitle = document.getElementById("fileTitle");
const tabBtnsBottom = document.querySelectorAll('.bottom .tab');
const tabPanelsBottom = {
  problems: document.getElementById("tab-problems"),
  output: document.getElementById("tab-output"),
  listing: document.getElementById("tab-listing"),
};
const inspTabs = document.querySelectorAll('.panel.right .tab');
const inspPanels = {
  regs: document.getElementById("tab-regs"),
  mem: document.getElementById("tab-mem"),
  stack: document.getElementById("tab-stack"),
};
const regsGrid = document.getElementById("regsGrid");
const archSel = document.getElementById("archSel");

/* ---------------------- UI helpers ---------------------- */
function setBottomActive(target){
  tabBtnsBottom.forEach(b=>b.classList.toggle('active', b.dataset.tab===target));
  for(const k in tabPanelsBottom){
    tabPanelsBottom[k].hidden = (k!==target);
  }
}
function setInspActive(target){
  inspTabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===target));
  for(const k in inspPanels){
    inspPanels[k].hidden = (k!==target);
  }
}
tabBtnsBottom.forEach(b=>b.addEventListener('click',()=>setBottomActive(b.dataset.tab)));
inspTabs.forEach(b=>b.addEventListener('click',()=>setInspActive(b.dataset.tab)));

function updateGutter(){
  const lines = code.value.split(/\r?\n/).length;
  let buf = "";
  for(let i=1;i<=lines;i++) buf += i + "\n";
  gutter.textContent = buf;
}

/* ---------------------- Explorer rendering ---------------------- */
function renderExplorer(){
  explList.innerHTML = "";
  state.files.forEach(f=>{
    const item = document.createElement('div');
    item.className = 'file' + (f.id===state.activeId?' active':'');
    item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="opacity:.85">
      <path d="M4 6h5l2 2h9v10H4z" stroke="#cfd2dc" stroke-width="1.2"/></svg>
      <span class="name" title="${f.name}">${f.name}</span>`;
    item.addEventListener('click', ()=>{ setActive(f.id); });
    item.addEventListener('dblclick', ()=>{
      const nn = prompt("Renomear arquivo:", f.name);
      if(!nn || !nn.trim()) return;
      renameFile(f.id, nn.trim());
    });
    explList.appendChild(item);
  });
}

/* ---------------------- File ops ---------------------- */
function getActive(){ return state.files.find(f=>f.id===state.activeId); }
function setActive(id){
  state.activeId = id;
  const f = getActive();
  fileTitle.textContent = f ? f.name : "—";
  code.value = f ? f.content : "";
  updateGutter();
  renderExplorer();
}
function createFile(){
  const base = `file${state.files.length+1}.asm`;
  const nf = {id:base, name:base, content:"; novo arquivo"};
  state.files.push(nf);
  setActive(nf.id);
  saveFiles();
}
function renameFile(oldId, newName){
  const f = state.files.find(x=>x.id===oldId);
  if(!f) return;
  f.id = newName; f.name = newName;
  state.activeId = newName;
  renderExplorer();
  saveFiles();
}
function saveActive(){
  const f = getActive();
  if(!f) return;
  f.content = code.value;
  saveFiles();
}

/* ---------------------- Inspector (registers) ---------------------- */
function renderRegs(){
  regsGrid.innerHTML = "";
  Object.entries(state.regs).forEach(([k,v])=>{
    const lab = document.createElement('div');
    lab.className = "reg-label"; lab.textContent = k;
    const inp = document.createElement('input');
    inp.className = "reg-input";
    inp.value = v;
    inp.addEventListener('input',()=>{
      inp.value = (inp.value||"").toUpperCase().replace(/[^0-9A-F]/g,"");
      state.regs[k] = inp.value;
    });
    regsGrid.appendChild(lab); regsGrid.appendChild(inp);
  });
}

/* ---------------------- Editor bindings ---------------------- */
code.addEventListener('input', updateGutter);
code.addEventListener('keydown', e=>{
  // Tab key inserts 4 spaces
  if(e.key==="Tab"){
    e.preventDefault();
    const s = code.selectionStart; const epos = code.selectionEnd;
    code.setRangeText("    ", s, epos, "end");
    updateGutter();
  }
});

/* ---------------------- Actions ---------------------- */
document.getElementById("btnNew").addEventListener('click', createFile);
document.getElementById("btnSave").addEventListener('click', saveActive);
document.getElementById("btnAssemble").addEventListener('click', runAssemble);
document.getElementById("btnRun").addEventListener('click', runAssemble);
document.getElementById("btnDebug").addEventListener('click', ()=>alert("Depuração simulada"));
archSel.addEventListener('change', ()=> state.arch = archSel.value);

function runAssemble(){
  saveActive();
  const f = getActive(); if(!f) return;
  const res = assembleFake(f.content||"");
  state.listing = res.listing;
  if(res.errors.length){
    state.problems = res.errors.map(e=>`L${e.line}: ${e.message}`);
  }else{
    state.problems = [`Montagem OK (${res.bytes} bytes gerados) — alvo ${state.arch}`];
  }
  // update UI
  tabPanelsBottom.problems.querySelector('pre').textContent =
    (state.problems && state.problems.length) ? state.problems.join("\n") : "Nenhum problema encontrado.";
  tabPanelsBottom.listing.querySelector('pre').textContent = state.listing || "(vazio)";
  setBottomActive(res.errors.length ? "problems" : "listing");
}

/* ---------------------- Resizable panels ---------------------- */
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function applyPanelPerc(){
  const l = +getComputedStyle(document.documentElement).getPropertyValue('--panel-left');
  const m = +getComputedStyle(document.documentElement).getPropertyValue('--panel-mid');
  const r = +getComputedStyle(document.documentElement).getPropertyValue('--panel-right');
  // ensure sum == 100
  const sum = l+m+r;
  if(Math.abs(sum-100)>0.1){
    const k = 100/sum;
    document.documentElement.style.setProperty('--panel-left',  (l*k).toFixed(2));
    document.documentElement.style.setProperty('--panel-mid',   (m*k).toFixed(2));
    document.documentElement.style.setProperty('--panel-right', (r*k).toFixed(2));
  }
}
function initResizers(){
  const handles = document.querySelectorAll('.handle');
  let dragging = null;
  function onDown(e){
    dragging = { el:e.currentTarget, x:e.clientX,
      left: +getComputedStyle(document.documentElement).getPropertyValue('--panel-left'),
      mid:  +getComputedStyle(document.documentElement).getPropertyValue('--panel-mid'),
      right:+getComputedStyle(document.documentElement).getPropertyValue('--panel-right') };
    document.body.style.userSelect="none";
  }
  function onMove(e){
    if(!dragging) return;
    const dx = e.clientX - dragging.x;
    const w = document.querySelector('.panels').clientWidth;
    const dperc = dx / w * 100;
    if(dragging.el.dataset.handle==="left-mid"){
      let L = clamp(dragging.left + dperc, +get('--panel-min-left'), 60);
      let M = clamp(dragging.mid  - dperc, +get('--panel-min-mid'),  80);
      const R = dragging.right;
      // keep total 100:
      const rest = 100 - (L + M);
      document.documentElement.style.setProperty('--panel-left',  L.toFixed(2));
      document.documentElement.style.setProperty('--panel-mid',   M.toFixed(2));
      document.documentElement.style.setProperty('--panel-right', rest.toFixed(2));
    }else{
      // mid-right
      let R = clamp(dragging.right - dperc, +get('--panel-min-right'), 60);
      let M = clamp(dragging.mid   + dperc, +get('--panel-min-mid'),   80);
      const L = dragging.left;
      const rest = 100 - (L + M);
      document.documentElement.style.setProperty('--panel-left',  L.toFixed(2));
      document.documentElement.style.setProperty('--panel-mid',   M.toFixed(2));
      document.documentElement.style.setProperty('--panel-right', rest.toFixed(2));
    }
    applyPanelPerc();
  }
  function onUp(){
    dragging = null;
    document.body.style.userSelect="";
  }
  handles.forEach(h=>h.addEventListener('mousedown', onDown));
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  function get(v){ return getComputedStyle(document.documentElement).getPropertyValue(v); }
}

/* ---------------------- Init ---------------------- */
(function init(){
  loadFiles();
  archSel.value = state.arch;
  renderExplorer();
  renderRegs();
  setActive(state.activeId);
  setBottomActive("problems");
  setInspActive("regs");
  initResizers();
  updateGutter();
})();