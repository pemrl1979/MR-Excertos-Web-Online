import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd(), web=path.join(root,'web');
const must=[
  'index.html','app.js','core.mjs','style.css','sw.js','manual.html','manifest.webmanifest',
  'assets/Modelo_MR_Excertos.odt','icons/icon-192.png','icons/icon-512.png','vendor/jszip.min.js',
  'vendor/pdfjs/pdf.min.mjs','vendor/pdfjs/pdf.worker.min.mjs',
  'vendor/tesseract/tesseract.esm.min.js','vendor/tesseract/worker.min.js','vendor/tesseract/lang/por.traineddata.gz',
  'vendor/tesseract/core/tesseract-core.wasm.js','vendor/tesseract/core/tesseract-core.wasm',
  'vendor/tesseract/core/tesseract-core-simd.wasm.js','vendor/tesseract/core/tesseract-core-simd.wasm',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js','vendor/tesseract/core/tesseract-core-lstm.wasm',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js','vendor/tesseract/core/tesseract-core-simd-lstm.wasm'
];
for(const rel of must){
  const p=path.join(web,rel);
  if(!fs.existsSync(p)||fs.statSync(p).size===0)throw new Error(`Ausente ou vazio: ${rel}`);
}
globalThis.self=globalThis;
const tessModule=await import(new URL('../web/vendor/tesseract/tesseract.esm.min.js',import.meta.url));
const tessApi=tessModule.default||tessModule;
if(typeof tessApi.createWorker!=='function')throw new Error('Tesseract.js local não expõe createWorker');
const app=fs.readFileSync(path.join(web,'app.js'),'utf8');
const idx=fs.readFileSync(path.join(web,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(web,'sw.js'),'utf8');
const manifest=fs.readFileSync(path.join(web,'manifest.webmanifest'),'utf8');
if(!idx.includes('MR Excertos Web 1.0'))throw new Error('Identificação 1.0 ausente');
if(!app.includes("dataset.mrReady='1.0'"))throw new Error('Marcador 1.0 ausente');
if(!sw.includes("mr-excertos-web-1.0"))throw new Error('Cache 1.0 ausente');
if(!manifest.includes('"start_url": "./"'))throw new Error('start_url não é relativo');
for(const [name,text] of [['app.js',app],['sw.js',sw]]){
  if(/https:\/\/(?:cdn\.|cdn\.jsdelivr|tessdata\.)/i.test(text))throw new Error(`${name} contém dependência remota de execução`);
}
console.log('Validação da edição online: OK');
