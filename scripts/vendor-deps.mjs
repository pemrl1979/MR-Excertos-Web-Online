import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const web=path.join(root,'web');
function ensure(p){fs.mkdirSync(p,{recursive:true})}
function copy(src,dst){if(!fs.existsSync(src))throw new Error(`Arquivo ausente: ${src}`);ensure(path.dirname(dst));fs.copyFileSync(src,dst)}
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else out.push(p)}return out}
function findOne(dir,name,prefer=''){
  const found=walk(dir).filter(p=>path.basename(p)===name);
  if(!found.length)throw new Error(`Não foi encontrado ${name} em ${dir}`);
  if(prefer){const p=found.find(x=>x.includes(prefer));if(p)return p}
  return found.sort()[0];
}

const jszip=path.join(root,'node_modules','jszip','dist','jszip.min.js');
copy(jszip,path.join(web,'vendor','jszip.min.js'));

const pdf=path.join(root,'node_modules','pdfjs-dist','build');
copy(path.join(pdf,'pdf.min.mjs'),path.join(web,'vendor','pdfjs','pdf.min.mjs'));
copy(path.join(pdf,'pdf.worker.min.mjs'),path.join(web,'vendor','pdfjs','pdf.worker.min.mjs'));

const tess=path.join(root,'node_modules','tesseract.js','dist');
copy(path.join(tess,'tesseract.esm.min.js'),path.join(web,'vendor','tesseract','tesseract.esm.min.js'));
copy(path.join(tess,'worker.min.js'),path.join(web,'vendor','tesseract','worker.min.js'));

const core=path.join(root,'node_modules','tesseract.js-core');
const coreFiles=[
  'tesseract-core.wasm.js','tesseract-core.wasm',
  'tesseract-core-simd.wasm.js','tesseract-core-simd.wasm',
  'tesseract-core-lstm.wasm.js','tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js','tesseract-core-simd-lstm.wasm'
];
for(const name of coreFiles)copy(findOne(core,name),path.join(web,'vendor','tesseract','core',name));

const porRoot=path.join(root,'node_modules','@tesseract.js-data','por');
copy(findOne(porRoot,'por.traineddata.gz','4.0.0_best_int'),path.join(web,'vendor','tesseract','lang','por.traineddata.gz'));

const licenseDir=path.join(web,'vendor','licenses');ensure(licenseDir);
for(const [pkg,label] of [
  [path.join(root,'node_modules','jszip'),'JSZIP'],
  [path.join(root,'node_modules','pdfjs-dist'),'PDFJS'],
  [path.join(root,'node_modules','tesseract.js'),'TESSERACT_JS'],
  [path.join(root,'node_modules','tesseract.js-core'),'TESSERACT_JS_CORE'],
  [porRoot,'TESSERACT_POR']
]){
  const candidates=walk(pkg).filter(p=>/^licen[sc]e/i.test(path.basename(p)) && p.split(path.sep).length<=pkg.split(path.sep).length+2);
  if(candidates.length)copy(candidates[0],path.join(licenseDir,`${label}_LICENSE.txt`));
}
console.log('Dependências Web locais preparadas.');
