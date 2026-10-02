import assert from 'node:assert/strict';
import {parsePageSpec,isContiguous,compactPages,suggestedBaseName,associatePrintedPage,numberPrintedInterval,migrateProject,shouldPreserveProjectOnPdfOpen,editorBreak,paragraphGroups,TEXT_STYLES} from '../core.mjs';

assert.deepEqual(parsePageSpec('298, 1024-1026', 1200), [298,1024,1025,1026]);
assert.equal(isContiguous([10,11,12]), true);
assert.equal(isContiguous([10,12]), false);
assert.equal(compactPages([276,277,278,315]), '276-278_315');
const st={printedPages:{},items:[],requestedPages:[10,11,12]};
numberPrintedInterval(st,[10,11,12],276);
assert.deepEqual(st.printedPages,{10:276,11:277,12:278});
st.items=[{type:'text',pdfPage:12,printedPage:278},{type:'text',pdfPage:99,printedPage:315}];
assert.equal(suggestedBaseName(st),'MR_recorte_p278_315');
associatePrintedPage(st,12,280);assert.equal(st.items[0].printedPage,280);
const desktop=migrateProject({
  version:7,
  source_pdf:'/dados/Missal Romano.pdf',
  source_sha256:'abc123',
  page_map:{'10':276,'11':277,'12':278},
  requested_pages:[10,11,12],
  selected_font:'Arial',
  items:[
    {type:'text',pdf_page:10,mr_page:276,text:'Texto',reviewed:true},
    {type:'rubric',pdf_page:11,mr_page:277,text:'Rubrica',reviewed:false},
    {type:'facsimile',pdf_page:12,mr_page:278,rect:[40,190,490,258],trim_whitespace:false},
    {type:'spacer',pdf_page:0,mr_page:0,reviewed:true}
  ]
});
assert.equal(desktop.pdfName,'Missal Romano.pdf');
assert.equal(desktop.sourceSha256,'abc123');
assert.deepEqual(desktop.printedPages,{10:276,11:277,12:278});
assert.deepEqual(desktop.requestedPages,[10,11,12]);
assert.equal(desktop.items[0].printedPage,276);
assert.equal(desktop.items[0].style,'Texto litúrgico');
assert.equal(desktop.items[1].style,'Rubrica');
assert.equal(desktop.items[2].type,'facsimile');
assert.deepEqual(desktop.items[2].legacyRect,[40,190,490,258]);
assert.equal(desktop.items[2].trimWhitespace,false);
assert.equal(suggestedBaseName(desktop),'MR_recorte_p276-278');

for(const style of TEXT_STYLES){
  assert.equal(editorBreak('Enter',false,style),'\n\n',`${style}: Enter`);
  assert.equal(editorBreak('Enter',true,style),'\n',`${style}: Shift+Enter`);
}
assert.equal(editorBreak('Enter',false,'Fac-símile'),null);
assert.deepEqual(paragraphGroups('Primeira linha\ncontinuação\n\nSegundo parágrafo'),['Primeira linha\ncontinuação','Segundo parágrafo']);
assert.deepEqual(paragraphGroups('A\n \nB\n\n\nC'),['A','B','C']);

assert.equal(shouldPreserveProjectOnPdfOpen(true,null,'Missal antigo.pdf','Missal renomeado.pdf'),true,'projeto aberto deve sobreviver a PDF renomeado');
assert.equal(shouldPreserveProjectOnPdfOpen(true,{},'Missal.pdf','Missal.pdf'),true,'mesmo PDF carregado deve preservar o projeto');
assert.equal(shouldPreserveProjectOnPdfOpen(false,null,'','Outro.pdf'),false,'sem dados de projeto não deve preservar estado');
assert.equal(shouldPreserveProjectOnPdfOpen(true,{},'Missal.pdf','Outro.pdf'),false,'troca deliberada de PDF já carregado deve iniciar novo trabalho');
console.log('test_core.mjs: OK');
