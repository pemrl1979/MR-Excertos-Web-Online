import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import {parsePageSpec,isContiguous,suggestedBaseName,associatePrintedPage,numberPrintedInterval,migrateProject,shouldPreserveProjectOnPdfOpen,editorBreak,paragraphGroups} from './core.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc='./vendor/pdfjs/pdf.worker.min.mjs';

const $=id=>document.getElementById(id);
const FONT_PRIORITY=['Times New Roman','Arial','Study-Regular','Lora'];
const FACSIMILE_DPI=300;
const LEGACY_FACSIMILE_DPI=72*1.45;
const state={pdf:null,pdfName:'',sourceSha256:'',importedFromDesktop:false,page:1,scale:1.45,textItems:[],selection:null,printedPages:{},requestedPages:[],items:[],selectedItem:-1,pending:null,deferredInstall:null,selectedFont:'Times New Roman',availableFonts:[],localFontAccess:'unknown'};
let projectDirty=false;
let recoveryTimer=null;
const RECOVERY_DB='mr-excertos-web';
const RECOVERY_STORE='recovery';
const RECOVERY_KEY='current';
const canvas=$('pdfCanvas'), ctx=canvas.getContext('2d');

function setStatus(s){$('status').textContent=s}
function enableWork(on){
  ['prevBtn','nextBtn','associateBtn','defineRangeBtn','numberRangeBtn'].forEach(id=>$(id).disabled=!on);
  document.querySelectorAll('[data-style]').forEach(b=>b.disabled=!on);
  updateProjectButtons();
}
function hasProjectData(){return !!state.pdfName||Object.keys(state.printedPages||{}).length>0||(state.requestedPages||[]).length>0||(state.items||[]).length>0}
function updateProjectButtons(){$('saveProjectBtn').disabled=!hasProjectData();$('odtBtn').disabled=!(state.items||[]).length}
function normalizeLines(text){return text.split(/\r?\n/).map(l=>l.replace(/^ +/,'')).join('\n')}
function escapeXml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function pageRangeName(){return suggestedBaseName(state)}
function errorText(err){if(err instanceof Error&&err.message)return err.message;if(typeof err==='string')return err;try{return JSON.stringify(err)||String(err)}catch{return String(err)}}
async function sha256Hex(buffer){
  if(!globalThis.crypto?.subtle)return '';
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function hasUnsavedWork(){return projectDirty||!!state.pending}
function reviewDraftSnapshot(){
  if(!state.pending)return null;
  return {open:!$('review').hidden,text:$('reviewText').value,checked:$('checkedOriginal').checked,source:$('reviewSource').textContent};
}
function serializableState(){
  return {
    pdfName:state.pdfName,sourceSha256:state.sourceSha256,importedFromDesktop:state.importedFromDesktop,page:state.page,scale:state.scale,printedPages:state.printedPages,requestedPages:state.requestedPages,
    items:state.items,selectedItem:state.selectedItem,pending:state.pending,selectedFont:state.selectedFont
  };
}
function recoverySnapshot(){return {format:'MR Excertos Web recovery',version:'1.0',savedAt:new Date().toISOString(),projectDirty,state:serializableState(),review:reviewDraftSnapshot()}}
function openRecoveryDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){resolve(null);return}
    const req=indexedDB.open(RECOVERY_DB,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(RECOVERY_STORE))db.createObjectStore(RECOVERY_STORE)};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function putRecovery(snapshot){
  const db=await openRecoveryDb();if(!db)return;
  await new Promise((resolve,reject)=>{const tx=db.transaction(RECOVERY_STORE,'readwrite');tx.objectStore(RECOVERY_STORE).put(snapshot,RECOVERY_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
  db.close();
}
async function getRecovery(){
  const db=await openRecoveryDb();if(!db)return null;
  const value=await new Promise((resolve,reject)=>{const tx=db.transaction(RECOVERY_STORE,'readonly');const req=tx.objectStore(RECOVERY_STORE).get(RECOVERY_KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)});
  db.close();return value;
}
async function clearRecovery(){
  if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=null}
  const db=await openRecoveryDb();if(!db)return;
  await new Promise((resolve,reject)=>{const tx=db.transaction(RECOVERY_STORE,'readwrite');tx.objectStore(RECOVERY_STORE).delete(RECOVERY_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
  db.close();
}
async function persistRecoveryNow(){
  if(recoveryTimer){clearTimeout(recoveryTimer);recoveryTimer=null}
  if(!hasUnsavedWork()){await clearRecovery();return}
  try{await putRecovery(recoverySnapshot())}catch(e){console.warn('Não foi possível atualizar a recuperação automática:',e);setStatus('A recuperação automática não pôde ser atualizada. Salve o projeto manualmente para proteger o trabalho.')}
}
function scheduleRecovery(){
  if(recoveryTimer)clearTimeout(recoveryTimer);
  recoveryTimer=setTimeout(()=>{persistRecoveryNow()},350);
}
function markDirty(){projectDirty=true;updateProjectButtons();scheduleRecovery()}
async function markClean(){projectDirty=false;updateProjectButtons();if(state.pending)scheduleRecovery();else await clearRecovery()}
function restoreSerializableState(saved){
  state.pdf=null;state.pdfName=saved.pdfName||'';state.sourceSha256=saved.sourceSha256||'';state.importedFromDesktop=!!saved.importedFromDesktop;state.page=Number(saved.page)||1;state.scale=Number(saved.scale)||1.45;state.textItems=[];state.selection=null;
  state.printedPages=saved.printedPages||{};state.requestedPages=saved.requestedPages||[];state.items=saved.items||[];state.selectedItem=Number.isInteger(saved.selectedItem)?saved.selectedItem:(state.items.length?0:-1);
  state.pending=saved.pending||null;state.selectedFont=saved.selectedFont||'Times New Roman';
}
function refreshProjectUiWithoutPdf(){
  enableWork(false);updateProjectButtons();updateFontLabel();$('pageRange').value=(state.requestedPages||[]).join(', ');$('rangeSummary').textContent=state.requestedPages.length?`${state.requestedPages.length} página(s) definidas.`:'';renderDoc();
  $('pageCount').textContent='/ 0';$('printedPage').value='';
}
async function restoreRecovery(snapshot){
  restoreSerializableState(snapshot.state||{});projectDirty=!!snapshot.projectDirty||!!state.pending;refreshProjectUiWithoutPdf();
  const draft=snapshot.review;
  if(state.pending&&draft){$('reviewText').value=draft.text||'';$('checkedOriginal').checked=!!draft.checked;$('reviewSource').textContent=draft.source||'Trabalho recuperado.';$('review').hidden=!draft.open;$('tipsBox').hidden=true}
  setStatus(`Trabalho recuperado${state.pdfName?` — reabra ${state.pdfName} para continuar os recortes.`:'.'}`);scheduleRecovery();
}
async function offerRecoveryIfPresent(){
  let snapshot=null;try{snapshot=await getRecovery()}catch(e){console.warn('Não foi possível verificar recuperação automática:',e)}
  if(!snapshot)return;
  const when=snapshot.savedAt?new Date(snapshot.savedAt).toLocaleString('pt-BR'):'';
  $('recoveryInfo').textContent=`Foi encontrado um trabalho não concluído${when?` salvo automaticamente em ${when}`:''}.`;
  const dlg=$('recoveryDialog');
  dlg.addEventListener('cancel',e=>e.preventDefault(),{once:true});
  const choice=await new Promise(resolve=>{$('recoveryRestore').onclick=()=>{dlg.close();resolve('restore')};$('recoveryDiscard').onclick=()=>{dlg.close();resolve('discard')};dlg.showModal()});
  if(choice==='restore')await restoreRecovery(snapshot);else await clearRecovery();
}

async function loadPdf(file){
  const previousPdfName=state.pdfName;
  const preserving=shouldPreserveProjectOnPdfOpen(hasProjectData(),state.pdf,state.pdfName,file.name);
  const buf=await file.arrayBuffer();
  const loadedSha256=await sha256Hex(buf);
  if(preserving&&state.sourceSha256&&loadedSha256&&state.sourceSha256.toLowerCase()!==loadedSha256.toLowerCase()){
    throw new Error('O PDF selecionado não corresponde ao arquivo de origem registrado no projeto.');
  }
  state.pdf=await pdfjsLib.getDocument({data:buf}).promise; state.pdfName=file.name;
  if(!preserving){
    state.page=1;state.requestedPages=[];state.printedPages={};state.items=[];state.selectedItem=-1;state.pending=null;state.sourceSha256=loadedSha256;state.importedFromDesktop=false;$('pageRange').value='';$('rangeSummary').textContent='';projectDirty=false
  }else if(!state.sourceSha256)state.sourceSha256=loadedSha256;
  state.page=Math.max(1,Math.min(state.pdf.numPages,Number(state.page)||1));
  $('pageNumber').max=state.pdf.numPages;$('pageCount').textContent=`/ ${state.pdf.numPages}`;enableWork(true);updateProjectButtons();await renderPage();
  const hydrated=await hydrateLegacyFacsimiles();
  if(hydrated)setStatus(`Projeto desktop importado: ${hydrated} fac-símile(s) reconstruído(s) a partir do PDF.`);
  else if(preserving){
    if(previousPdfName&&previousPdfName!==file.name)setStatus(`${file.name} aberto para o projeto anteriormente associado a ${previousPdfName}.`);
    else setStatus(`${state.pdfName} reaberto — trabalho recuperado disponível para continuar.`);
  }
}
async function renderPage(){
  const page=await state.pdf.getPage(state.page); const viewport=page.getViewport({scale:state.scale});
  canvas.width=Math.floor(viewport.width); canvas.height=Math.floor(viewport.height); canvas.style.width=`${canvas.width}px`;canvas.style.height=`${canvas.height}px`;
  await page.render({canvasContext:ctx,viewport}).promise;
  const tc=await page.getTextContent(); state.textItems=tc.items.filter(i=>i.str).map(item=>{
    const t=pdfjsLib.Util.transform(viewport.transform,item.transform); const h=Math.max(8,Math.hypot(t[2],t[3])); const w=Math.max(2,item.width*state.scale);
    return {str:item.str,x:t[4],y:t[5]-h,w,h};
  });
  $('pageNumber').value=state.page; $('printedPage').value=state.printedPages[state.page]||''; state.selection=null; $('selection').style.display='none';
  setStatus(`${state.pdfName} — página física ${state.page} de ${state.pdf.numPages}`);
}

$('pdfInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;if(hasProjectData()&&state.pdfName&&f.name!==state.pdfName&&hasUnsavedWork()){const discard=confirm(`O trabalho atual está associado a “${state.pdfName}” e contém alterações não salvas. Abrir “${f.name}” descartará essas alterações e iniciará outro trabalho. Continuar?`);if(!discard){e.target.value='';return}projectDirty=false;state.pending=null;await clearRecovery()}loadPdf(f).catch(err=>alert('Não foi possível abrir o PDF: '+err.message))});
$('prevBtn').onclick=async()=>{if(state.page>1){state.page--;await renderPage()}};
$('nextBtn').onclick=async()=>{if(state.page<state.pdf.numPages){state.page++;await renderPage()}};
$('pageNumber').onchange=async()=>{const p=Math.max(1,Math.min(state.pdf.numPages,Number($('pageNumber').value)||1));state.page=p;await renderPage()};
$('associateBtn').onclick=()=>{const n=Number($('printedPage').value);if(n>0){associatePrintedPage(state,state.page,n);renderDoc();markDirty();setStatus(`Página PDF ${state.page} associada a [MR, p. ${n}].`)}};
$('defineRangeBtn').onclick=async()=>{
  try{const pages=parsePageSpec($('pageRange').value,state.pdf.numPages);state.requestedPages=pages;$('rangeSummary').textContent=`${pages.length} página(s): ${$('pageRange').value}`;state.page=pages[0];await renderPage();markDirty();setStatus(`${pages.length} página(s) físicas definidas.`)}
  catch(e){alert(e.message)}
};
$('numberRangeBtn').onclick=()=>{
  try{
    const pages=state.requestedPages.length?state.requestedPages:parsePageSpec($('pageRange').value,state.pdf.numPages);
    if(!isContiguous(pages))throw new Error('A numeração sequencial só pode ser aplicada a um intervalo contínuo. Defina e numere separadamente cada bloco.');
    const start=Number($('printedPage').value);numberPrintedInterval(state,pages,start);
    $('printedPage').value=state.printedPages[state.page]||'';renderDoc();markDirty();setStatus(`Intervalo PDF ${pages[0]}-${pages[pages.length-1]} numerado a partir de [MR, p. ${start}].`)
  }catch(e){alert(e.message)}
};

let drag=null;
canvas.addEventListener('pointerdown',e=>{if(!state.pdf)return;const r=canvas.getBoundingClientRect();drag={x:(e.clientX-r.left)*(canvas.width/r.width),y:(e.clientY-r.top)*(canvas.height/r.height)};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const r=canvas.getBoundingClientRect();const x=(e.clientX-r.left)*(canvas.width/r.width),y=(e.clientY-r.top)*(canvas.height/r.height);const sel={x:Math.min(drag.x,x),y:Math.min(drag.y,y),w:Math.abs(x-drag.x),h:Math.abs(y-drag.y)};showSelection(sel)});
canvas.addEventListener('pointerup',e=>{if(!drag)return;const r=canvas.getBoundingClientRect();const x=(e.clientX-r.left)*(canvas.width/r.width),y=(e.clientY-r.top)*(canvas.height/r.height);state.selection={x:Math.min(drag.x,x),y:Math.min(drag.y,y),w:Math.abs(x-drag.x),h:Math.abs(y-drag.y)};drag=null;showSelection(state.selection)});
function showSelection(sel){const s=$('selection');s.style.display='block';s.style.left=`${canvas.offsetLeft+sel.x}px`;s.style.top=`${canvas.offsetTop+sel.y}px`;s.style.width=`${sel.w}px`;s.style.height=`${sel.h}px`}
function selectedText(){
  if(!state.selection)return '';
  const s=state.selection; const hits=state.textItems.filter(i=>{const cx=i.x+i.w/2,cy=i.y+i.h/2;return cx>=s.x&&cx<=s.x+s.w&&cy>=s.y&&cy<=s.y+s.h});
  hits.sort((a,b)=>Math.abs(a.y-b.y)>6?a.y-b.y:a.x-b.x);
  const lines=[]; for(const it of hits){let line=lines.find(l=>Math.abs(l.y-it.y)<6);if(!line){line={y:it.y,items:[]};lines.push(line)}line.items.push(it)}
  lines.sort((a,b)=>a.y-b.y); return lines.map(l=>l.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
}
async function cropSelection(){
  const s=state.selection||{x:0,y:0,w:canvas.width,h:canvas.height}; const c=document.createElement('canvas');c.width=Math.max(1,Math.round(s.w));c.height=Math.max(1,Math.round(s.h));c.getContext('2d').drawImage(canvas,s.x,s.y,s.w,s.h,0,0,c.width,c.height);return c;
}
async function cropSelectionAtDpi(dpi){
  const selection=state.selection||{x:0,y:0,w:canvas.width,h:canvas.height};
  const page=await state.pdf.getPage(state.page); const targetScale=dpi/72; const viewport=page.getViewport({scale:targetScale});
  const full=document.createElement('canvas'); full.width=Math.max(1,Math.round(viewport.width));full.height=Math.max(1,Math.round(viewport.height));
  await page.render({canvasContext:full.getContext('2d'),viewport}).promise;
  const sx=selection.x/canvas.width*full.width, sy=selection.y/canvas.height*full.height;
  const sw=selection.w/canvas.width*full.width, sh=selection.h/canvas.height*full.height;
  const x=Math.max(0,Math.floor(sx)), y=Math.max(0,Math.floor(sy));
  const w=Math.max(1,Math.min(full.width-x,Math.ceil(sw))), h=Math.max(1,Math.min(full.height-y,Math.ceil(sh)));
  const out=document.createElement('canvas');out.width=w;out.height=h;out.getContext('2d').drawImage(full,x,y,w,h,0,0,w,h);return out;
}
async function cropPdfRectAtDpi(pdfPage,rect,dpi=FACSIMILE_DPI){
  if(!state.pdf)throw new Error('Abra o PDF de origem para reconstruir o fac-símile.');
  if(!Array.isArray(rect)||rect.length!==4)throw new Error('Fac-símile importado sem coordenadas válidas.');
  const page=await state.pdf.getPage(Number(pdfPage));
  const base=page.getViewport({scale:1});
  const target=page.getViewport({scale:dpi/72});
  const full=document.createElement('canvas');full.width=Math.max(1,Math.round(target.width));full.height=Math.max(1,Math.round(target.height));
  await page.render({canvasContext:full.getContext('2d'),viewport:target}).promise;
  const [x0,y0,x1,y1]=rect.map(Number);
  if(![x0,y0,x1,y1].every(Number.isFinite)||x1<=x0||y1<=y0)throw new Error('Fac-símile importado com coordenadas inválidas.');
  const sx=full.width/base.width,sy=full.height/base.height;
  const x=Math.max(0,Math.floor(x0*sx)),y=Math.max(0,Math.floor(y0*sy));
  const right=Math.min(full.width,Math.ceil(x1*sx)),bottom=Math.min(full.height,Math.ceil(y1*sy));
  const w=right-x,h=bottom-y;if(w<2||h<2)throw new Error('O recorte do fac-símile importado ficou vazio.');
  const out=document.createElement('canvas');out.width=w;out.height=h;out.getContext('2d').drawImage(full,x,y,w,h,0,0,w,h);return out;
}
async function hydrateLegacyFacsimiles(){
  let count=0;
  for(let i=0;i<state.items.length;i++){
    const item=state.items[i];
    if(item.type!=='facsimile'||item.image)continue;
    const rect=item.legacyRect||item.rect;
    if(!rect)throw new Error(`Fac-símile ${i+1} do projeto importado não possui coordenadas para reconstrução.`);
    const canvas=await cropPdfRectAtDpi(item.pdfPage,rect,FACSIMILE_DPI);
    item.image=canvas.toDataURL('image/png');item.imageDpi=FACSIMILE_DPI;item.legacyRect=rect;count++;
  }
  return count;
}
let ocrWorkerPromise=null;
async function getOcrWorker(){
  if(!ocrWorkerPromise){
    ocrWorkerPromise=(async()=>{
      const mod=await import('./vendor/tesseract/tesseract.esm.min.js');
      const tesseract=mod.default||mod;
      if(typeof tesseract.createWorker!=='function')throw new Error('A biblioteca local de OCR não expõe createWorker.');
      const base=new URL('./vendor/tesseract/',location.href);
      return tesseract.createWorker('por',1,{
        workerPath:new URL('worker.min.js',base).href,
        langPath:new URL('lang',base).href.replace(/\/$/,''),
        corePath:new URL('core',base).href.replace(/\/$/,'')
      });
    })().catch(err=>{ocrWorkerPromise=null;throw err});
  }
  return ocrWorkerPromise;
}
async function ocrSelection(){
  setStatus('Reconhecendo texto localmente no navegador…'); const c=await cropSelection();
  try{const worker=await getOcrWorker();const res=await worker.recognize(c);return normalizeLines(res.data.text.trim())}
  catch(err){ocrWorkerPromise=null;throw new Error('O OCR local não pôde ser iniciado. '+err.message)}
}

// Aparo equivalente à edição Linux: limiar claro e margem de segurança de 1,5 mm.
function trimCanvasWhitespace(source,dpi=FACSIMILE_DPI,safetyMarginMm=1.5,threshold=248){
  const w=source.width,h=source.height, data=source.getContext('2d').getImageData(0,0,w,h).data;
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const k=(y*w+x)*4, a=data[k+3], r=data[k],g=data[k+1],b=data[k+2];
    if(a>10 && (r<threshold || g<threshold || b<threshold)){
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
    }
  }
  if(maxX<0||maxY<0) return {canvas:source,changed:false};
  const padding=Math.max(1,Math.round(dpi*safetyMarginMm/25.4));
  minX=Math.max(0,minX-padding);minY=Math.max(0,minY-padding);maxX=Math.min(w-1,maxX+padding);maxY=Math.min(h-1,maxY+padding);
  const tw=maxX-minX+1,th=maxY-minY+1;
  if(tw>=w-2 && th>=h-2) return {canvas:source,changed:false};
  const c=document.createElement('canvas');c.width=tw;c.height=th;c.getContext('2d').drawImage(source,minX,minY,tw,th,0,0,tw,th);
  return {canvas:c,changed:true};
}
function canvasFromDataUrl(url){return new Promise((resolve,reject)=>{if(!url){reject(new Error('Fac-símile sem imagem armazenada.'));return}const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);resolve(c)};img.onerror=()=>reject(new Error('Não foi possível ler a imagem do fac-símile armazenado no projeto.'));img.src=url})}
function setFacsimilePreview(original,trimmed,trimEnabled,changed){
  $('facOriginal').src=original.toDataURL('image/png');
  $('facTrim').disabled=!changed;
  $('facTrim').checked=!!trimEnabled && changed;
  const chosen=$('facTrim').checked?trimmed:original;
  $('facResult').src=chosen.toDataURL('image/png');
  $('facDimensions').textContent=$('facTrim').checked?`Original: ${original.width} × ${original.height} px → Prévia aparada: ${trimmed.width} × ${trimmed.height} px`:`Sem aparo: ${original.width} × ${original.height} px`;
}
async function openFacsimileDialog(originalCanvas,initialTrim=true,imageDpi=FACSIMILE_DPI){
  const t=trimCanvasWhitespace(originalCanvas,imageDpi); const trimmed=t.canvas;
  setFacsimilePreview(originalCanvas,trimmed,initialTrim,t.changed);
  return await new Promise(resolve=>{
    const dlg=$('facDialog');
    const onToggle=()=>setFacsimilePreview(originalCanvas,trimmed,$('facTrim').checked,t.changed);
    $('facTrim').addEventListener('change',onToggle);
    const clean=()=>{$('facTrim').removeEventListener('change',onToggle);$('facOk').onclick=null;$('facCancel').onclick=null};
    $('facOk').onclick=()=>{const enabled=$('facTrim').checked&&t.changed;clean();dlg.close();resolve({ok:true,trim:enabled})};
    $('facCancel').onclick=()=>{clean();dlg.close();resolve({ok:false,trim:false})};
    dlg.showModal();
  });
}

// Na conferência: Enter cria parágrafo; Shift+Enter cria quebra manual. A Antífona também preserva TAB real.
$('reviewText').addEventListener('keydown',e=>{
  const style=state.pending?.style; const ta=e.currentTarget;
  if(e.key==='Tab' && style==='Antífona'){
    e.preventDefault(); const start=ta.selectionStart,end=ta.selectionEnd;ta.setRangeText('\t',start,end,'end');ta.dispatchEvent(new Event('input',{bubbles:true}));return;
  }
  const br=editorBreak(e.key,e.shiftKey,style);
  if(br!==null){e.preventDefault();const start=ta.selectionStart,end=ta.selectionEnd;ta.setRangeText(br,start,end,'end');ta.dispatchEvent(new Event('input',{bubbles:true}))}
});

function currentPrintedPage(){
  const mapped=Number(state.printedPages[state.page]||0);if(mapped>0)return mapped;
  alert('Esta página física ainda não foi associada à página impressa do Missal. Informe o número e use “Associar à página atual” antes de incluir o trecho.');return null;
}
document.querySelectorAll('[data-style]').forEach(btn=>btn.onclick=async()=>{
  if(!state.selection||state.selection.w<4||state.selection.h<4){alert('Selecione primeiro uma região da página.');return}
  const style=btn.dataset.style; const printed=currentPrintedPage(); if(!printed)return;
  if(style==='Fac-símile'){
    const c=await cropSelectionAtDpi(FACSIMILE_DPI); const choice=await openFacsimileDialog(c,true,FACSIMILE_DPI); if(!choice.ok)return;
    addItem({type:'facsimile',style,pdfPage:state.page,printedPage:printed,image:c.toDataURL('image/png'),imageDpi:FACSIMILE_DPI,trimWhitespace:choice.trim,reviewed:true});return;
  }
  let text=selectedText(),source='camada de texto do PDF'; if(!text){try{text=await ocrSelection();source='OCR local no navegador'}catch(err){alert(err.message);return}}
  state.pending={mode:'new',style,pdfPage:state.page,printedPage:printed}; $('reviewText').value=text; $('reviewSource').textContent=`Origem: ${source}. O texto abaixo é editável.`;$('checkedOriginal').checked=false;$('review').hidden=false;$('tipsBox').hidden=true;$('reviewText').focus();scheduleRecovery();
});
function addItem(item){state.items.push({...item,reviewed:item.reviewed??true});state.selectedItem=state.items.length-1;renderDoc();markDirty();updateProjectButtons()}
$('confirmReview').onclick=()=>{if(!state.pending)return;const mode=state.pending.mode;const text=normalizeLines($('reviewText').value);const data={...state.pending,text,reviewed:$('checkedOriginal').checked};delete data.mode;if(mode==='edit'){state.items[state.pending.index]={...state.items[state.pending.index],...data};markDirty()}else addItem(data);state.pending=null;$('review').hidden=true;renderDoc();scheduleRecovery()};
$('cancelReview').onclick=()=>{state.pending=null;$('review').hidden=true;if(projectDirty)scheduleRecovery();else clearRecovery()};
$('reviewText').addEventListener('input',()=>{if(state.pending)scheduleRecovery()});
$('checkedOriginal').addEventListener('change',()=>{if(state.pending)scheduleRecovery()});
$('tipsBtn').onclick=()=>{const box=$('tipsBox');const ant=state.pending?.style==='Antífona';box.innerHTML=`<p>Este texto é editável. Aproveite esta etapa para corrigir a transcrição. Enter inicia um novo parágrafo; Shift+Enter insere apenas uma quebra de linha dentro do mesmo parágrafo.</p>${ant?'<p>Em cada linha da antífona que contenha uma indicação rubrical, como “Antífona da entrada”, “Antífona da comunhão”, citação, “Hino” ou “Ou:”, insira uma tabulação entre a indicação e o texto. O programa alinhará o texto e deixará a rubrica em vermelho.</p>':''}`;box.hidden=!box.hidden};

function renderDoc(){
  const list=$('docList');list.innerHTML='';state.items.forEach((it,i)=>{const li=document.createElement('li');li.className=i===state.selectedItem?'selected':'';li.textContent=it.type==='spacer'?'Espaçador':it.type==='facsimile'?`[MR ${it.printedPage}] Fac-símile — PDF p. ${it.pdfPage}`:`[MR ${it.printedPage}] ${it.style} — ${(it.text||'').split(/\n/)[0].slice(0,42)}`;li.onclick=()=>{state.selectedItem=i;renderDoc()};li.ondblclick=()=>editItem(i);list.appendChild(li)})
}
async function editItem(i){
  const it=state.items[i];if(!it)return;
  if(it.type==='spacer')return;
  if(it.type==='facsimile'){
    try{const c=await canvasFromDataUrl(it.image);const dpi=Number(it.imageDpi)||LEGACY_FACSIMILE_DPI;const choice=await openFacsimileDialog(c,it.trimWhitespace!==false,dpi);if(choice.ok){it.trimWhitespace=choice.trim;renderDoc();markDirty()}}catch(e){alert('Não foi possível revisar o fac-símile: '+e.message)}
    return;
  }
  state.pending={mode:'edit',index:i,style:it.style,pdfPage:it.pdfPage,printedPage:it.printedPage};$('reviewText').value=it.text||'';$('checkedOriginal').checked=!!it.reviewed;$('reviewSource').textContent='Revisão de trecho já incluído no documento.';$('review').hidden=false;$('tipsBox').hidden=true;scheduleRecovery()
}
$('reviewBtn').onclick=()=>editItem(state.selectedItem);
$('deleteBtn').onclick=()=>{if(state.selectedItem<0)return;state.items.splice(state.selectedItem,1);state.selectedItem=Math.min(state.selectedItem,state.items.length-1);renderDoc();markDirty();updateProjectButtons()};
$('upBtn').onclick=()=>move(-1);$('downBtn').onclick=()=>move(1);function move(d){const i=state.selectedItem,j=i+d;if(i<0||j<0||j>=state.items.length)return;[state.items[i],state.items[j]]=[state.items[j],state.items[i]];state.selectedItem=j;renderDoc();markDirty()}
$('spacerBtn').onclick=()=>{const item={type:'spacer',style:'Espaçador'};const at=state.selectedItem>=0?state.selectedItem+1:state.items.length;state.items.splice(at,0,item);state.selectedItem=at;renderDoc();markDirty();updateProjectButtons()};

// Fontes: usa Local Font Access quando disponível e aceita nome manual quando o navegador não permite enumerar o sistema.
async function getAvailableFonts(){
  if(typeof window.queryLocalFonts==='function'){
    try{
      const rows=await window.queryLocalFonts();
      const found=[...new Set(rows.map(x=>x.family).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      if(found.length){state.availableFonts=found;state.localFontAccess='granted';return found}
      state.localFontAccess='empty';
    }catch(e){state.localFontAccess='denied'}
  }else state.localFontAccess='unsupported';
  state.availableFonts=[];return [];
}
function fontPriorityOrder(families){
  const out=[]; const lower=new Map(families.map(f=>[f.toLocaleLowerCase('pt-BR'),f]));
  for(const p of FONT_PRIORITY){const aliases=p==='Study-Regular'?['study-regular','study regular','study']: [p.toLocaleLowerCase('pt-BR')];for(const a of aliases){if(lower.has(a)&&!out.includes(lower.get(a)))out.push(lower.get(a))}}
  for(const f of families)if(!out.includes(f))out.push(f);return out;
}
function fillFontSelect(fonts){
  const sel=$('fontSelect');sel.innerHTML='';
  const preferred=fontPriorityOrder(fonts).filter(f=>FONT_PRIORITY.some(p=>p.toLocaleLowerCase('pt-BR')===f.toLocaleLowerCase('pt-BR')||(p==='Study-Regular'&&['study','study regular','study-regular'].includes(f.toLocaleLowerCase('pt-BR')))));
  const other=fontPriorityOrder(fonts).filter(f=>!preferred.includes(f));
  const addGroup=(label,rows)=>{if(!rows.length)return;const g=document.createElement('optgroup');g.label=label;rows.forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;g.appendChild(o)});sel.appendChild(g)};
  addGroup('Preferenciais',preferred);addGroup('Outras fontes instaladas',other);
  if(!fonts.length){FONT_PRIORITY.forEach(f=>{const o=document.createElement('option');o.value=f;o.textContent=f;sel.appendChild(o)})}
}
async function chooseFont(){
  const fonts=await getAvailableFonts();fillFontSelect(fonts);const sel=$('fontSelect'), custom=$('fontCustom');
  const list=fonts.length?fonts:FONT_PRIORITY;if(list.includes(state.selectedFont))sel.value=state.selectedFont;else custom.value=state.selectedFont&&!FONT_PRIORITY.includes(state.selectedFont)?state.selectedFont:'';
  if(state.localFontAccess==='granted')$('fontNote').textContent=`${fonts.length} família(s) tipográfica(s) identificada(s) pelo navegador neste computador.`;
  else $('fontNote').textContent='O navegador não permitiu enumerar todas as fontes instaladas. Você pode escolher uma das preferenciais ou digitar abaixo o nome exato de outra fonte instalada.';
  const preview=()=>{const family=(custom.value.trim()||sel.value||state.selectedFont);$('fontPreview').style.fontFamily=`"${family.replaceAll('"','\\"')}", serif`};
  custom.value=''; if(!list.includes(state.selectedFont)&&state.selectedFont)custom.value=state.selectedFont;preview();sel.onchange=()=>{custom.value='';preview()};custom.oninput=preview;
  const dlg=$('fontDialog'); const ok=await new Promise(resolve=>{$('fontOk').onclick=()=>{dlg.close();resolve(true)};$('fontCancel').onclick=()=>{dlg.close();resolve(false)};dlg.showModal()});
  if(ok){const chosen=custom.value.trim()||sel.value||'Times New Roman';if(chosen!==state.selectedFont){state.selectedFont=chosen;updateFontLabel();markDirty()}else updateFontLabel()}
}
function updateFontLabel(){$('fontLabel').textContent=`Fonte do documento: ${state.selectedFont}`}
$('fontBtn').onclick=chooseFont; updateFontLabel();

$('saveProjectBtn').onclick=async()=>{const project={format:'MR Excertos Web',version:'1.0',pdfName:state.pdfName,sourceSha256:state.sourceSha256,printedPages:state.printedPages,requestedPages:state.requestedPages,items:state.items,selectedFont:state.selectedFont};downloadBlob(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),`${pageRangeName()}.mrproj.json`);await markClean();setStatus('Projeto salvo. A proteção contra saída será reativada quando houver nova alteração.')};
$('projectInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;const p=migrateProject(JSON.parse(await f.text()));state.pdf=null;state.pdfName=p.pdfName||'';state.sourceSha256=p.sourceSha256||'';state.importedFromDesktop=!!p.importedFromDesktop;state.printedPages=p.printedPages||{};state.requestedPages=p.requestedPages||[];state.items=p.items||[];state.selectedFont=p.selectedFont||'Times New Roman';state.selectedItem=state.items.length?0:-1;state.pending=null;projectDirty=false;refreshProjectUiWithoutPdf();await clearRecovery();alert(`Projeto aberto. PDF associado: ${p.pdfName||'não informado'}. Abra o PDF original para continuar a selecionar trechos.`)});

// ----- Geração ODT a partir do mesmo modelo material da edição Linux -----
const NS={office:'urn:oasis:names:tc:opendocument:xmlns:office:1.0',style:'urn:oasis:names:tc:opendocument:xmlns:style:1.0',text:'urn:oasis:names:tc:opendocument:xmlns:text:1.0',draw:'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',svg:'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',fo:'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',xlink:'http://www.w3.org/1999/xlink',manifest:'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0'};
function parseXml(s){const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw new Error('XML inválido no modelo ODT.');return d}
function serializeXml(d){return '<?xml version="1.0" encoding="UTF-8"?>'+new XMLSerializer().serializeToString(d.documentElement)}
function xel(doc,ns,name){return doc.createElementNS(ns,name)}
function setAttr(el,ns,name,val){el.setAttributeNS(ns,name,val)}
function appendText(doc,p,text){p.appendChild(doc.createTextNode(text))}
function appendTextWithBreaks(doc,p,text){
  const lines=normalizeLines(text).split('\n'); lines.forEach((line,li)=>{if(li)p.appendChild(xel(doc,NS.text,'text:line-break'));const parts=line.split('\t');parts.forEach((part,pi)=>{if(pi)p.appendChild(xel(doc,NS.text,'text:tab'));appendText(doc,p,part)})});
}
function addParagraph(doc,body,style,text){const p=xel(doc,NS.text,'text:p');setAttr(p,NS.text,'text:style-name',style);appendTextWithBreaks(doc,p,text);body.appendChild(p);return p}
function antiphonGroups(text){const lines=normalizeLines(text).split('\n');const out=[];let cur=[];for(const line of lines){if(!line.trim()){if(cur.length){out.push(cur);cur=[]}continue}if(line.includes('\t')&&cur.length){out.push(cur);cur=[]}cur.push(line)}if(cur.length)out.push(cur);return out}
function addAntiphon(doc,body,text){
  for(const lines of antiphonGroups(text)){const p=xel(doc,NS.text,'text:p');setAttr(p,NS.text,'text:style-name','MR_Antifona');body.appendChild(p);lines.forEach((line,i)=>{if(i)p.appendChild(xel(doc,NS.text,'text:line-break'));const tab=line.indexOf('\t');if(tab>=0){const label=line.slice(0,tab),rest=line.slice(tab+1);if(label){const span=xel(doc,NS.text,'text:span');setAttr(span,NS.text,'text:style-name','MR_Rotulo_antifona');appendText(doc,span,label);p.appendChild(span)}p.appendChild(xel(doc,NS.text,'text:tab'));appendTextWithBreaks(doc,p,rest)}else appendTextWithBreaks(doc,p,line)})}
}
function ensureAntiphonLabelStyle(stylesDoc){
  const stylesRoot=stylesDoc.getElementsByTagNameNS(NS.office,'styles')[0];let st=[...stylesRoot.getElementsByTagNameNS(NS.style,'style')].find(e=>e.getAttributeNS(NS.style,'name')==='MR_Rotulo_antifona');
  if(!st){st=xel(stylesDoc,NS.style,'style:style');setAttr(st,NS.style,'style:name','MR_Rotulo_antifona');setAttr(st,NS.style,'style:display-name','Rótulo da antífona');setAttr(st,NS.style,'style:family','text');stylesRoot.appendChild(st)}
  let tp=[...st.children].find(e=>e.namespaceURI===NS.style&&e.localName==='text-properties');if(!tp){tp=xel(stylesDoc,NS.style,'style:text-properties');st.appendChild(tp)}setAttr(tp,NS.fo,'fo:color','#ff0000');setAttr(tp,NS.fo,'fo:font-style','normal');setAttr(tp,NS.fo,'fo:font-weight','normal');setAttr(tp,NS.style,'style:font-name','MRFonteTexto');setAttr(tp,NS.fo,'fo:font-family',state.selectedFont);
}
function applyFontToStyles(stylesDoc){
  const faces=[...stylesDoc.getElementsByTagNameNS(NS.style,'font-face')];const face=faces.find(e=>e.getAttributeNS(NS.style,'name')==='MRFonteTexto');if(face)setAttr(face,NS.svg,'svg:font-family',state.selectedFont);
  const named=['MR_Texto_liturgico','MR_Cabecalho_dia','MR_Antifona','MR_Rubrica','MR_Titulos','MR_Facsimile','MR_Espacador'];
  for(const st of [...stylesDoc.getElementsByTagNameNS(NS.style,'style')]){if(!named.includes(st.getAttributeNS(NS.style,'name')))continue;const tp=[...st.children].find(e=>e.namespaceURI===NS.style&&e.localName==='text-properties');if(tp){setAttr(tp,NS.fo,'fo:font-family',state.selectedFont);setAttr(tp,NS.style,'style:font-name','MRFonteTexto')}}
  ensureAntiphonLabelStyle(stylesDoc);
}
async function facsimileForExport(item){const rect=item.legacyRect||item.rect;const orig=item.image?await canvasFromDataUrl(item.image):await cropPdfRectAtDpi(item.pdfPage,rect,Number(item.imageDpi)||FACSIMILE_DPI);if(item.trimWhitespace===false)return orig;return trimCanvasWhitespace(orig,Number(item.imageDpi)||FACSIMILE_DPI).canvas}
async function makeOdt(){
  const tpl=await fetch('assets/Modelo_MR_Excertos.odt');if(!tpl.ok)throw new Error('ODT-modelo não encontrado.');const zip=await JSZip.loadAsync(await tpl.arrayBuffer());
  const mime=await zip.file('mimetype').async('string');zip.file('mimetype',mime,{compression:'STORE'});
  const contentDoc=parseXml(await zip.file('content.xml').async('string')); const stylesDoc=parseXml(await zip.file('styles.xml').async('string')); const manifestDoc=parseXml(await zip.file('META-INF/manifest.xml').async('string'));
  applyFontToStyles(stylesDoc);
  const body=contentDoc.getElementsByTagNameNS(NS.office,'text')[0]; while(body.firstChild)body.removeChild(body.firstChild);
  const manifestRoot=manifestDoc.documentElement; let lastPrinted=null,imgN=0;
  const map={'Texto litúrgico':'MR_Texto_liturgico','Cabeçalho do dia':'MR_Cabecalho_dia','Rubrica':'MR_Rubrica','Títulos':'MR_Titulos'};
  for(let itemIndex=0;itemIndex<state.items.length;itemIndex++){
    const it=state.items[itemIndex];
    if(it.type==='spacer'){addParagraph(contentDoc,body,'MR_Espacador','');continue}
    const printed=Number(it.printedPage)||Number(state.printedPages[it.pdfPage])||0;
    if(!printed)throw new Error(`O item ${itemIndex+1} não possui página impressa do Missal associada.`);
    if(printed!==lastPrinted){addParagraph(contentDoc,body,'MR_Referencia_pagina',`[MR, p. ${printed}]`);lastPrinted=printed}
    if(it.type==='facsimile'){
      imgN++;const c=await facsimileForExport(it);const name=`Pictures/facsimile_${String(imgN).padStart(4,'0')}.png`;const b64=c.toDataURL('image/png').split(',')[1];zip.file(name,b64,{base64:true});
      const p=xel(contentDoc,NS.text,'text:p');setAttr(p,NS.text,'text:style-name','MR_Facsimile');body.appendChild(p);
      const frame=xel(contentDoc,NS.draw,'draw:frame');setAttr(frame,NS.draw,'draw:name',`Fac-símile ${imgN}`);setAttr(frame,NS.text,'text:anchor-type','as-char');
      const widthCm=Math.min(16.3,22.0*c.width/c.height),heightCm=widthCm*c.height/c.width;setAttr(frame,NS.svg,'svg:width',`${widthCm.toFixed(3)}cm`);setAttr(frame,NS.svg,'svg:height',`${heightCm.toFixed(3)}cm`);p.appendChild(frame);
      const image=xel(contentDoc,NS.draw,'draw:image');setAttr(image,NS.xlink,'xlink:href',name);setAttr(image,NS.xlink,'xlink:type','simple');setAttr(image,NS.xlink,'xlink:show','embed');setAttr(image,NS.xlink,'xlink:actuate','onLoad');frame.appendChild(image);
      const me=xel(manifestDoc,NS.manifest,'manifest:file-entry');setAttr(me,NS.manifest,'manifest:full-path',name);setAttr(me,NS.manifest,'manifest:media-type','image/png');manifestRoot.appendChild(me);continue;
    }
    if(it.style==='Antífona')addAntiphon(contentDoc,body,it.text||'');else for(const paragraph of paragraphGroups(normalizeLines(it.text||'')))addParagraph(contentDoc,body,map[it.style]||'MR_Texto_liturgico',paragraph);
  }
  zip.file('content.xml',serializeXml(contentDoc));zip.file('styles.xml',serializeXml(stylesDoc));zip.file('META-INF/manifest.xml',serializeXml(manifestDoc));
  return await zip.generateAsync({type:'blob',mimeType:'application/vnd.oasis.opendocument.text',compression:'DEFLATE'});
}
$('odtBtn').onclick=async()=>{
  if(!state.items.length){alert('O documento ainda está vazio.');return}
  const pending=state.items.filter(i=>i.type!=='facsimile'&&i.type!=='spacer'&&!i.reviewed).length;
  if(pending&&!confirm(`Há ${pending} trecho(s) textual(is) ainda não conferido(s) com o original. Gerar mesmo assim?`))return;
  try{downloadBlob(await makeOdt(),`${pageRangeName()}.odt`)}catch(err){console.error(err);alert('Não foi possível gerar o ODT: '+errorText(err))}
};

window.addEventListener('beforeunload',e=>{if(hasUnsavedWork()){e.preventDefault();e.returnValue=''}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&hasUnsavedWork())persistRecoveryNow()});
window.addEventListener('pagehide',()=>{if(hasUnsavedWork())persistRecoveryNow()});

$('helpBtn').onclick=()=>window.open('manual.html','_blank');
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredInstall=e;$('installBtn').hidden=false});$('installBtn').onclick=async()=>{if(state.deferredInstall){state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;$('installBtn').hidden=true}};
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(console.warn);
  let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading)return;if(hasUnsavedWork()){setStatus('Atualização instalada. Salve o projeto antes de recarregar a página.');return}reloading=true;location.reload()});
}
renderDoc();
updateProjectButtons();
await offerRecoveryIfPresent();
document.documentElement.dataset.mrReady='1.0';
