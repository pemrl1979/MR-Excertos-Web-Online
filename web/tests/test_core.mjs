import assert from 'node:assert/strict';
import {
  parsePageSpec,isContiguous,compactPages,suggestedBaseName,associatePrintedPage,numberPrintedInterval,
  projectFromCanonical,projectToCanonical,shouldPreserveProjectOnPdfOpen,editorBreak,paragraphGroups,TEXT_STYLES
} from '../core.mjs';

assert.deepEqual(parsePageSpec('298, 1024-1026', 1200), [298,1024,1025,1026]);
assert.equal(isContiguous([10,11,12]), true);
assert.equal(isContiguous([10,12]), false);
assert.equal(compactPages([276,277,278,315]), '276-278_315');

const st={printedPages:{},items:[],requestedPages:[10,11,12]};
numberPrintedInterval(st,[10,11,12],276);
assert.deepEqual(st.printedPages,{10:276,11:277,12:278});
st.items=[{type:'text',pdfPage:12,printedPage:278},{type:'text',pdfPage:99,printedPage:315}];
assert.equal(suggestedBaseName(st),'MR_recorte_p278_315');
associatePrintedPage(st,12,280);
assert.equal(st.items[0].printedPage,280);

const canonical={
  version:7,
  title:'Excertos do Missal Romano',
  source_pdf:'/dados/Missal Romano.pdf',
  source_sha256:'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  page_map:{'10':276,'11':277,'12':278},
  items:[
    {type:'text',pdf_page:10,mr_page:276,rect:[10,20,110,70],text:'Texto',id:'11111111111111111111111111111111',reviewed:true,trim_whitespace:true},
    {type:'rubric',pdf_page:11,mr_page:277,rect:[20,30,120,80],text:'Rubrica',id:'22222222222222222222222222222222',reviewed:false,trim_whitespace:true},
    {type:'facsimile',pdf_page:12,mr_page:278,rect:[40,190,490,258],text:'',id:'33333333333333333333333333333333',reviewed:false,trim_whitespace:false},
    {type:'spacer',pdf_page:0,mr_page:0,rect:null,text:'',id:'44444444444444444444444444444444',reviewed:true,trim_whitespace:true}
  ],
  preferred_font:'Times New Roman',
  selected_font:'Arial',
  mono_font:'Liberation Mono',
  font_manual:true,
  requested_pages:[10,11,12]
};

const internal=projectFromCanonical(canonical);
assert.equal(internal.pdfName,'Missal Romano.pdf');
assert.equal(internal.sourcePdf,'/dados/Missal Romano.pdf');
assert.equal(internal.sourceSha256,canonical.source_sha256);
assert.deepEqual(internal.printedPages,{10:276,11:277,12:278});
assert.deepEqual(internal.requestedPages,[10,11,12]);
assert.equal(internal.items[0].style,'Texto litúrgico');
assert.equal(internal.items[0].printedPage,276);
assert.equal(internal.items[1].style,'Rubrica');
assert.equal(internal.items[2].type,'facsimile');
assert.deepEqual(internal.items[2].rect,[40,190,490,258]);
assert.equal(internal.items[2].trimWhitespace,false);
assert.equal(internal.preferredFont,'Times New Roman');
assert.equal(internal.selectedFont,'Arial');
assert.equal(internal.monoFont,'Liberation Mono');
assert.equal(internal.fontManual,true);
assert.equal(suggestedBaseName(internal),'MR_recorte_p276-278');

const roundTrip=projectToCanonical(internal);
assert.deepEqual(roundTrip,canonical,'projeto salvo pela Web deve usar exatamente o esquema canônico do desktop 1.0');
assert.deepEqual(Object.keys(roundTrip),[
  'version','title','source_pdf','source_sha256','page_map','items',
  'preferred_font','selected_font','mono_font','font_manual','requested_pages'
]);
assert.equal('printedPages' in roundTrip,false);
assert.equal('requestedPages' in roundTrip,false);
assert.equal('pdfName' in roundTrip,false);
assert.equal('format' in roundTrip,false);

const titleAlias=projectFromCanonical({
  ...canonical,
  items:[{...canonical.items[0],type:'title'}]
});
assert.equal(titleAlias.items[0].style,'Títulos');
assert.equal(projectToCanonical(titleAlias).items[0].type,'titles');

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
