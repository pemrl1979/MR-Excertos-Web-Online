# MR Excertos Web — edição online

Aplicação online para seleção e preparação de excertos do Missal Romano.

Esta edição é publicada por GitHub Pages. O PDF escolhido pelo usuário é processado no próprio navegador e não é enviado pela aplicação a um servidor remoto. A extração de texto, o OCR em português, a organização dos excertos e a geração do ODT acontecem localmente no navegador.

## Versão

MR Excertos Web 1.0.

## Formato de projeto

A edição online usa o mesmo formato `.mrproj.json` do MR Excertos desktop 1.0 (formato de projeto versão 7). Projetos podem circular entre Web, Linux, Windows e macOS sem um segundo formato de projeto.

Por limitação de segurança do navegador, um projeto criado originalmente na Web registra em `source_pdf` o nome do arquivo, não seu caminho absoluto. O campo `source_sha256` é mantido para validar o PDF ao reabri-lo.

## Publicação

O conteúdo publicado é construído por GitHub Actions a partir deste repositório público. As dependências de PDF e OCR são incorporadas ao site durante o build, sem dependência de CDN em tempo de execução.

## Autoria

**Concepção, especificação funcional, testes e revisão:** Marlon Ramos Lopes  
**Desenvolvimento do programa e documentação:** com assistência do ChatGPT, da OpenAI

## Licença

GNU AGPL v3 ou posterior. Consulte `COPYING`.
