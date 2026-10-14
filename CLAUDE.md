# pvx

CLI e TUI de sysadmin em Bun/TypeScript com módulos (OpenTUI + React). Versão do Bun fixada em `.github/workflows/ci.yml`; scripts em `package.json`.

## Documentos

- `README.md`: instalação e uso, para quem opera o pvx.
- `CLAUDE.md`: regras para agentes (sempre carregado).
- `UI.md`: padrão de interação e visual; leia antes de mexer em tela.
- `CODIGO.md`: padrão de código; leia antes de escrever ou revisar código.
- `DECISIONS.md`: decisões e histórico, com a seção Vigentes; leia antes de mudar comportamento.
- `packages/sdk/README.md`: contrato e kit para autores de módulo; leia ao mexer no SDK.
- `templates/pvx-module-template/README.md`: modelo de módulo; leia ao criar um módulo.

## Comandos

- `bun dev`: roda com `PVX_HOME=.dev/pvx` (o `bun --watch` precisa enxergar os usermodules).
- `bun run typecheck`: `tsc --noEmit`.
- `bun test`: tudo; um arquivo: `bun test packages/tui/test/menu.test.tsx`.
- `bun run build:<alvo>` (`linux-amd64`, `linux-arm64`, `darwin-arm64`, `windows-amd64`): chama `scripts/build.sh`. `bun run release`: `scripts/release.sh`.

## Mapa do repo

- `packages/core`: registry, loader, executor, stores, CLI, motor de perfis e plano.
- `packages/tui`: shell, sessão, palette, páginas, `theme.ts` e `theme-context.tsx`.
- `packages/sdk`: só tipos do contrato do módulo; `README.md` é a referência para autores.
- `packages/builtin`: módulos oficiais (`conformidade`, `motd`, `notas`), escritos como usermodules.
- `packages/testing` (`@pvx/testing`): `renderTui`, `renderPage`, `runCommand`, `runSession`, `useFixtureModules`.
- `apps/pvx`: ponto de entrada (CLI com argumentos, senão TUI). `templates/`: modelo de módulo. `profiles/`: perfis de conformidade.
- Testes: `packages/*/test` e `test/` (raiz). `bunfig.toml` pré-carrega `test/setup.ts`: `PVX_HOME` num tmpdir por teste e `PVX_CATALOG_URL` numa porta recusada (nenhum teste toca o registry real).

## Invariantes

- O host nunca nomeia um módulo (`test/boundary.test.ts`). `process.exit` só em `apps/pvx/src/index.ts`.
- Módulos importam só tipos do SDK (`import type`), imports relativos no resto, JSX clássico (`@jsxRuntime classic`).
- Comandos que exigem root falham sem root (`requiresRoot` em `packages/core/src/cli/run.ts`). Exceção: no Windows `isRoot` é sempre verdadeiro (`apps/pvx/src/index.ts`).
- Blocos `<!-- test -->` em `packages/sdk/README.md` são módulos completos: carregados pelo loader real e verificados pelo `tsc` (`test/sdk-readme.test.ts`).
- Cores só por tokens do tema (`theme.ts`, `theme-context.tsx`); nunca hex em componente.
- A revisão de confiança nunca mostra código-fonte (`packages/tui/test/modules.test.tsx`). Nenhuma variável de ambiente contorna a confiança.
- Nunca dê push casualmente: push na `main` faz deploy.

## Idioma e voz

- UI e docs em pt-BR; código, comentários e commits em inglês. Frases curtas, sem exclamação.
- Erro diz a causa e o próximo passo. Ação no imperativo (`aplicar`), resultado no passado (`regras reaplicadas`).
- Termos fixos, sem sinônimos: sucesso, aviso, erro; módulo, capacidade, prova, perfil, plano, nota, central, técnico, sessão, bloco. Rastro de execução: scrollback, log e audit (não existe "diário").
- Commit: título convencional + bullets curtos + última linha `(generated with claude)`.

## Ao mudar comportamento

- Escreva um teste de regressão.
- Mudou o SDK: atualize `packages/sdk/README.md`.
- Escreveu código: siga o CODIGO.md.
- Mexeu em tela: siga o UI.md.
- Algo genérico (serviria a outro módulo)? Coloque no framework e documente no UI.md.
- Registre uma entrada em `DECISIONS.md`.

## Armadilhas do OpenTUI

A skill do OpenTUI é instalada a partir do `skills-lock.json` (fonte `anomalyco/opentui`); `.agents/` e `.claude/skills/` não são versionados.

- `<text>` não interpreta escapes ANSI: use `<span fg>` e passe texto de módulo/nota por `stripAnsi` (`packages/core/src/ansi.ts`).
- Shift: `key.name` vem minúsculo e só `key.sequence` vem maiúsculo. Um `switch` em `key.name` engole `L` e `H`.
- `useKeyboard` roda antes de um `<textarea>` focado; leia o texto pela ref (`plainText`).
- Scrollbox focado responde a `j`/`k`: passe `focused={false}` se o app roteia essas teclas. `gap` só funciona em `contentOptions`. Não segue o cursor: dê `id` às linhas e role até elas.
- Largura fixa: `flexShrink={0}`. Linha principal de lista: `minHeight={0}`, senão cabeçalho e rodapé somem.
- `truncate` exige `wrapMode="none"` e corta no meio; quando o fim importa, corte a string.
- Glifo ocupa uma célula (`‼` ocupa duas): confira cada glifo novo num teste de frame.
- `opacity` vale para a subárvore: fundo e diálogo devem ser irmãos.
- Ao trocar a paleta: `renderer.setBackgroundColor()` e `requestRender()`.
- `<markdown>` não renderiza sem tree-sitter: não use.
- Testes: o harness usa `kittyKeyboard: true`, então ESC não precisa de espera. `h.press("ARROW_DOWN")`; maiúsculas por `press("L")`.
- Seleção por id, nunca por índice de linha. Modais são donos do teclado enquanto abertos.
