# exemplo

Módulo-modelo do pvx. Copie esta pasta, troque o `id` em `pvx-module.json` (ele deve ser igual ao nome do diretório em `usermodules/`) e edite `src/index.tsx`. Documentação do contrato: `packages/sdk/README.md`.

## Ficha de módulo

1. **Responsabilidade:** saudar alguém e lembrar o último nome saudado.
2. **Não faz:** não toca em arquivos do sistema, não usa rede, não executa programas e não lê dados de outros módulos.
3. **Comandos:** `exemplo saudar [nome]` (sem nome, saúda "mundo").
4. **Capacidades e consultas:** capacidade `exemplo.saudacao` (corrige com `exemplo saudar`). Nenhuma consulta.
5. **Estado que grava:** `nome` no `state.json` do próprio módulo.
6. **Permissões:** nenhuma (`permissions` ausente no manifest).
7. **Depende de (`uses`):** nenhum módulo.

## Testar

```sh
bun test
```

`test/module.test.ts` usa `runCommand` e `renderPage` de `@pvx/testing`. Dentro do repositório do pvx o `@pvx/*` resolve pelo `tsconfig.json` da raiz; num repositório próprio, dependa de `@pvx/sdk` e `@pvx/testing`.
