# @pvx/sdk

Contrato dos módulos do pvx (SDK v1). O pacote tem tipos e a constante `EXIT` (para o host e os testes; o módulo importa só tipos). Um módulo é um diretório com `pvx-module.json` e um arquivo de entrada que exporta uma fábrica. O modelo pronto está em `templates/pvx-module-template/`.

Os exemplos marcados com `<!-- test -->` neste arquivo são extraídos e rodados por `test/sdk-readme.test.ts`: cada um é carregado pelo loader real e verificado pelo `tsc`. Exemplo desatualizado quebra o build.

## Manifest (`pvx-module.json`)

| Campo | Obrigatório | Significado |
| --- | --- | --- |
| `id` | sim | Só minúsculas, dígitos e hífen. Igual ao nome do diretório em `usermodules/`. |
| `version` | sim | Versão do módulo. |
| `entry` | sim | Arquivo de entrada, relativo ao módulo (`src/index.tsx`). Tem de ficar dentro do diretório. |
| `pvx` | não | Faixa semver do pvx aceita (`>=0.1.0`). Fora da faixa, o módulo não carrega e o erro diz qual faixa instalar. |
| `applies` | não | `{ "file": "/etc/..." }`: sem o arquivo o módulo é ignorado em silêncio. |
| `permissions` | não | `exec`, `net`, `fs`: o que o módulo declara usar. Serve à revisão de confiança e é o que `ctx.exec`, `ctx.net` e `ctx.fs` aceitam (veja Permissões). |
| `contributes` | não | `commands`, `pages`, `widgets`, `capabilities`: o que o módulo entrega, para listar sem importar o código. |
| `uses` | não | Módulos cujas consultas este módulo chama com `ctx.query`. |

## A fábrica

O `entry` exporta por padrão uma função `(sdk) => ModuleDef`. O host a chama uma vez, ao carregar.

**A fábrica não faz trabalho.** Ela só monta e devolve o objeto: nada de ler arquivo, abrir rede, rodar programa ou gravar estado. Todo efeito acontece dentro de `run()`, `prove()`, `data()` ou de uma consulta. O motivo: carregar tem de ser barato e seguro, e um módulo com defeito não pode travar a partida.

`sdk` traz `version` (1), `log` (`debug`, `info`, `warn`, `error`) e `ui` (veja adiante).

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = (sdk) => ({
  commands: {
    ping: {
      help: "Responde pong",
      run(ctx) {
        sdk.log.info("ping chamado");
        ctx.out.success("pong");
      },
    },
  },
});
export default factory;
```

## Comandos e `ArgSpec`

A chave em `commands` é o caminho do comando com espaços (`"ip trust"`); o usuário digita `pvx <módulo> <caminho>`. O mesmo `run()` serve à CLI e à TUI.

`CommandDef`: `help`, `args`, `destructive`, `page`, `run(ctx)`.

`ctx` traz `args`, `out` (`success`, `warning`, `error`, `info`, `plain`), `log`, `store` e `query`.

`ArgSpec`:

| Campo | Significado |
| --- | --- |
| `name` | Nome do argumento (chave em `ctx.args`). |
| `help` | Texto de ajuda. |
| `kind` | `positional`, `flag` (`--nome`, vira `true`) ou `option` (`--nome valor` ou `--nome=valor`). |
| `required` | Falta do argumento sai com exit 2 e diz qual passar. |
| `secret` | Nunca vem por argumento. Chega por `--<nome>-stdin`, por `PVX_SECRET_<NOME>` ou pelo campo mascarado da TUI. O valor nunca vai para log, histórico, estado nem scrollback. |
| `values` | Candidatos de completar. |

`destructive: true` exige `--yes` fora de TTY; a TUI usa a confirmação do host.

`page`: nome de uma página do próprio módulo, aberta quando o comando sai com 0.

**Exit codes.** `run()` não devolve exit. O host decide: 0 se nenhuma linha `error` saiu, 1 se alguma saiu, 2 para uso inválido (argumento faltando, desconhecido ou comando destrutivo sem `--yes`), 3 para comando não encontrado. Aviso (`out.warning`) não muda o exit. O comando deve ser idempotente: rodar duas vezes termina no mesmo estado, e "nada a fazer" é sucesso. Exceção lançada em `run()` vira linha de erro e vai para o log do módulo.

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = () => ({
  commands: {
    "token set": {
      help: "Guarda o token",
      args: [
        { name: "token", help: "Token de acesso", kind: "option", secret: true, required: true },
        { name: "label", help: "Rótulo", kind: "option", values: ["prod", "teste"] },
      ],
      run(ctx) {
        if (!ctx.args.token) return ctx.out.error("sem token"); // use o valor na chamada; nunca o guarde nem o imprima
        ctx.out.success("token recebido");
      },
    },
    "token clear": {
      help: "Apaga o token",
      destructive: true,
      run(ctx) {
        ctx.store.delete("token");
        ctx.out.success("token apagado");
      },
    },
  },
});
export default factory;
```

## Capacidades

Uma capacidade é uma condição que o módulo sabe provar e, se possível, consertar. O plano de conformidade as avalia.

| Campo | Significado |
| --- | --- |
| `id` | `"<módulo>.<nome>"`, estável: é a chave dos perfis. |
| `title`, `goal` | O que é e o que se quer. |
| `prove(ctx)` | **Somente leitura.** Devolve `{ level: "ok" \| "warn" \| "error", text, evidence?, fix? }`. Recebe `log`, `store` e `query`. |
| `fix` | Comando (linha completa, com o módulo) que conserta. Um `fix` devolvido por `prove` vale mais que o da definição. |
| `affects` | Capacidades a provar de novo depois do conserto. |
| `needs` | Capacidades que precisam estar `ok` antes; sem isso, o conserto espera. |
| `optIn` | O conserto nunca roda sozinho com `--yes`. |

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = () => ({
  commands: {
    "serve on": { help: "Liga o serviço", run: (ctx) => (ctx.store.set("ligado", true), ctx.out.success("ligado")) },
  },
  capabilities: [
    {
      id: "doc.servico",
      title: "Serviço ligado",
      goal: "O serviço deve estar ligado",
      fix: "doc serve on",
      needs: ["doc.base"],
      affects: ["doc.resumo"],
      prove: ({ store }) => (store.get("ligado") ? { level: "ok", text: "ligado" } : { level: "error", text: "desligado" }),
    },
    { id: "doc.base", title: "Base", goal: "Base pronta", prove: () => ({ level: "ok", text: "pronta" }) },
    { id: "doc.resumo", title: "Resumo", goal: "Resumo em dia", optIn: true, prove: () => ({ level: "warn", text: "desatualizado" }) },
  ],
});
export default factory;
```

## Consultas

`queries` expõe leituras para outros módulos: o nome é `"<módulo>.<nome>"`, a função recebe `(name, ...args)` e devolve um valor ou uma promessa. Quem chama usa `ctx.query(nome, ...args)` e declara o módulo em `uses` no manifest. Consulta é leitura: não grava estado. Uma página lê a própria consulta com `useQuery`.

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = () => ({
  queries: { "doc.versao": () => "1.2.3" },
  commands: {
    mostra: {
      help: "Mostra a versão",
      async run(ctx) {
        ctx.out.info(String(await ctx.query("doc.versao")));
      },
    },
  },
});
export default factory;
```

## `sdk.ui`: interface sem importar React

O host entrega a interface pronta em `sdk.ui`. **Um módulo nunca importa React nem `@opentui/*`.** O motivo: o processo precisa de uma só cópia do React (duas cópias quebram os hooks), e o binário compilado não oferece pacotes a módulos externos. Por isso o host injeta o que o módulo usa.

Para escrever JSX sem importar nada, o arquivo usa o runtime clássico, com estas três linhas no topo:

```
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
```

Sem elas, o Bun transforma o JSX em `import "react/jsx-dev-runtime"` e o módulo quebra. O `h` vem de `sdk.ui`: `const { h, Panel, Text } = sdk.ui;` dentro da fábrica. O módulo só faz `import type` do `@pvx/sdk` (apagado na compilação); qualquer outro import tem de ser relativo, de arquivo do próprio módulo.

O que `sdk.ui` oferece:

- **Hooks do React:** `useState`, `useEffect`, `useMemo`, `useRef`.
- **Componentes:** `Panel` (`title`, `tone`; na raiz da página não desenha borda nem título, veja Páginas), `Text` (`tone`, `bold`), `Chip`, `Meter` (`value` de 0 a 1), `KeyHint`, `Table` (`columns`, `rows`), `List` (`items`, `selected` por id), `Form` (formulário gerado do `ArgSpec` de um comando do módulo) e `Spacer`.
- **Hooks do host:** `useCommand(linha)` roda um comando **do próprio módulo** pela sessão (aparece no scrollback e no histórico); `useQuery(nome, ...args)`; `useStore()`; `useRouter()` (`push(página)`, `pop()` entre páginas do módulo); `useKey(teclas, rótulo, handler)` (veja Páginas); `useConformity()` (veja Conformidade na UI); `useTheme()` (cores `c` e glifos `g`).
- **Tons:** `ok`, `warn`, `error`, `info`, `accent`, `dim`, `text`. Nunca escreva cor hex: use os tons.

Na CLI (sem TUI) `sdk.ui` aceita ser desestruturado, mas qualquer chamada lança "UI indisponível na CLI": por isso componentes só rodam dentro de `render()`.

## Páginas, abas e widgets

**Página.** `pages` mapeia o nome da página para `{ title, render, keys?, tab? }`.

- `render()` devolve JSX e roda dentro do componente da página: pode chamar hooks. Se lançar, o host registra o erro, volta e avisa; o resto não é afetado.
- Abre-se por `#<módulo>.<nome>` (ou `#<nome>`, se for único), na palette (`ctrl+k`, escopo `#`) ou no campo de comando; ou por um comando com `page`.
- **Teclas: `useKey(teclas, rótulo, handler)`.** Chame no `render` ou em qualquer componente da página: o `handler` enxerga o estado do componente, e a tecla vale enquanto o componente está montado (some do rodapé e do `?` quando ele sai). Formatos: `a`, `space`, `enter`, `ctrl+x`, `L`. Reservadas (ignoradas): `esc`, `?`, `ctrl+c`, `ctrl+k`. Uma tecla que lança vai para o log do módulo.
- `keys` em `PageDef` (`{ keys, label, run }[]`) continua valendo para teclas que não precisam do estado do componente; entram na mesma tabela de atalhos.
- **Moldura.** O host desenha a borda da página e o título `› <title>`. Um `Panel` na raiz da página é só o conteúdo (sem borda e sem título): assim a página mostra uma moldura só. Para seções dentro da página, ponha `Panel` dentro de outro `Panel`: os internos têm borda e título.

**Aba.** `tab: true` ou `tab: { label, order }` põe a página também na barra de abas, depois das abas do núcleo, ordenada por `order` e depois por rótulo. A aba visitada continua montada enquanto a tela de abas existe.

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { CommandCtx, Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Panel, Text, KeyHint, useState, useCommand, useQuery, useKey } = sdk.ui;

  function Contador() {
    const [n, setN] = useState(0);
    useKey("space", "soma 1", () => setN((v) => v + 1));
    const status = useCommand("doc status");
    const q = useQuery<string>("doc.estado");
    return (
      <Panel title="contador">
        <Text>{`n = ${n}`}</Text>
        <Text tone="dim">{q.loading ? "..." : `estado: ${q.data}`}</Text>
        <Text tone="info">{status.lastResult ? `status saiu ${status.lastResult.exit}` : "status não rodou"}</Text>
        <KeyHint keys="space" label="soma 1" />
      </Panel>
    );
  }

  return {
    commands: { status: { help: "Mostra o status", run: (ctx: CommandCtx) => ctx.out.success("ok") } },
    queries: { "doc.estado": () => "pronto" },
    pages: {
      contador: {
        title: "Contador",
        render: () => <Contador />,
        tab: { label: "Contador", order: 10 },
      },
    },
  };
};
```

**Conformidade na UI.** `useConformity()` devolve o cache de conformidade do host, o **mesmo** que o painel do Início mostra: `{ profile?, message?, results, plan: { steps, manual }, checkedAt?, running, refresh(), apply(confirm) }`. É só leitura: o hook nunca avalia sozinho (a primeira visita chama `refresh()`; `r` em qualquer tela atualiza o cache de todas). `results` traz `{ level, text, fix? }`; `plan.steps` traz `{ cmd, for, implicit, reason?, optIn? }` na ordem de execução; `message` aparece quando não há perfil aplicável. `apply(confirm)` aplica o plano como comandos comuns pela sessão (scrollback, histórico e log): o host congela uma cópia dos passos, chama `confirm(passo)` antes de cada um (`"yes"`, `"skip"` ou `"stop"`) e para no primeiro erro ou em `"stop"`. O módulo continua dono da tela: ele deve mostrar a lista que congelou, não a viva. O motor (perfis, avaliação, ordenação) é do host; a CLI `pvx conformidade`, `pvx plano` e `pvx plano apply` não mudam.

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Panel, Text, useEffect, useConformity, useKey } = sdk.ui;

  function Resumo() {
    const c = useConformity();
    useEffect(() => {
      if (!c.checkedAt) c.refresh();
    }, []);
    useKey("r", "atualiza", c.refresh);
    return (
      <Panel>
        <Text tone="dim">{c.running ? "verificando…" : `${c.results.length} itens, ${c.plan.steps.length} passos`}</Text>
        {c.results.map((r, i) => <Text key={i} tone={r.level}>{r.text}</Text>)}
      </Panel>
    );
  }

  return { pages: { resumo: { title: "Resumo", render: () => <Resumo />, tab: { label: "Resumo", order: 20 } } } };
};
```

**Módulos embutidos.** O pvx traz módulos oficiais dentro do binário (`packages/builtin/<id>/`): são escritos exatamente como um usermodule (manifest, entrada, pragma clássico, só `import type` do SDK), mas confiáveis e sem git. O host os carrega por uma lista estática (`packages/builtin/index.ts`), porque o binário compilado não acha um `import()` de caminho dinâmico. Aparecem com `◆` em Módulos. O `conformidade` é um deles: as abas Conformidade e Plano.

**Widget.** `widgets` mapeia um nome para `{ slot, priority, refreshMs?, data }` e preenche uma região da tela inicial (um *slot*). O núcleo desenha; o módulo só entrega dados, na forma fixa de cada slot:

| Slot | `data()` devolve |
| --- | --- |
| `home.chips` | `{ label, level, detail? }[]` |
| `home.attention`, `home.configured` | `{ level, title, fix? }[]` |
| `home.summary` | `string` |
| `home.notes` | `string[]` |
| `home.panel` | forma ainda em definição |

`priority` ordena os widgets dentro do slot. `data()` pode ser assíncrona e é chamada de novo a cada `refreshMs`, se houver. O contrato dos widgets segue os tipos de `src/index.ts` (`WidgetDef`, `SlotId`, `SlotData`): em caso de dúvida, os tipos valem.

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = () => ({
  widgets: {
    avisos: {
      slot: "home.attention",
      priority: 10,
      refreshMs: 30000,
      data: () => [{ level: "warn", title: "Backup atrasado", fix: "doc backup" }],
    },
  },
});
export default factory;
```

## Permissões: `ctx.exec`, `ctx.net`, `ctx.fs`

Em um comando, `ctx.exec`, `ctx.net` e `ctx.fs` só aceitam o que o manifest listou em `permissions`. Fora disso, lançam um erro claro e o host registra a violação no log do módulo e no `core.log`.

| API | Regra |
| --- | --- |
| `ctx.exec(cmd, args?, { cwd, env, stdin, timeoutMs })` | O nome base de `cmd` está em `permissions.exec`. Roda sem shell (`Bun.spawn`), com limite de tempo (30 s por padrão), e devolve `{ code, stdout, stderr }`. |
| `ctx.net.fetch(url, init?)` | `host[:porta]` da URL está em `permissions.net`; só `http` e `https`. Redirecionamentos não são seguidos. |
| `ctx.fs.read / write / exists / list` | O caminho (resolvido, com symlinks) fica sob um prefixo de `permissions.fs`. O prefixo `rw:` libera escrita; sem ele, só leitura. O diretório de estado do próprio módulo é sempre permitido. |

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

// pvx-module.json: "permissions": { "exec": ["uname"], "net": ["example.com"], "fs": ["rw:/var/lib/meu-modulo", "/etc/os-release"] }
const factory: ModuleFactory = () => ({
  commands: {
    sistema: {
      help: "Mostra o kernel e grava um marcador",
      async run(ctx) {
        const { stdout } = await ctx.exec("uname", ["-r"], { timeoutMs: 5000 });
        ctx.out.success(`kernel ${stdout.trim()}`);
        await ctx.fs.write("/var/lib/meu-modulo/ultimo", stdout);
        const res = await ctx.net.fetch("https://example.com/ping");
        ctx.out.info(`ping: ${res.status}`);
      },
    },
  },
});
export default factory;
```

## Segurança

**Isto não é um sandbox.** O módulo roda no mesmo processo do pvx, como root nas centrais. Nada impede um módulo de chamar `Bun.spawn`, `node:child_process`, `fetch` ou `node:fs` direto, e de contornar `ctx.*`. As permissões declarativas dão ao técnico uma lista honesta do que o módulo diz usar, e fazem o uso correto falhar alto quando passa do declarado. A barreira real é a revisão humana do commit.

**Modelo de confiança**

- Um módulo instalado por `modules add` só é importado depois de o técnico aprovar aquele commit (`modules trust <id> --sha <sha>`, ou `--trust` no `add`). A aprovação fica em `PVX_HOME/trust.json` com o sha, quem aprovou e as permissões vistas.
- O módulo só carrega se `HEAD` for igual ao sha aprovado e a árvore git estiver limpa. Commit novo ou arquivo alterado: não carrega.
- `modules update` busca e lista os commits novos e as mudanças de permissões, mas só avança com `--trust <sha do remoto>`; o avanço vai exatamente àquele commit (fast-forward).
- Nenhuma variável de ambiente desliga a confiança. `PVX_USERMODULES` só muda o diretório. Módulos embutidos no binário não passam pelo gate: são código do próprio pvx.
- Git roda sem hooks, sem submódulos, sem credenciais na URL, só `https` e `ssh`.
- Um symlink em `usermodules/` só carrega se `modules link` o registrou (`PVX_HOME/modules.json`) e se ainda aponta para onde foi registrado. Um módulo dev (link) carrega **sem confiança por commit**: é para a máquina de quem desenvolve, não para uma central de cliente. Na TUI ele recarrega ao salvar; um erro de carga aparece no scrollback e a versão anterior continua ativa. Sem `dispose` ainda: timers e listeners da versão antiga continuam rodando depois da recarga.

**O que NÃO é protegido**

- Código de um commit aprovado: ele roda com os privilégios do pvx. Aprovar é confiar.
- Uso direto de `Bun.spawn`, `fetch` e `node:fs` fora de `ctx.*`. A revisão mostra um aviso por análise estática, que é um aviso e não uma garantia (código gerado ou ofuscado passa).
- Dependências empacotadas dentro do módulo: fazem parte do commit revisado.
- A janela entre a checagem do commit e o `import()`: quem escreve em `usermodules/` já é root.
- `ctx.exec`: o nome base é o que se confere, então um caminho absoluto com nome permitido roda. O programa em si e o que ele faz não são limitados.

## Como testar com `@pvx/testing`

`runCommand(moduleDir, linha, { env?, secrets?, confirmed? })` carrega **só** aquele módulo num `PVX_HOME` temporário novo, roda a linha (módulo primeiro, como na CLI) pelo `execute` do núcleo e devolve `{ ok, exit, lines }`. `secrets` entra como `PVX_SECRET_<NOME>`; `confirmed: true` equivale a `--yes`.

`renderPage(moduleDir, página, { cols, rows })` monta a página com o `sdk.ui` real do host num terminal sem tela e devolve `{ frame(), press(tecla), type(texto), destroy(), ... }`. Chame `destroy()` no `afterEach`. Teclas são nomes do OpenTUI: `"RETURN"`, `"ESCAPE"`, `"ARROW_DOWN"`, ou o próprio caractere (`" "` para o espaço).

```ts
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { renderPage, runCommand, type TuiHarness } from "@pvx/testing";

const dir = join(import.meta.dir, "..");
let t: TuiHarness | undefined;
afterEach(() => t?.destroy());

test("comando", async () => {
  expect((await runCommand(dir, "meumodulo ping")).ok).toBe(true);
});

test("página", async () => {
  t = await renderPage(dir, "contador", { cols: 80, rows: 24 });
  await t.press(" ");
  expect(t.frame()).toContain("n = 1");
});
```

Ambas definem `PVX_HOME` e `PVX_USERMODULES` do processo: use um arquivo de teste por módulo, sem paralelismo dentro dele. Para uma consulta assíncrona, use `await t.waitForFrame((f) => f.includes("..."))`.

## O que um módulo nunca faz

- Importar React, `@opentui/*` ou qualquer pacote: só `import type` do `@pvx/sdk` e imports relativos do próprio módulo (dependências vão empacotadas dentro dele).
- Trabalhar na fábrica (I/O, rede, exec, estado).
- Chamar `process.exit`, escrever em `stdout`/`stderr` direto ou pedir dados de forma bloqueante: sempre `ctx.out`, e falta de dado é exit 2 com a mensagem do que passar.
- Receber segredo por argumento, ou guardar segredo em log, estado, saída ou erro.
- Escrever em `prove()`: é somente leitura.
- Ler ou gravar o estado de outro módulo: só pelas consultas dele (`ctx.query`).
- Escrever em `PVX_HOME`, fora do `store` e do `log` que o host entrega.
- Escrever cor hex ou escapes ANSI em texto de UI: use tons e `Text`. O `<text>` mostra escapes literalmente.
- Depender de TTY: tudo que a TUI faz existe como comando na CLI.
- Chamar comando de outro módulo a partir de uma página: a página só roda comandos do próprio módulo.
