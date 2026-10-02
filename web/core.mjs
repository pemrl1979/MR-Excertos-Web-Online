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
  const styleFor={text:'Texto litúrgico',day_heading:'Cabeçalho do dia',antiphon:'Antífona',rubric:'Rubrica',title:'Títulos',titles:'Títulos'};
  const desktopTopLevel=
    Object.prototype.hasOwnProperty.call(raw,'page_map') ||
    Object.prototype.hasOwnProperty.call(raw,'requested_pages') ||
    Object.prototype.hasOwnProperty.call(raw,'source_pdf') ||
    Object.prototype.hasOwnProperty.call(raw,'source_sha256') ||
    Object.prototype.hasOwnProperty.call(raw,'selected_font') ||
    Object.prototype.hasOwnProperty.call(raw,'preferred_font');
  const printedPages={};
  for(const source of [raw.page_map||{},raw.printedPages||{}]){
    for(const [pdf,mr] of Object.entries(source)){
      const p=Number(pdf),m=Number(mr);if(p>0&&m>0)printedPages[p]=m;
    }
  }
  let importedFromDesktop=!!raw.importedFromDesktop||desktopTopLevel;
  const items=(raw.items||[]).map((source,index)=>{
    const i=source||{};
    const desktopItem=Object.prototype.hasOwnProperty.call(i,'pdf_page')||Object.prototype.hasOwnProperty.call(i,'mr_page')||Object.prototype.hasOwnProperty.call(i,'trim_whitespace')||(!i.style&&Object.prototype.hasOwnProperty.call(styleFor,i.type));
    if(desktopItem)importedFromDesktop=true;
    const kind=i.type;
    if(kind==='spacer')return {...i,type:'spacer',style:'Espaçador',pdfPage:0,printedPage:0,reviewed:true};
    const pdfPage=Number(i.pdfPage??i.pdf_page)||0;
    const printedPage=Number(i.printedPage??i.mr_page)||Number(printedPages[pdfPage])||0;
    if(kind==='facsimile'){
      return {
        ...i,type:'facsimile',style:'Fac-símile',pdfPage,printedPage,
        image:i.image||null,imageDpi:Number(i.imageDpi)||0,
        legacyRect:Array.isArray(i.legacyRect)?i.legacyRect.map(Number):(Array.isArray(i.rect)?i.rect.map(Number):null),
        reviewed:true,trimWhitespace:i.trimWhitespace!==undefined?i.trimWhitespace:i.trim_whitespace!==false
      };
    }
    const style=i.style||styleFor[kind];
    if(!style)throw new Error(`Tipo de trecho do projeto não reconhecido no item ${index+1}: ${kind}`);
    return {
      ...i,type:'text',style,pdfPage,printedPage,text:String(i.text||''),reviewed:!!i.reviewed,
      legacyRect:Array.isArray(i.legacyRect)?i.legacyRect.map(Number):(Array.isArray(i.rect)?i.rect.map(Number):null)
    };
  });
  for(const item of items){
    if(Number(item.pdfPage)>0&&Number(item.printedPage)>0&&!printedPages[item.pdfPage])printedPages[item.pdfPage]=Number(item.printedPage);
  }
  const sourcePath=String(raw.source_pdf||'');
  const desktopPdfName=sourcePath.split(/[\\/]/).filter(Boolean).pop()||'';
  const requestedPages=[...new Set([...(raw.requested_pages||[]),...(raw.requestedPages||[])].map(Number).filter(n=>n>0))].sort((a,b)=>a-b);
  return {
    ...raw,
    format:'MR Excertos Web',version:'1.0',
    pdfName:raw.pdfName||desktopPdfName,
    sourceSha256:raw.sourceSha256||raw.source_sha256||'',
    printedPages,requestedPages,items,
    selectedFont:raw.selectedFont||raw.selected_font||raw.preferred_font||'Times New Roman',
    importedFromDesktop
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
