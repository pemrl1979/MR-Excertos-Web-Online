import fs from 'node:fs';
import assert from 'node:assert/strict';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const manual=fs.readFileSync(new URL('../manual.html',import.meta.url),'utf8');
for(const token of [
  "window.addEventListener('beforeunload'",
  "indexedDB.open(RECOVERY_DB,1)",
  "await offerRecoveryIfPresent()",
  "ta.dispatchEvent(new Event('input',{bubbles:true}))",
  "version:'1.0'",
  "shouldPreserveProjectOnPdfOpen(hasProjectData(),state.pdf,state.pdfName,file.name)",
  "await hydrateProjectFacsimiles()",
  "projectToCanonical(state)",
  "projectFromCanonical(JSON.parse(await f.text()))",
  "currentSelectionPdfRect()",
  "O PDF selecionado não corresponde ao arquivo de origem registrado no projeto.",
  "Não foi possível gerar o ODT: '+errorText(err)"
]) assert.ok(app.includes(token),token);
assert.ok(html.includes('id="recoveryDialog"'));
assert.ok(html.includes('MR Excertos Web 1.0'));
assert.ok(manual.includes('<h2>Nota de autoria</h2>'));
assert.ok(manual.includes('Marlon Ramos Lopes'));
assert.ok(manual.includes('ChatGPT, da OpenAI'));
assert.ok(manual.includes('mesmo formato de projeto do MR Excertos desktop 1.0'));
assert.ok(manual.includes('source_sha256'));
console.log('test_recovery_static.mjs: OK');
