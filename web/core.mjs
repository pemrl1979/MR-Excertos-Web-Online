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
export function migrateProject(project){
  const raw=project||{};
  const desktop=raw.format!=='MR Excertos Web' && (
    Object.prototype.hasOwnProperty.call(raw,'page_map') ||
    Object.prototype.hasOwnProperty.call(raw,'requested_pages') ||
    Object.prototype.hasOwnProperty.call(raw,'source_pdf') ||
    (raw.items||[]).some(i=>Object.prototype.hasOwnProperty.call(i||{},'pdf_page')||Object.prototype.hasOwnProperty.call(i||{},'mr_page'))
  );
  if(desktop){
    const printedPages={};
    for(const [pdf,mr] of Object.entries(raw.page_map||{})){
      const p=Number(pdf),m=Number(mr);if(p>0&&m>0)printedPages[p]=m;
    }
    const styleFor={text:'Texto litúrgico',day_heading:'Cabeçalho do dia',antiphon:'Antífona',rubric:'Rubrica',title:'Títulos',titles:'Títulos'};
    const items=(raw.items||[]).map((source,index)=>{
      const i=source||{},kind=i.type;
      if(kind==='spacer')return {type:'spacer',style:'Espaçador',reviewed:true};
      const pdfPage=Number(i.pdf_page)||0;
      const printedPage=Number(i.mr_page)||Number(printedPages[pdfPage])||0;
      if(kind==='facsimile'){
        return {type:'facsimile',style:'Fac-símile',pdfPage,printedPage,legacyRect:Array.isArray(i.rect)?i.rect.map(Number):null,reviewed:true,trimWhitespace:i.trim_whitespace!==false};
      }
      const style=styleFor[kind];
      if(!style)throw new Error(`Tipo de trecho do projeto desktop não reconhecido no item ${index+1}: ${kind}`);
      return {type:'text',style,pdfPage,printedPage,text:String(i.text||''),reviewed:!!i.reviewed,legacyRect:Array.isArray(i.rect)?i.rect.map(Number):null};
    });
    const sourcePath=String(raw.source_pdf||'');
    const pdfName=sourcePath.split(/[\\/]/).filter(Boolean).pop()||'';
    return {
      format:'MR Excertos Web',version:'1.0',pdfName,sourceSha256:String(raw.source_sha256||''),
      printedPages,requestedPages:(raw.requested_pages||[]).map(Number).filter(n=>n>0),
      items,selectedFont:raw.selected_font||raw.preferred_font||'Times New Roman',importedFromDesktop:true
    };
  }
  const p={...raw};
  p.printedPages=p.printedPages||{};p.items=p.items||[];p.requestedPages=p.requestedPages||[];p.sourceSha256=p.sourceSha256||'';
  for(const item of p.items){
    const mapped=Number(p.printedPages[item.pdfPage]||0);
    if(mapped>0)item.printedPage=mapped;
  }
  return p;
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
