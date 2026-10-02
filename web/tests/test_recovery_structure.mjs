import assert from 'node:assert/strict';
import {editorBreak,paragraphGroups,TEXT_STYLES} from '../core.mjs';
for(const style of TEXT_STYLES){
  const original=`Primeiro${editorBreak('Enter',false,style)}Segundo${editorBreak('Enter',true,style)}continuação`;
  // IndexedDB structured clone preserves strings byte-for-byte; JSON round-trip is a conservative proxy.
  const restored=JSON.parse(JSON.stringify({text:original})).text;
  assert.equal(restored,original,`${style}: estrutura textual deve sobreviver ao snapshot`);
  assert.deepEqual(paragraphGroups(restored),['Primeiro','Segundo\ncontinuação'],`${style}: parágrafo e quebra manual`);
}
const ant=`Antífona da entrada\tTexto`;
assert.equal(JSON.parse(JSON.stringify({text:ant})).text,ant,'TAB da Antífona deve ser preservado');
console.log('test_recovery_structure.mjs: OK');
