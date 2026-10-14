# exemplo

Módulo-modelo do pvx. Copie esta pasta, troque o `id` em `pvx-module.json` (ele deve ser igual ao nome do diretório em `usermodules/`) e edite os arquivos de `src/`. Documentação do contrato: `packages/sdk/README.md`. A estrutura de pastas está em "Estrutura" abaixo. Padrão de código: `CODIGO.md` (na raiz do pvx); leia antes de escrever ou revisar código.

## Ficha de módulo

1. **Responsabilidade:** saudar alguém e lembrar o último nome saudado.
2. **Não faz:** não toca em arquivos do sistema, não usa rede, não executa programas e não lê dados de outros módulos.
3. **Comandos:** `exemplo saudar [nome]` (sem nome, saúda "mundo").
4. **Capacidades e consultas:** capacidade `exemplo.saudacao` (corrige com `exemplo saudar`). Nenhuma consulta.
5. **Estado que grava:** `nome` (o último saudado) e `historico` (os últimos cinco) no `state.json` do próprio módulo; as chaves estão em `STORE_KEY`.
6. **Permissões:** nenhuma (`permissions` ausente no manifest).
7. **Depende de (`uses`):** nenhum módulo.

## Estrutura

Segue a seção "Estrutura de um módulo" do `CODIGO.md` (referência completa: o módulo `pvx-firewall`), na forma mínima:

- `src/index.tsx`: só liga comandos, capacidades e página.
- `src/commands/saudacao.ts`: o comando `saudar`, em passos com nome.
- `src/health/prove.ts`: a capacidade, por `sdk.proof.firstProblem`.
- `src/state.ts`: o tipo persistido e `STORE_KEY`. `src/texts.ts`: textos e `FIX.*`.
- `src/page/`: `Painel.tsx` (`usePanels`, `List`, `Button`, `Loading`, como o UI.md), `rows.ts` e `index.tsx`.
- `test/`: `fake.ts` (`fakeSdk` e `memStore`, reexportados de `@pvx/testing`) e `module.test.ts` (`runSession`).

O modelo não executa programas, então não tem `exec.ts` nem `health/summary.ts`, `queries.ts` e `widgets.ts`; crie-os quando o módulo precisar, no mesmo lugar.

## Testar

```sh
bun test
```

`test/module.test.ts` usa `runSession` de `@pvx/testing` e o `fakeSdk` de `test/fake.ts`. Dentro do repositório do pvx o `@pvx/*` resolve pelo `tsconfig.json` da raiz; num repositório próprio, dependa de `@pvx/sdk` e `@pvx/testing`.

## Desenvolver

Dentro do repositório do pvx, ligue a pasta e abra a TUI (o módulo recarrega ao salvar):

```sh
bun run dev:link ../meu-modulo
bun dev
```

`bun run dev:link` sem argumento lista os módulos linkados; `bun run dev:unlink <id>` remove o link.
