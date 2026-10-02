export function parsePageSpec(spec,maxPage){
  const s=String(spec||'').trim();
  if(!s) throw new Error('Informe uma página ou um intervalo de páginas do arquivo PDF.');
  const selected=new Set();
  for(const raw of s.split(',')){
    const token=raw.trim();
    const m=token.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if(!m) throw new Error(`Expressão inválida: “${token||'(vazia)'}”. Use, por exemplo, 298, 1024-1026.`);
    const a=Number(m[1]), b=Number(m[2]||m[1]);
    if(a>b) throw new Error(`Intervalo invertido: ${a}-${b}. Escreva do menor para o maior.`);
    if(a<1 || b>maxPage) throw new Error(`O intervalo ${a===b?a:`${a}-${b}`} excede as ${maxPage} páginas físicas deste PDF.`);
    for(let p=a;p<=b;p++)selected.add(p);
  }
  return [...selected].sort((a,b)=>a-b);
}
export function isContiguous(pages){
  const p=[...new Set((pages||[]).map(Number).filter(n=>n>0))].sort((a,b)=>a-b);
  return p.length>0 && p.every((n,i)=>i===0||n===p[i-1]+1);
}
export function compactPages(pages){
  const p=[...new Set((pages||[]).map(Number).filter(n=>n>0))].sort((a,b)=>a-b);
  if(!p.length)return '';
  const chunks=[]; let start=p[0],prev=p[0];
  for(let i=1;i<=p.length;i++){
    const n=p[i];
    if(n===prev+1){prev=n;continue}
    chunks.push(start===prev?String(start):`${start}-${prev}`);
    start=prev=n;
  }
  return chunks.join('_');
}
export function mrPagesForNaming(state){
  const itemPages=[...new Set((state.items||[]).filter(i=>i.type!=='spacer'&&Number(i.printedPage)>0).map(i=>Number(i.printedPage)))].sort((a,b)=>a-b);
  if(itemPages.length)return itemPages;
  const requested=(state.requestedPages||[]).map(Number).filter(n=>n>0);
  const mapped=[...new Set(requested.map(p=>Number(state.printedPages?.[p]||0)).filter(n=>n>0))].sort((a,b)=>a-b);
  if(mapped.length)return mapped;
  return [...new Set(Object.values(state.printedPages||{}).map(Number).filter(n=>n>0))].sort((a,b)=>a-b);
}
export function suggestedBaseName(state){
  const compact=compactPages(mrPagesForNaming(state));
  return compact?`MR_recorte_p${compact}`:'MR_recorte';
}
export function associatePrintedPage(state,pdfPage,mrPage){
  const pdf=Number(pdfPage), mr=Number(mrPage);
  if(!(pdf>0&&mr>0))throw new Error('Informe números de página válidos.');
  state.printedPages[pdf]=mr;
  for(const item of state.items||[]){if(Number(item.pdfPage)===pdf)item.printedPage=mr;}
}
export function numberPrintedInterval(state,pages,startMr){
  const ordered=[...new Set((pages||[]).map(Number).filter(n=>n>0))].sort((a,b)=>a-b);
  if(!isContiguous(ordered))throw new Error('A numeração sequencial só pode ser aplicada a um intervalo contínuo. Numere separadamente cada bloco de páginas físicas.');
  const start=Number(startMr);if(!(start>0))throw new Error('Informe a página impressa correspondente à primeira página do intervalo.');
  ordered.forEach((pdf,i)=>associatePrintedPage(state,pdf,start+i));
}

const CANONICAL_TO_STYLE={
  text:'Texto litúrgico',
  rubric:'Rubrica',
  titles:'Títulos',
  title:'Títulos',
  day_heading:'Cabeçalho do dia',
  antiphon:'Antífona'
};
const STYLE_TO_CANONICAL={
  'Texto litúrgico':'text',
  'Rubrica':'rubric',
  'Títulos':'titles',
  'Cabeçalho do dia':'day_heading',
  'Antífona':'antiphon'
};

function normalizedRect(rect){
  if(rect==null)return null;
  if(!Array.isArray(rect)||rect.length!==4)throw new Error('Projeto inválido: coordenadas de recorte incorretas.');
  const out=rect.map(Number);
  if(!out.every(Number.isFinite))throw new Error('Projeto inválido: coordenadas de recorte incorretas.');
  return out;
}

export function projectFromCanonical(project){
  const raw=project||{};
  const pageMap={};
  for(const [pdf,mr] of Object.entries(raw.page_map||{})){
    const p=Number(pdf),m=Number(mr);
    if(p>0&&m>0)pageMap[p]=m;
  }
  const items=(raw.items||[]).map((item,index)=>{
    const i=item||{};
    const kind=i.type==='title'?'titles':i.type;
    if(kind==='spacer'){
      return {
        type:'spacer',style:'Espaçador',id:String(i.id||''),pdfPage:0,printedPage:0,rect:null,text:'',
        reviewed:true,trimWhitespace:true
      };
    }
    const pdfPage=Number(i.pdf_page)||0;
    const printedPage=Number(i.mr_page)||Number(pageMap[pdfPage])||0;
    if(!(pdfPage>0))throw new Error(`Projeto inválido: item ${index+1} sem página física do PDF.`);
    if(!(printedPage>0))throw new Error(`Projeto inválido: item ${index+1} sem página impressa do Missal.`);
    if(kind==='facsimile'){
      return {
        type:'facsimile',style:'Fac-símile',id:String(i.id||''),pdfPage,printedPage,rect:normalizedRect(i.rect),
        text:'',reviewed:!!i.reviewed,trimWhitespace:i.trim_whitespace!==false,image:null,imageDpi:0
      };
    }
    const style=CANONICAL_TO_STYLE[kind];
    if(!style)throw new Error(`Tipo de trecho não reconhecido no item ${index+1}: ${i.type}`);
    return {
      type:'text',canonicalType:kind,style,id:String(i.id||''),pdfPage,printedPage,rect:normalizedRect(i.rect),
      text:String(i.text||''),reviewed:!!i.reviewed,trimWhitespace:i.trim_whitespace!==false
    };
  });
  const sourcePdf=String(raw.source_pdf||'');
  const pdfName=sourcePdf.split(/[\\/]/).filter(Boolean).pop()||'';
  return {
    title:String(raw.title||'Excertos do Missal Romano'),
    sourcePdf,pdfName,sourceSha256:String(raw.source_sha256||''),
    printedPages:pageMap,items,
    preferredFont:String(raw.preferred_font||'Times New Roman'),
    selectedFont:String(raw.selected_font||raw.preferred_font||'Times New Roman'),
    monoFont:String(raw.mono_font||''),
    fontManual:!!raw.font_manual,
    requestedPages:[...new Set((raw.requested_pages||[]).map(Number).filter(n=>n>0))].sort((a,b)=>a-b)
  };
}

export function projectToCanonical(state){
  const items=(state.items||[]).map((item,index)=>{
    const i=item||{};
    if(i.type==='spacer'){
      return {
        type:'spacer',pdf_page:0,mr_page:0,rect:null,text:'',id:String(i.id||''),
        reviewed:true,trim_whitespace:true
      };
    }
    const pdfPage=Number(i.pdfPage)||0;
    const mrPage=Number(i.printedPage)||Number(state.printedPages?.[pdfPage])||0;
    if(!(pdfPage>0))throw new Error(`Não é possível salvar: item ${index+1} sem página física do PDF.`);
    if(!(mrPage>0))throw new Error(`Não é possível salvar: item ${index+1} sem página impressa do Missal.`);
    const rect=normalizedRect(i.rect);
    let kind;
    if(i.type==='facsimile')kind='facsimile';
    else kind=STYLE_TO_CANONICAL[i.style]||i.canonicalType;
    if(!kind)throw new Error(`Não é possível salvar: estilo não reconhecido no item ${index+1}.`);
    return {
      type:kind,pdf_page:pdfPage,mr_page:mrPage,rect,text:i.type==='facsimile'?'':String(i.text||''),
      id:String(i.id||''),reviewed:!!i.reviewed,trim_whitespace:i.trimWhitespace!==false
    };
  });
  const pageMap={};
  for(const [pdf,mr] of Object.entries(state.printedPages||{})){
    const p=Number(pdf),m=Number(mr);if(p>0&&m>0)pageMap[String(p)]=m;
  }
  return {
    version:7,
    title:String(state.title||'Excertos do Missal Romano'),
    source_pdf:String(state.sourcePdf||state.pdfName||''),
    source_sha256:String(state.sourceSha256||''),
    page_map:pageMap,
    items,
    preferred_font:String(state.preferredFont||'Times New Roman'),
    selected_font:String(state.selectedFont||''),
    mono_font:String(state.monoFont||''),
    font_manual:!!state.fontManual,
    requested_pages:[...new Set((state.requestedPages||[]).map(Number).filter(n=>n>0))].sort((a,b)=>a-b)
  };
}

export function shouldPreserveProjectOnPdfOpen(hasData,currentPdf,storedPdfName,newPdfName){
  return !!hasData && (currentPdf===null || storedPdfName===newPdfName);
}

export const TEXT_STYLES=['Texto litúrgico','Cabeçalho do dia','Antífona','Rubrica','Títulos'];
export function isTextStyle(style){return TEXT_STYLES.includes(style)}
export function editorBreak(key,shiftKey,style){
  if(key!=='Enter'||!isTextStyle(style))return null;
  return shiftKey?'\n':'\n\n';
}
export function paragraphGroups(text){
  const normalized=String(text??'').replace(/\r\n?/g,'\n');
  const groups=normalized.split(/\n[ \t]*\n+/).map(g=>g.replace(/^\n+|\n+$/g,'')).filter(g=>g.length>0);
  return groups.length?groups:[''];
}
