# @pvx/sdk

Contrato dos módulos do pvx (SDK v1). O pacote tem tipos e a constante `EXIT` (para o host e os testes; o módulo importa só tipos). Um módulo é um diretório com `pvx-module.json` e um arquivo de entrada que exporta uma fábrica. O modelo pronto está em `templates/pvx-module-template/`. Para o padrão de interação e visual das telas (foco, seleção, mouse, listas, formulários), siga o [`UI.md`](../../UI.md).

Os exemplos marcados com `<!-- test -->` neste arquivo são extraídos e rodados por `test/sdk-readme.test.ts`: cada um é carregado pelo loader real e verificado pelo `tsc`. Exemplo desatualizado quebra o build.

Comece pelo modelo: copie `templates/pvx-module-template/` (um comando, uma capacidade, uma página e testes, já no layout padrão) e leia a seção "Estrutura de um módulo" do `CODIGO.md`.

## Manifest (`pvx-module.json`)

| Campo | Obrigatório | Significado |
| --- | --- | --- |
| `id` | sim | Só minúsculas, dígitos e hífen. Igual ao nome do diretório em `usermodules/`. |
| `version` | sim | Versão do módulo. |
| `entry` | sim | Arquivo de entrada, relativo ao módulo (`src/index.tsx`). Tem de ficar dentro do diretório. |
| `pvx` | não | Faixa semver do pvx aceita (`>=0.1.0`). Fora da faixa, o módulo não carrega e o erro diz qual faixa instalar. |
| `applies` | não | `{ "file": "/etc/..." }`: sem o arquivo o módulo é ignorado em silêncio. |
| `os` | não | Sistemas aceitos: `["linux"]`, `["linux", "macos"]`, `["windows"]`. Sem o campo, qualquer sistema. Em outro sistema, o `pvx modules add` recusa a instalação, salvo com `--any-os`. |
| `distro` | não | Famílias de Linux aceitas (`["rhel", "debian"]`), comparadas sem diferenciar maiúsculas com `ID` e `ID_LIKE` de `/etc/os-release`. Implica Linux. Mesma regra de recusa do `os`. |
| `permissions` | não | `exec`, `net`, `fs`: o que o módulo declara usar. Serve à revisão de confiança e é o que `ctx.exec`, `ctx.net` e `ctx.fs` aceitam (veja Permissões). |
| `contributes` | não | `commands`, `pages`, `widgets`, `capabilities`: o que o módulo entrega, para listar sem importar o código. |
| `uses` | não | Módulos cujas consultas este módulo chama com `ctx.query`. |

## A fábrica

O `entry` exporta por padrão uma função `(sdk) => ModuleDef`. O host a chama uma vez, ao carregar.

**A fábrica não faz trabalho.** Ela só monta e devolve o objeto: nada de ler arquivo, abrir rede, rodar programa ou gravar estado. Todo efeito acontece dentro de `run()`, `prove()`, `data()` ou de uma consulta. O motivo: carregar tem de ser barato e seguro, e um módulo com defeito não pode travar a partida.

`sdk` traz `version` (1), `log` (`debug`, `info`, `warn`, `error`), `ui` (veja adiante), `proof` (veja Capacidades), `errors` e `phases` (veja `ctx.shell` e Fases com retomada) e `fs`.

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

`ctx` traz `args`, `out` (`success`, `warning`, `error`, `info`, `plain`), `log`, `store`, `query`, `isRoot` e `signal`. `ctx.isRoot` é `true` quando o pvx roda como root (no Windows é sempre `true`): use-o em vez de ler o uid do processo (o `ReadCtx` também o tem). `ctx.signal` aborta quando o host para o job em que o comando roda (`jobs.stop`); fora de um job nunca aborta.

`ArgSpec`:

| Campo | Significado |
| --- | --- |
| `name` | Nome do argumento (chave em `ctx.args`). |
| `help` | Texto de ajuda. |
| `kind` | `positional`, `flag` (`--nome`, vira `true`) ou `option` (`--nome valor` ou `--nome=valor`). |
| `required` | Falta do argumento sai com exit 2 e diz qual passar. |
| `secret` | Nunca vem por argumento. Chega por `--<nome>-stdin`, por `PVX_SECRET_<NOME>` ou pelo campo mascarado da TUI. O valor nunca vai para log, histórico, estado nem scrollback. |
| `values` | Candidatos de completar. |

**Ler os argumentos.** Use os leitores tipados do `ctx`, não `ctx.args[...]` com cast (que continua existindo): `ctx.arg(nome)` (texto de um positional, ou `undefined`), `ctx.option(nome)` (texto de uma `option`, ou `undefined`), `ctx.flag(nome)` (`true` só se a flag veio) e `ctx.list(nome)` (uma `option` com `repeat`: os valores, separados por vírgula, viram uma lista sem espaços e sem itens vazios; `[]` se faltar).

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = () => ({
  commands: {
    "tag add": {
      help: "Adiciona tags a um nome",
      args: [
        { name: "nome", help: "Nome", kind: "positional", required: true },
        { name: "tag", help: "Tag (repetível)", kind: "option", repeat: true },
        { name: "forte", help: "Marca como forte", kind: "flag" },
      ],
      run(ctx) {
        const nome = ctx.arg("nome") ?? "";
        const tags = ctx.list("tag");
        const forca = ctx.flag("forte") ? "forte" : "normal";
        ctx.out.success(`${nome}: ${tags.join(", ") || "sem tags"} (${forca}, ${ctx.option("tag") ?? "—"})`);
      },
    },
  },
});
export default factory;
```

`destructive: true` exige `--yes` fora de TTY; a TUI usa a confirmação do host.

**Flags globais.** `--json`, `--yes` e `--help`/`-h` valem em qualquer posição da linha, antes de um `--` (`pvx firewall status --json`). Se o comando declara um arg com o mesmo nome, o arg é do comando e a flag global não age.

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
| `prove(ctx)` | **Somente leitura.** Devolve `{ level: "ok" \| "warn" \| "error", text, evidence?, fix? }`. Recebe o contexto de só leitura (`ReadCtx`, veja Permissões): `log`, `store.get`, `query`, `exec`, `shell` (`run` e `ok`), `strategy` e `fs` de leitura. |
| `fix` | Comando (linha completa, com o módulo) que conserta. Um `fix` devolvido por `prove` vale mais que o da definição. |
| `affects` | Capacidades a provar de novo depois do conserto. |
| `needs` | Capacidades que precisam estar `ok` antes; sem isso, o conserto espera. |
| `optIn` | O conserto nunca roda sozinho com `--yes`. |

**Montar a prova com `sdk.proof`.** Um módulo importa só tipos, então o que monta um `Proof` vem injetado em `sdk.proof`: `ok(texto, { evidence? })`, `warn(texto, { fix?, evidence? })`, `error(texto, { fix?, evidence? })` e `firstProblem(...passos)`. `firstProblem` roda os passos em ordem (cada um é `() => Proof | undefined`, síncrono ou async) e devolve o primeiro que existe e não é `ok`, ou `undefined`. Assim uma capacidade se lê como passos com nome:

<!-- test -->
```ts
import type { ModuleFactory, ReadCtx } from "@pvx/sdk";

const factory: ModuleFactory = (sdk) => {
  const semAplicacao = ({ store }: ReadCtx) => (store.get("aplicado") ? undefined : sdk.proof.warn("nunca aplicado", { fix: "exemplo aplicar" }));
  const listasMudaram = ({ store }: ReadCtx) => (store.get("mudou") ? sdk.proof.error("as listas mudaram", { evidence: "veja `exemplo diff`" }) : undefined);

  return {
    capabilities: [
      {
        id: "exemplo.ativo",
        title: "Regras ativas",
        goal: "As regras aplicadas estão em dia",
        prove: async (ctx) => (await sdk.proof.firstProblem(() => semAplicacao(ctx), () => listasMudaram(ctx))) ?? sdk.proof.ok("tudo certo"),
      },
    ],
  };
};
export default factory;
```

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

`queries` expõe leituras para outros módulos: o nome é `"<módulo>.<nome>"`, a função recebe `(name, ...args)` e devolve um valor ou uma promessa. Quem chama usa `ctx.query(nome, ...args)` e declara o módulo em `uses` no manifest. Consulta é leitura (só leitura): não grava estado. O host chama a função com `this` igual ao `ReadCtx` do módulo (`this.store.get`, `this.exec`, `this.fs.read`): use `function` ou sintaxe de método para alcançá-lo, porque uma arrow function o ignora. Uma página lê a própria consulta com `useQuery`.

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
- **Componentes:** `Panel` (`title`, `tone`, `grow`, `shrink`; na raiz da página não desenha borda nem título, veja Páginas), `Text` (`tone`, `bold`), `Chip`, `Meter` (`value` de 0 a 1), `KeyHint`, `Table` (`columns`, `rows`), `List` (`items`, `selected` por id, `columns` opcional; veja List em colunas), `Form` (formulário gerado do `ArgSpec` de um comando do módulo), `Spacer`, `Steps` e `LogTail` (veja Jobs em segundo plano), `Notice` (veja List em colunas) e `Conversation`, `Button`, `ProgressBar`, `CellGrid` e `Loading` (veja Componentes de fluxo).
- **Hooks do host:** `useCommand(linha)` roda um comando **do próprio módulo** pela sessão (aparece no scrollback e no histórico); `useQuery(nome, ...args)` e `useQuery(nome, args, { refreshMs })` (devolve também `refetch()`; roda de novo a cada `refreshMs`, mínimo 500, enquanto a página está montada; os dados antigos ficam até os novos chegarem e a página só renderiza de novo se o resultado mudou); `useJob(nome)` e `useRun(nome)` (veja Jobs em segundo plano e Fases com retomada); `useAsync(fn, deps)` e `useCopy()` (veja Componentes de fluxo); `useStore()`; `useRouter()` (`push(página)`, `pop()` entre páginas do módulo); `useKey(teclas, rótulo, handler)` (veja Páginas); `useConformity()` (veja Conformidade na UI); `useTheme()` (cores `c` e glifos `g`).
- **Tons:** `ok`, `warn`, `error`, `info`, `accent`, `dim`, `text`. Nunca escreva cor hex: use os tons.

**List em colunas.** Com `columns` a `List` alinha as células de cada item em colunas, mesmo com textos de tamanhos diferentes. Cada coluna é `{ id, title?, width?, grow?, align? }`: `width` é fixa e nunca encolhe; `grow` divide o que sobra (peso relativo); sem nenhuma das duas a coluna ocupa o tamanho do conteúdo e é a primeira a encolher se faltar espaço. `align` é `"left"` (padrão) ou `"right"`. Se alguma coluna tem `title`, aparece uma linha de cabeçalho (dim). O item traz `cells: { [idDaColuna]: texto | { text, tone? } }` (`label` e `detail` são ignorados nesse modo; `tone` e `mark` valem). Célula que não cabe é cortada com `…`. A largura vem da própria lista, então acompanha o redimensionamento.

**Mouse na List.** `onPress(id)` roda no clique numa linha (o clique ainda sobe para o `onPress` do `Panel`; a página ignora o do painel quando a linha já tratou, como o Início faz) e `onHover(id)` roda quando o mouse entra numa linha (`onHover(undefined)` quando sai). A linha sob o mouse que não é a `selected` ganha um destaque leve (fundo do painel e um `›` apagado), diferente da selecionada. Passar o mouse nunca muda `selected`: se a lista está ativa, mude a seleção no `onHover`.

**Marquee.** Só a linha `selected` anima, e só as células cortadas: mostra o começo, espera cerca de 1,2 s, rola 1 caractere a cada 120 ms até o fim aparecer, espera de novo e volta, em vai e volta. Trocar `selected` zera a linha anterior. Sem célula cortada na linha selecionada não existe timer. Para a lista sem foco, passe `selected` indefinido: nada anima.

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Panel, List, useState, useKey } = sdk.ui;
  const regras = [
    { id: "a", ip: "189.124.85.152/29", estado: "aceito", nota: "PHONEVOX REDE" },
    { id: "b", ip: "192.168.1.1", estado: "bloqueado", nota: "teste" },
  ];

  function Regras() {
    const [sel, setSel] = useState("a");
    useKey("space", "próxima", () => setSel((s) => (s === "a" ? "b" : "a")));
    return (
      <Panel>
        <List
          selected={sel}
          columns={[
            { id: "ip", title: "IP", width: 18 },
            { id: "estado", title: "ESTADO", width: 10 },
            { id: "nota", title: "NOTA", grow: 1 },
          ]}
          items={regras.map((r) => ({
            id: r.id,
            cells: { ip: r.ip, estado: { text: r.estado, tone: r.estado === "aceito" ? "ok" : "error" }, nota: r.nota },
          }))}
        />
      </Panel>
    );
  }

  return { pages: { regras: { title: "Regras", render: () => <Regras /> } } };
};
```

**Janela (`maxRows`).** Uma lista longa desenha só `maxRows` linhas (o cabeçalho fica) e mantém a `selected` dentro da janela, movendo-a o mínimo: as linhas não pulam enquanto a seleção anda dentro dela. Calcule `maxRows` pelo `useViewport()`; sem `maxRows` toda linha é desenhada. A largura das colunas continua vindo de todas as linhas, então elas não mexem ao rolar. Mostre a posição (`3/13`) no título se o usuário precisa saber que há mais.

**`Panel shrink`.** Um `Panel` com `shrink` cede altura quando a página é baixa e corta o conteúdo, em vez de empurrar a barra de abas e o rodapé do host para fora da tela. Use-o no painel que carrega a lista, junto de `maxRows`.

**Ação da linha (`onAction`).** `onAction(id)` é a ação padrão de uma linha: `enter` na linha selecionada (o rodapé mostra `enter <actionLabel>`, padrão "abrir") e o clique numa linha (depois do `onPress`). Ela abre o formulário da linha: um `Fields` com os campos editáveis e `onDelete` para o `remover`, que o framework confirma (UI.md, seção 4). Não mapeie também o `enter` da mesma lista na página: dispararia duas vezes. Duas `List` com `onAction` na mesma página (ou no mesmo painel) podem receber o mesmo `selected`: só a lista que tem uma linha com esse id registra o `enter`, então o rodapé o mostra uma vez e só ela age. `actionOnClick` (padrão `true`) decide o clique: com `false`, um clique só seleciona (chama o `onPress`); `enter`, ou um clique na linha que já está selecionada, abre a ação. Use `false` quando abrir o formulário num clique solto seria agressivo (lista longa, ação destrutiva).

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Panel, List, Fields, Notice, useState, useViewport, useStore } = sdk.ui;
  const CHROME_ROWS = 10;

  function Regras() {
    const store = useStore();
    const { rows } = useViewport();
    const [aberta, setAberta] = useState<string | undefined>(undefined);
    const [selected, setSelected] = useState("0");
    const itens = Array.from({ length: 40 }, (_, i) => ({ id: String(i), label: `regra ${i}` }));
    if (aberta !== undefined) {
      return (
        <Fields
          fields={[{ id: "comentario", label: "comentário", kind: "line" }]}
          onSubmit={() => setAberta(undefined)}
          onCancel={() => setAberta(undefined)}
          onDelete={() => {
            store.delete(`regra:${aberta}`);
            setAberta(undefined);
          }}
        />
      );
    }
    return (
      <Panel>
        <Panel title="regras" shrink>
          <List items={itens} selected={selected} maxRows={Math.max(3, rows - CHROME_ROWS)} onPress={setSelected} onAction={setAberta} />
        </Panel>
        <Notice level="warn">precisa aplicar</Notice>
      </Panel>
    );
  }

  return { pages: { regras: { title: "Regras", render: () => <Regras /> } } };
};
```

**`Notice`.** `Notice({ level, children })` é um bloco de resultado em linha, no formato do tema (`[✓]`, `[!]`, `[✗]`) e na cor do nível (`ok`, `warn`, `error`); o texto pode ter várias linhas. Só tokens do tema. Use-o para avisos que ficam na tela ("precisa aplicar", "a última aplicação foi revertida"); o `useNudge` é para o aviso que passa.

**`useNudge(msg, tom)`.** O segundo argumento mostra um resultado no rodapé, com o glifo e a cor do tema, por cerca de 4 s: `"ok"` (`✓ msg`, cor de destaque), `"warn"` (`▲ msg`, cor de aviso) ou `"error"` (`✗ msg`, cor de erro). Sem ele é o aviso curto de movimento inválido.

**`useQuery(...).refetch()`.** Lê a consulta de novo agora, mantendo os dados antigos até os novos chegarem; devolve uma promessa. Chame depois de uma ação que mudou o que a consulta lê (`await command.run(); await query.refetch()`). Se uma leitura já está em andamento, ela termina e uma nova roda em seguida (a primeira pode ser anterior à mudança).

Na CLI (sem TUI) `sdk.ui` aceita ser desestruturado, mas qualquer chamada lança "UI indisponível na CLI": por isso componentes só rodam dentro de `render()`.

## Páginas, abas e widgets

**Página.** `pages` mapeia o nome da página para `{ title, render, keys?, tab? }`.

- `render()` devolve JSX e roda dentro do componente da página: pode chamar hooks. Se lançar, o host registra o erro, volta e avisa; o resto não é afetado.
- Abre-se por `#<módulo>.<nome>` (ou `#<nome>`, se for único), na palette (`ctrl+k`, escopo `#`) ou no campo de comando; ou por um comando com `page`.
- **Teclas: `useKey(teclas, rótulo, handler)`.** Chame no `render` ou em qualquer componente da página: o `handler` enxerga o estado do componente, e a tecla vale enquanto o componente está montado (some do rodapé e do `?` quando ele sai). Formatos: `a`, `space`, `enter`, `ctrl+x`, `L`, `←`, `→`. Um quarto argumento `{ help: true }` põe a tecla só no `?`. `useNudge()(msg)` mostra o aviso curto do host para uma tecla sem efeito. `Row` põe filhos lado a lado e `Panel grow` iguala a altura de painéis irmãos. **Foco entre painéis: `usePanels()`.** Dê a cada `Panel` navegável `panelRef={p.ref(id)}`; `p.pick(atual, "left"|"right"|"up"|"down")` devolve o id do painel que está de fato naquela direção na tela (pela posição desenhada, então segue o layout: `→` com painéis lado a lado, `↓` empilhados). `p.step({ panel, inside }, tecla, size)` aplica a regra de dois níveis do host: no nível do painel, as setas trocam de painel e `enter` entra num painel com itens (`size(id) > 0`; sem itens vem `nudge: "nada para selecionar"`); dentro, `up`/`down` dão `move`, `enter` dá `act` e `esc` sai. A página guarda o estado e a lista; `bar` indica `↑` sem painel acima, e `p.toBar()` foca a barra de abas (o que o Início faz nesse caso; sem efeito se a página não está numa aba). **Foco da página: `usePageFocused()`.** Devolve `true` enquanto a página recebe teclas: numa aba, quando a aba está ativa e a barra de abas não tem o foco; numa página empilhada, enquanto ela é a tela do topo. A página redesenha quando o valor muda (por exemplo, depois de `p.toBar()` ou de `↓` de volta à aba). Use-o para desenhar o painel focado só enquanto a página tem o foco. **Esc: `useBack(fn?)`.** Enquanto um componente com `useBack(fn)` está montado, `esc` chama `fn` e fica na página, em vez de voltar (à barra de abas, ou à tela anterior numa página empilhada); com `fn` indefinido vale o padrão, então `useBack(inside ? sai : undefined)` funciona. Com vários montados, vale o último montado que tenha função. `ctrl+c` e `ctrl+k` continuam do host. Reservadas (ignoradas em `useKey`): `esc`, `?`, `ctrl+c`, `ctrl+k`. Uma tecla que lança vai para o log do módulo.
- **Receita: aba de módulo como o Início.** Painéis navegáveis por setas, `enter` entra, `esc` sai, `↑` no painel de cima foca a barra:
  1. `const p = usePanels()`; dê `panelRef={p.ref(id)}` a cada `Panel`.
  2. Guarde `{ panel, inside }` com `useState`. Nas setas e no `enter`, chame `p.step({ panel, inside }, tecla, size)` e aplique o resultado: `panel`/`inside` viram o novo estado, `move` e `act` agem na lista de dentro (use `p.wrap(i, move, total)` para `↑`/`↓` voltarem ao outro extremo da lista), `nudge` vai para `useNudge()`, e `bar` vira `p.toBar()`.
  3. Desenhe o painel focado (borda de destaque e `●`) só com `usePageFocused()` verdadeiro: `focused = usePageFocused() && f.panel === id`. Assim, com o foco na barra de abas, nenhum painel aparece focado, como no Início.
  4. `useBack(inside ? () => setInside(false) : undefined)`: `esc` sai do painel; no nível do painel o padrão leva à barra.
  5. Rodapé por nível: ponha as `useKey` de cada nível em um componente próprio e renderize só o do nível atual (`<NoPainel />` ou `<Dentro />`); a tecla some do rodapé quando o componente sai.
  6. Clique do mouse: `<Panel onPress={() => setF({ panel: id, inside: false })}>` é chamado no clique em qualquer ponto do painel (filhos incluídos); use-o para focar o painel clicado.

  ```tsx
  const [f, setF] = useState({ panel: "a", inside: false });
  const key = (k: "left" | "right" | "up" | "down" | "enter") => {
    const st = p.step(f, k, (id) => itens[id].length);
    if (!st) return;
    if (st.bar) return p.toBar();
    if (st.nudge) return nudge(st.nudge);
    if (st.move) moveSelecao(f.panel, st.move);
    else if (st.act) abreSelecionado(f.panel);
    setF({ panel: st.panel, inside: st.inside });
  };
  useBack(f.inside ? () => setF({ ...f, inside: false }) : undefined);
  ```
- `keys` em `PageDef` (`{ keys, label, run }[]`) continua valendo para teclas que não precisam do estado do componente; entram na mesma tabela de atalhos.
- **Moldura.** O host desenha a borda da página e o título `› <title>`. Um `Panel` na raiz da página é só o conteúdo (sem borda e sem título): assim a página mostra uma moldura só. Para seções dentro da página, ponha `Panel` dentro de outro `Panel`: os internos têm borda e título.

**Aba (opcional; módulos não são obrigados a expor aba).** Sem `tab`, a página aparece na lista do módulo em Módulos (marca `§`) e abre como tela empilhada; `esc` volta. Com `tab: true` ou `tab: { label, order }` põe a página também na barra de abas, depois das abas do núcleo, ordenada por `order` e depois por rótulo. A aba visitada continua montada enquanto a tela de abas existe.

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

`priority` ordena os widgets dentro do slot. `data(ctx)` recebe o `ReadCtx` (só leitura) e pode ser assíncrona; é chamada de novo a cada `refreshMs`, se houver. Um `data()` que passa de 2 s é removido: dê um `timeoutMs` curto ao `ctx.exec` que usar. O contrato dos widgets segue os tipos de `src/index.ts` (`WidgetDef`, `SlotId`, `SlotData`): em caso de dúvida, os tipos valem.

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

## Papéis: o host pede pelo papel, nunca pelo nome do módulo

O host não cita módulo pelo nome (nem `nota`, nem `conformidade`). Quando precisa de algo que um módulo oficial fornece, ele pede por **papel**, e o módulo o declara:

| Papel | Onde se declara | O que o host faz com ele |
| --- | --- | --- |
| `role: "plan"` | `PageDef.role` | A página do plano: hoje a página do módulo `conformidade`, com os painéis resultados e plano. O host a abre como tela empilhada, sem nomear o módulo. |
| `role: "notes"` | `PageDef.role` | O Início abre essa página (tela empilhada) no `n` e no painel de notas. |
| `roles.compose` | `ModuleDef.roles` | Nome de uma consulta: o `n` do Início a chama para abrir o editor de nota. |
| `roles.notesState` | `ModuleDef.roles` | Nome de uma consulta que devolve as notas dobradas (`{ author, at, text, pinned, login?, resolved }[]`): o banner de login lê as fixadas por ela. |
| `roles.addNote` | `ModuleDef.roles` | Comando que cria nota (`"<id> add"`, aceita `--tag`, `--ref` e o texto): `conformidade ignorar` grava o motivo com ele. |

Cada papel tem um dono só: um segundo módulo que o declare é recusado ("conflito"). Sem dono, a função some em silêncio (sem notas, o `n` do Início não faz nada).

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = (sdk) => ({
  commands: { add: { help: "Cria uma nota", run: (ctx) => ctx.out.success("criada") } },
  queries: {
    "notas.compose": () => undefined,
    "notas.state": () => [],
  },
  pages: { notas: { title: "notas", render: () => <sdk.ui.Text>notas</sdk.ui.Text>, role: "notes" } },
  roles: { compose: "notas.compose", notesState: "notas.state", addNote: "doc add" },
});
export default factory;
```

## Sessão: `ctx.session.sshClient`

`ctx.session.sshClient` (em `CommandCtx` e em `ReadCtx`) é o IP, v4 ou v6, do cliente SSH do técnico, ou `undefined` num login de console ou serial. É só leitura. O host acha o IP uma vez por processo, na primeira leitura, e guarda a resposta. Ele tenta, nesta ordem, e para na primeira que responde:

1. `SSH_CONNECTION` ou `SSH_CLIENT` no ambiente do pvx.
2. O ambiente dos processos pais (`/proc/<pid>/environ`, de pai em pai até o pid 1). Isso sobrevive a `sudo`, `sudo -i` e `su -`, que limpam o ambiente do pvx mas não o do shell de login acima deles. Só no Linux; entrada ilegível é ignorada.
3. O terminal do pvx (`/proc/self/fd/0`, 1 ou 2) casado com a linha do `who`, e o `(ip)` dela. Só no Linux.

Use no lugar de ler `SSH_CLIENT` ou rodar `who -m`: o primeiro some com `sudo`, e o segundo não enxerga o terminal quando o `exec` do módulo usa `stdin` em pipe. O audit (`audit.jsonl`) grava o mesmo IP em `from` nos eventos de comando e de módulo. Nos testes, `runCommand`, `runSession` e `renderPage` aceitam `sshClient`; sem ele o valor é `undefined`.

## Permissões: `ctx.exec`, `ctx.net`, `ctx.fs`

Em um comando, `ctx.exec`, `ctx.net` e `ctx.fs` só aceitam o que o manifest listou em `permissions`. Fora disso, lançam um erro claro e o host registra a violação no log do módulo e no `core.log`.

| API | Regra |
| --- | --- |
| `ctx.exec(cmd, args?, { cwd, env, stdin, timeoutMs, onLine, signal, buffer })` | O nome base de `cmd` está em `permissions.exec`. Roda sem shell (`Bun.spawn`), com limite de tempo (30 s por padrão) e devolve `{ code, stdout, stderr }`. Veja Streaming e cancelamento. |
| `ctx.net.fetch(url, init?)` | `host[:porta]` da URL está em `permissions.net`; só `http` e `https`. Redirecionamentos não são seguidos. `init`: `method`, `headers`, `body` (texto ou `Uint8Array`), `bodyFile` (um arquivo lido do disco aos poucos, com o tamanho no `Content-Length`; o caminho precisa de leitura em `permissions.fs`; `body` e `bodyFile` juntos dão erro), `signal` e `timeoutMs` (30 s se omitido; vale também enquanto se lê a resposta). |
| `ctx.net.upload(url, { file, field?, fields?, filename?, headers?, method?, signal?, timeoutMs? })` | As mesmas regras de host. Envia `file` como `multipart/form-data` **sem carregá-lo na memória** (um arquivo de vários GB custa alguns MB): os `fields` de texto vão primeiro, depois a parte do arquivo (`field`, padrão `file`; `filename`, padrão o nome do arquivo), e o tamanho total vai no `Content-Length`. O caminho precisa de leitura em `permissions.fs`; algo que não é um arquivo regular dá erro. `Content-Type` e `Content-Length` em `headers` são trocados pelos do envio. Um envio grande precisa de `timeoutMs` explícito. |
| `ctx.fs.read / write / exists / list` | O caminho (resolvido, com symlinks) fica sob um prefixo de `permissions.fs`. O prefixo `rw:` libera escrita; sem ele, só leitura. O diretório de estado do próprio módulo é sempre permitido. |
| `ctx.fs.write(path, texto, { mode, atomic })` | Mesma regra de `rw:`. `mode` (`0o600`) trava o arquivo antes de o conteúdo entrar, mesmo sobre um arquivo antigo mais aberto; `atomic` grava um temporário ao lado e o renomeia sobre `path`, então quem lê vê o arquivo antigo ou o novo inteiro. Sem opções, a escrita é a de sempre. |
| `ctx.fs.entries(path)` | Leitura. Como `list`, mas devolve `{ name, type }[]` (`file`, `dir`, `symlink`, `other`), em ordem de nome. Um symlink aparece como `symlink`, não como o alvo. |
| `ctx.fs.stat(path)` | Leitura. `{ size, isDir, mode, mtimeMs }` (`mode` só com os bits de permissão), ou `undefined` se não existe. |
| `ctx.fs.du(path)` | Leitura. Bytes que `path` ocupa em disco, como `du -s`: soma uma pasta por inteiro, não segue symlink, conta um hard link uma vez e pula o que sumiu ou não dá para ler. `0` se não existe. Roda sem travar a TUI. |
| `ctx.fs.free(path)` | Leitura. `{ totalBytes, availableBytes }` do sistema de arquivos de `path` (`availableBytes` é o que um usuário comum ainda grava, o `Avail` do `df`). Se `path` ainda não existe, vale o primeiro pai que existe: dá para medir o destino antes de criá-lo. |
| `ctx.fs.mkdir(path, { mode? })` | Mesma regra de `rw:`. Cria a pasta e os pais. `mode` (`0o700`) vale na pasta criada, seja qual for o umask; uma pasta que já existe fica como está. |
| `ctx.fs.remove(path, { recursive? })` | Mesma regra de `rw:`. Apaga o arquivo (não erra se ele não existe); com `recursive`, uma pasta e tudo dentro dela. Recusa `/` mesmo que o manifest tenha `rw:/`, e um caminho fora dos prefixos `rw:` (ou sob um prefixo só de leitura). Apagar um symlink apaga o link, nunca o alvo. Sem `recursive`, uma pasta dá erro. |
| `ctx.fs.append(path, texto)` | Mesma regra de `rw:`. Uma única chamada de escrita com `O_APPEND` (arquivo criado com modo 0644): dois processos acrescentando linhas ao mesmo arquivo nunca as misturam. |

**Cabeçalhos nunca vão para o log.** O host registra uma violação de permissão (só `host:porta`, nunca a URL completa nem os cabeçalhos) e não registra pedidos: um `Authorization` em `headers` só vai para a rede. Os erros de `ctx.net` não repetem cabeçalhos. Mesmo assim, o módulo não deve pôr o token no texto de um erro que ele mesmo escreve.

`$PVX_HOME` (dados da central) e `$PVX_PROFILED_DIR` (`/etc/profile.d`, onde ficam ganchos de login) valem em `permissions.fs` e nos caminhos de `ctx.fs` (o host os expande). Fora de um comando, `sdk.fs` segue as mesmas regras (use-o só no que não tem `ReadCtx`).

**Contexto de só leitura (`ReadCtx`).** `prove()`, as consultas (`this`) e o `data()` dos widgets recebem `{ log, store, query, session, exec, fs, jobs, phases }` com estas diferenças:

| Campo | Em `ReadCtx` |
| --- | --- |
| `store` | Só `get`: não existe `set` nem `delete`. |
| `fs` | Só as leituras (`read`, `exists`, `list`, `entries`, `stat`, `du`, `free`): não existem `write`, `append`, `mkdir` nem `remove`. Mesmas regras de caminho de `ctx.fs`. |
| `exec` | A mesma lista de `permissions.exec`, o mesmo limite de tempo (30 s) e cada chamada vai para o log do módulo. |
| `jobs` | Só `status`, `list` e `log` (veja Jobs em segundo plano). |
| `shell` | Só `run` e `ok`, sobre o `exec` acima (mesma lista, mesmo log): uma sonda relata, não lança, então não existe `must`. Veja `ctx.shell`. |
| `strategy` | O mesmo `pick` de `sdk.strategy`. |
| `phases` | Só `state` (veja Fases com retomada). |

Capacidade, consulta e widget são **só leitura** por contrato. O `exec` não tem como ser só leitura por construção: neste contexto o módulo roda apenas sondas (`systemctl is-active`, `nft list ruleset`, `--version`) e nunca algo que mude o sistema. É o mesmo modelo de confiança dos comandos: a revisão humana do commit é a barreira.

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

// pvx-module.json: "permissions": { "exec": ["uname"] }
const factory: ModuleFactory = () => ({
  capabilities: [
    {
      id: "doc.kernel",
      title: "Kernel",
      goal: "O kernel responde",
      async prove(ctx) {
        const r = await ctx.exec("uname", ["-r"], { timeoutMs: 2000 });
        return r.code === 0 ? { level: "ok", text: r.stdout.trim() } : { level: "error", text: "uname falhou" };
      },
    },
  ],
  queries: {
    "doc.ultimo": function () {
      return this.store.get("ultimo");
    },
  },
  widgets: {
    chip: { slot: "home.summary", priority: 0, data: (ctx) => String(ctx.store.get("ultimo") ?? "sem registro") },
  },
});
export default factory;
```

Também no SDK: `CommandDef.readonly` (o comando só lê e roda sem root), `ArgSpec.stdin` (posicional de texto livre; sem valor e sem TTY, lê a entrada padrão, e as palavras que sobram entram nele), `ArgSpec.repeat` (opção que pode se repetir; o valor chega separado por vírgula), `ui.Fields` (formulário, veja abaixo), `ui.useViewport()` e `useCommand(linha).run({ args, stdin, secrets })`. `secrets` (pelo nome do `ArgSpec`, como `{ token: "..." }`) chega ao comando como no `Form`: pelo ambiente daquela execução, nunca no argv, na linha do scrollback, no histórico, no estado nem no log.

`ui.Fields` desenha um formulário com campos `area`, `line`, `toggle` (caixa de marcar; `text` é o texto ao lado dela), `secret`, `choice` e `multi` (veja abaixo) e os botões `[ salvar ]` e `[ cancelar ]`, sempre presentes. Todo o teclado é do formulário:

- `↑`/`↓` e `tab`/`shift+tab` andam por campos e botões, dando a volta (dentro de uma `area` só o `tab` anda).
- `←`/`→` movem o cursor no texto e, num botão, passam para o botão vizinho.
- `enter` num texto vai ao próximo campo e, no último, envia; numa caixa marca; num botão ativa. `espaço` também marca.
- `secret`: uma linha mascarada (`●`), editada como `line`; o valor chega em `onSubmit` e não vai para histórico nem log. Com `generate: "ctrl+g"` (a tecla que o campo documenta no rodapé e no `?`) a tecla preenche 24 letras e dígitos aleatórios, legíveis enquanto o foco fica no campo.
- `choice`: escolha única com `options: { value, label, detail? }[]`, desenhada `(●)`/`( )`. `↑`/`↓` andam pelas opções (nas pontas passam ao campo vizinho), `espaço` escolhe, `enter` escolhe e avança. O valor é o `value` escolhido (a primeira opção, se `initial` não diz).
- `multi`: lista de caixas `[x]`/`[ ]` com as mesmas `options`; `espaço` marca, `enter` avança. O valor é a lista dos `value` marcados, em ordem das opções, **separada por vírgula** (`initial` no mesmo formato).
- `ctrl+s` sempre envia e `esc` cancela. O mouse foca o campo, marca a caixa e ativa o botão.
- `validate(valores)` roda antes de `onSubmit`: devolva `{ idDoCampo: "mensagem" }` para mostrar o erro sob o campo e bloquear o envio.
- `buttons={false}` esconde `[ salvar ]`, `[ cancelar ]` e `[ remover ]` (enter no último campo e `ctrl+s` enviam); `onEdge(dir)` recebe a seta `↑`/`↓` que passaria da ponta, em vez de dar a volta; `active={false}` estaciona o formulário (sem cursor, sem teclas, sem linhas no rodapé). `Conversation` usa os três; use-os para um formulário que faz parte de um fluxo maior.
- `onDelete` (e `deleteLabel`, padrão "remover") acrescenta o botão `[ remover ]`; ele pergunta "remover? enter confirma · esc volta" antes de chamar a função.

```tsx
<Fields
  fields={[
    { id: "ip", label: "IP ou CIDR", kind: "line" },
    { id: "deny", label: "bloquear", kind: "toggle", text: "em vez de aceitar" },
  ]}
  validate={(v) => (String(v.ip).trim() ? undefined : { ip: "informe o IP" })}
  onSubmit={salva} onCancel={volta} onDelete={remove}
/>
```

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

Um comando que mede o espaço, envia o arquivo mais novo sem carregá-lo na memória e apaga a pasta velha:

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

// pvx-module.json: "permissions": { "net": ["uoe.example.com"], "fs": ["rw:/var/backups/meu-modulo"] }
const factory: ModuleFactory = () => ({
  commands: {
    envia: {
      help: "Envia o arquivo mais novo e apaga a pasta velha",
      async run(ctx) {
        const dir = "/var/backups/meu-modulo";
        await ctx.fs.mkdir(dir, { mode: 0o700 });
        const { availableBytes } = await ctx.fs.free(dir);
        const files = (await ctx.fs.entries(dir)).filter((entry) => entry.type === "file");
        const newest = files.at(-1);
        if (!newest) {
          ctx.out.info(`nada a enviar (${availableBytes} bytes livres, ${await ctx.fs.du(dir)} em uso)`);
          return;
        }
        const token = ctx.store.get<string>("token") ?? "";
        const reply = await ctx.net.upload("https://uoe.example.com/v1/upload", {
          file: `${dir}/${newest.name}`,
          fields: { path: "/clientes/x" },
          headers: { authorization: `Bearer ${token}` },
          signal: ctx.signal,
          timeoutMs: 2 * 60 * 60_000,
        });
        if (!reply.ok) {
          ctx.out.error(`envio recusado (${reply.status})`);
          return;
        }
        await ctx.fs.remove(`${dir}/velho`, { recursive: true });
        ctx.out.success(`${newest.name} enviado`);
      },
    },
  },
});
export default factory;
```

## `ctx.shell`, `store.update` e `sdk.strategy`

`ctx.shell` é uma camada sobre `ctx.exec` e **respeita a mesma lista `permissions.exec`**: um programa fora dela lança o erro de permissão, nunca vira código de saída.

| API | O que faz |
| --- | --- |
| `shell.run(cmd, args?, opts?)` | Devolve `{ code, stdout, stderr, tail }`. Não lança por saída ruim; um programa que não inicia dá `code` 127. `tail` guarda as últimas linhas úteis (barras de progresso saem). |
| `shell.must(cmd, args?, opts?)` | Como `run`, mas uma saída diferente de 0 lança um `StepError` (`name`, `command`, `code`, `output`): a causa e as linhas que importam da saída. |
| `shell.ok(cmd, args?, opts?)` | `true` se a saída foi 0. |

No `ReadCtx` (provas, consultas, widgets) `ctx.shell` só tem `run` e `ok`, sobre o `exec` de só leitura: a sonda não precisa de um `run` próprio.

`opts` é o de `ctx.exec` mais `display` (o texto do comando no `StepError`, para quando o argv leva um segredo). O corredor de fases (`ctx.phases`) grava o `command`, o `code` e o `output` de um `StepError` na falha da fase.

`store.update(chave, mudar)` lê o valor (`undefined` se faltar), aplica `mudar` e grava o resultado, que também devolve: `store.update<number>("contagem", (atual) => (atual ?? 0) + 1)`. O estado é gravado com permissão 0600.

`sdk.strategy.pick(estratégias, { setting, none })` escolhe o backend que o módulo dirige. Cada estratégia é `{ id, available() }`. Com `setting` ausente ou `"auto"` vale a primeira disponível, na ordem da lista (`auto: true`); se nenhuma está, devolve `{ error: none }`. Com um `setting` explícito vale esse `id` sem perguntar `available` (o módulo explica depois por que ele não roda); um `id` desconhecido é `{ error }`. O mesmo `pick` está em `ctx.strategy` (em `CommandCtx` e em `ReadCtx`): um comando ou uma prova que escolhe o backend o chama sem depender do `sdk` da fábrica.

**Eco no log do job: `ctx.shell.echoing(padrões?)`.** Devolve um shell (`run`, `must`, `ok`) cujas chamadas escrevem `$ <comando>` em `ctx.jobLog` e depois cada linha não vazia da saída (fora de um job `jobLog` não faz nada, e só os padrões valem). O comando mostrado é `opts.display` quando existe, senão o argv: **passe `display` sempre que o argv levar um segredo**; o `stdin` nunca aparece, e o host ainda troca por `***` os valores de `secrets` do job no log. `padrões` (`timeoutMs`, `buffer`, `onLine`...) preenchem o que a chamada não diz e a chamada vence; `signal` vale `ctx.signal` (cada programa roda no seu grupo de processos, então `jobs.stop` o derruba) e `buffer` vale `false` (a saída só passa pelo log, não fica na memória). O `onLine` da chamada continua rodando.

**Ler e criar um `StepError`: `sdk.errors`.** Um módulo importa só tipos, então não tem o `isStepError` do host. `sdk.errors.isStepError(erro)` diz se o erro tem a forma de um `StepError` (o que `shell.must` lança) e estreita o tipo; `sdk.errors.describeFailure(erro)` devolve a mensagem e, para um `StepError`, as linhas úteis da saída, uma por linha, com recuo de dois espaços (qualquer outro erro dá só a mensagem). Use-o ao relatar uma falha: `ctx.out.error(sdk.errors.describeFailure(error))`. O host usa o mesmo texto quando um `StepError` escapa de um comando (`erro interno no comando: ...`). `sdk.errors.stepError(mensagem, comando, código, saída)` cria um `StepError` para uma falha que não veio de `shell.must` (uma checagem que achou o problema): o corredor de fases a grava como as outras (`command`, `code`, `output`).

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

// pvx-module.json: "permissions": { "exec": ["systemctl", "nft", "iptables"], "fs": ["rw:/etc/meu-modulo"] }
const factory: ModuleFactory = (sdk) => ({
  commands: {
    aplicar: {
      help: "Aplica com o primeiro engine disponível",
      async run(ctx) {
        const engines = [
          { id: "nftables", available: () => ctx.shell.ok("nft", ["--version"]) },
          { id: "iptables", available: () => ctx.shell.ok("iptables", ["--version"]) },
        ];
        const picked = await sdk.strategy.pick(engines, { setting: ctx.option("engine"), none: "nenhum engine neste host" });
        if ("error" in picked) {
          ctx.out.error(picked.error);
          return;
        }
        ctx.store.update<number>("aplicacoes", (atual) => (atual ?? 0) + 1);
        await ctx.fs.write("/etc/meu-modulo/ultimo", picked.strategy.id, { mode: 0o600, atomic: true });
        ctx.out.success(`aplicado com ${picked.strategy.id}`);
      },
      args: [{ name: "engine", help: "auto, nftables ou iptables", kind: "option" }],
    },
  },
});
export default factory;
```

## Fases com retomada: `ctx.phases` e `useRun`

Uma tarefa longa (um instalador) é uma lista de fases com nome, rodadas em ordem. `ctx.phases.run(nome, fases, { fresh? })` grava no `store` (chave `phases:<nome>`) o que cada fase fez, a cada mudança. Rodar de novo **retoma**: a fase pronta é pulada e as outras rodam. A fase que falhou (ou que o processo deixou rodando) roda de novo. `fresh: true`, ou uma lista de ids diferente, recomeça do zero. Para na primeira fase que lança e devolve `{ ok: false, failedPhase, error }`; o motivo fica em `state.failure` (`phase`, `message` e, se a causa foi um `StepError`, `command`, `code`, `output`). Cada fase escreve em `ctx.out` (`fase <rótulo>: iniciando`, `concluída`, `pulada (...)`, `falhou: ...`).

Cada fase é `{ id, label, weight?, run(phase) }`. `run` pode devolver `{ detail }` (nota guardada) ou `{ skipped: "motivo" }` (nada a fazer: vira `skipped`); `phase.report(texto)` atualiza o detalhe enquanto roda (grava o `store`: não chame centenas de vezes por segundo). `phase.progress(fração)` (0 a 1) diz até onde a fase foi: o progresso geral é a soma dos pesos das fases prontas mais o peso da fase em curso vezes a fração, então a barra anda numa fase longa. O host grava no máximo a cada 250 ms ou quando a fração anda 1%, e a fração some quando a fase termina. `weight` (padrão 1) pesa no progresso. `ctx.phases.state(nome)` lê o estado (também no `ReadCtx`, para consultas) e `ctx.phases.reset(nome)` o esquece.

Para ler o estado fora da página (um `status` que imprime "andamento: N%"), use `sdk.phases.progress(estado)` (0 a 1) e `sdk.phases.finished(estado, trailing?)` (`true` quando toda fase está pronta ou pulada, salvo as de `trailing`).

Na página, `useRun(nome, { tail?, staleMs?, trailing? })` junta o job `nome` e as fases do mesmo nome:

| Campo | Significado |
| --- | --- |
| `steps` | As linhas de `Steps`, uma por fase, com o tempo; o tempo da fase em curso avança sozinho (um tique de 1 s enquanto o run está `running` ou `stale`), a página não precisa de timer. |
| `progress` | 0 a 1, pelo peso das fases, com o `phase.progress` parcial da fase em curso (`ProgressBar value`). |
| `loading` | `true` até a primeira leitura do job: enquanto isso o `view` é `idle`. Mostre uma espera, nunca `failed` nem o fluxo de início. |
| `view` | `idle`, `running`, `stale`, `done` ou `failed`. `done` continua `done` depois que o job sumiu (por exemplo, no reinício da central); um job que acabou antes da última fase é `failed`. `trailing` lista ids de fases finais (uma contagem para reiniciar, o `reboot`) que não seguram o `done`: com as outras prontas o `view` é `done` mesmo com a final rodando; uma fase que falhou, final ou não, continua `failed`. Assim o módulo não precisa de um `isInstalled` local. |
| `current` | `false` quando o estado é sobra de um job mais velho que o que o host conhece: mostre o fluxo de início, não a execução. |
| `state` | O `PhasesState` cru (`phases`, `startedAt`, `runStartedAt`, `failure`). |
| `status`, `lines`, `jobView`, `start`, `stop` | Os de `useJob`. |

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { CommandCtx, RunView, Sdk } from "@pvx/sdk";

// pvx-module.json: "permissions": { "exec": ["dnf"] }
export default (sdk: Sdk) => {
  const { h, Panel, Steps, ProgressBar, Notice, useRun, useKey } = sdk.ui;
  const BAR_STATE: Record<RunView, "running" | "failed" | "done"> = { idle: "running", running: "running", stale: "running", failed: "failed", done: "done" };

  function Instalador() {
    const run = useRun("instala", { trailing: ["reinicio"] });
    useKey("i", "instala", () => void run.start("instalar").catch(() => {}));
    return (
      <Panel>
        <Steps items={run.steps} />
        <ProgressBar value={run.progress} state={BAR_STATE[run.view]} />
        {run.state?.failure ? <Notice level="error">{`${run.state.failure.phase}: ${run.state.failure.message}`}</Notice> : null}
      </Panel>
    );
  }

  return {
    commands: {
      instalar: {
        help: "Instala em fases; rodar de novo retoma",
        async run(ctx: CommandCtx) {
          const result = await ctx.phases.run("instala", [
            {
              id: "pacotes",
              label: "pacotes",
              weight: 10,
              run: async (phase) => {
                phase.report("httpd");
                phase.progress(0.5);
                await ctx.shell.echoing({ timeoutMs: 40 * 60_000 }).must("dnf", ["-y", "install", "httpd"]);
                phase.progress(1);
              },
            },
            { id: "limpeza", label: "limpeza", run: () => ({ skipped: "nada a limpar" }) },
            { id: "reinicio", label: "reinício", run: () => {} },
          ]);
          if (!result.ok) ctx.out.error(`parou em ${result.failedPhase}`);
          const state = ctx.phases.state("instala");
          if (state) ctx.out.info(`andamento: ${Math.round(sdk.phases.progress(state) * 100)}%`);
        },
      },
    },
    pages: { instalador: { title: "Instalador", render: () => <Instalador /> } },
  };
};
```

## Saída de `dnf` e `apt`: `sdk.packages`

`sdk.packages.tracker("dnf" | "apt", progressSalvo?)` lê a saída de uma instalação linha a linha (passe cada linha do `onLine`) e mantém o andamento por pacote. `tracker.progress` é `{ total, done, running, failed }` (`done` e `running` trazem `name`, `version` e, no `dnf`, `arch`, `repo` e `size`; `running` traz também `phase`); `tracker.phase` diz a parte da transação da última linha (`download`, `install` ou `verify`; o `apt` não tem `verify`). `feed(linha)` devolve `true` quando algo que a página mostra mudou (grave o estado só então). Ao fim de cada execução do gerenciador, `endRun(ok)` fecha o que estava rodando (como feito, se `ok`; como falho, se não) e soma o total. `fail(nome)` marca um pacote que a saída não nomeou. A linha de barra de progresso (`\r`) só marca "baixando", nunca "feito". O `progress` é um objeto vivo, mudado no lugar: guarde `tracker.progress` no `store` para uma retomada (`tracker("dnf", salvo)`) e alimente um `CellGrid`.

<!-- test -->
```ts
import type { ModuleFactory } from "@pvx/sdk";

// pvx-module.json: "permissions": { "exec": ["dnf"] }
const factory: ModuleFactory = (sdk) => ({
  commands: {
    pacotes: {
      help: "Instala o httpd e guarda o andamento",
      async run(ctx) {
        const tracker = sdk.packages.tracker("dnf");
        const result = await ctx.shell.run("dnf", ["-y", "install", "httpd"], {
          timeoutMs: 40 * 60_000,
          buffer: false,
          onLine: (line) => {
            if (tracker.feed(line)) ctx.store.set("andamento", tracker.progress);
          },
        });
        tracker.endRun(result.code === 0);
        ctx.out.info(`${tracker.progress.done.length}/${tracker.progress.total} pacotes (${tracker.phase ?? "fim"})`);
      },
    },
  },
});
export default factory;
```

## Streaming e cancelamento de `ctx.exec`

- `onLine(linha, "stdout" | "stderr")` recebe cada linha assim que chega. O corte é em `\n`, `\r\n` e `\r` sozinho: a barra de progresso do `dnf`, que se redesenha com `\r`, chega como uma linha por redesenho.
- `signal` (um `AbortSignal`, tipado como `AbortSignalLike` porque o SDK não traz tipos de DOM) cancela: o host mata o **grupo de processos** (SIGTERM e, 2 s depois, SIGKILL), então os filhos do programa também caem. A chamada ainda resolve, com o código de saída. Sem `signal` o filho continua na sessão do pvx (o Ctrl+C da CLI o alcança).
- `buffer: false` deixa `stdout` e `stderr` do resultado vazios: use com `onLine` quando a saída é enorme.
- `timeoutMs` vale 30 s se omitido. **Comando longo precisa de `timeoutMs` explícito** (um instalador leva minutos); passado o prazo o processo morre.

## Jobs em segundo plano

Um job é um comando **do próprio módulo** que continua rodando depois que o pvx sai e depois que a SSH cai. `ctx.jobs` existe em todo comando; o `ReadCtx` só tem `status`, `list` e `log`. Jobs são um recurso do host: `permissions` não pede nada extra.

| API | O que faz |
| --- | --- |
| `jobs.start(nome, linha, { secrets? })` | Inicia `pvx <módulo> <linha>` num processo separado: `systemd-run --unit pvx-<módulo>-<nome> --collect` quando existe; senão, uma sessão própria (`setsid`) sem terminal e com todos os descritores em `/dev/null`. `nome` é `[a-z0-9-]+`. Falha com mensagem clara se o job já roda. A linha de comando e o log começam do zero a cada início. |
| `jobs.status(nome)` | `{ state: "running" \| "done" \| "failed" \| "stopped" \| "none", startedAt, endedAt?, exit?, pid? }`. Um job cujo processo morreu sem avisar aparece como `failed`. |
| `jobs.stop(nome)` | SIGTERM no grupo inteiro (o host também derruba os `ctx.exec` com `signal` do job), SIGKILL depois de 3 s; o estado vira `stopped`. |
| `jobs.list()` | Todos os jobs do módulo, com o mesmo formato de `status` mais `name`. |
| `jobs.log(nome, { tail?, since? })` | Linhas do log. `since` pula essa quantidade de linhas (pergunte só pelas novas); `tail` devolve só as últimas N. |

Estado e log ficam em `$PVX_HOME/modules/<id>/jobs/<nome>.json` e `<nome>.log`. O log recebe as linhas de `ctx.out` do comando do job (com o prefixo do nível: `✓`, `!`, `✗`, `i`; `plain` sem prefixo) e o que ele escreve com `ctx.jobLog(linha)` (fora de um job, `jobLog` não faz nada).

**Log do módulo.** Tudo que o job emite também vai para o log normal do módulo (`pvx logs <módulo>`, `pvx logs --all -f`, aba Logs), com o prefixo `[job <nome>]`: `ctx.out` (nível `error`/`warn`/`info` conforme o tipo), `ctx.jobLog` e a saída que o módulo repassa de `onLine`. Início, fim (`terminou`, `parado`, `falhou` com o exit) e o pedido de parada também entram, e início e parada entram no `core.log`. Para a barra de progresso do `dnf` não inundar o log, o log do módulo **pula uma linha info que só difere da anterior pelos dígitos** (`10%` depois de `55%`); o arquivo do job (`log`, `useJob().lines`) guarda tudo.\n\n**Segredos.** `secrets` (pelo nome do `ArgSpec`, como `{ senha: "..." }`) nunca vai por argv: o host grava um arquivo 0600 que o processo do job lê e **apaga antes de rodar o comando**; o comando os recebe pelo mecanismo normal de segredo (`ctx.args.senha`, via `PVX_SECRET_SENHA` só dentro do filho). O valor também é trocado por `***` se o comando o escrever no log. Nunca entra no estado, no log nem no `ps`.

**Root e auditoria.** Iniciar e parar exigem root, como qualquer comando que grava; ambos entram no `audit.jsonl` (`kind: "job"`). Não há jobs no Windows.

**CLI.** `pvx jobs [list]` lista todos; `pvx jobs log <módulo> <nome> [--tail N] [-f]` mostra (e com `-f` segue até o job acabar); `pvx jobs stop <módulo> <nome>` para. (`pvx jobs run` é interno: o host o usa para iniciar o job.)

**Na UI.** `useJob(nome, { tail?, staleMs? })` devolve `{ status, lines, view, loading, start(linha, { secrets? }), stop() }`, atualizado a cada 1 s (`loading` é `true` até a primeira leitura: `status` e `lines` ainda são provisórios); a página só renderiza de novo quando o estado, as últimas `tail` linhas (padrão 200) ou o `view` mudam. `view` é `idle`, `running`, `stale`, `done`, `failed` ou `stopped`: `stale` é um job que diz estar rodando mas não escreveu nada no log há `staleMs` (padrão 30 s, contados desde que a página começou a olhar): pinte o progresso como velho ("sem notícias há 30 s") em vez de mostrá-lo como vivo. `ui.Steps({ items })` desenha as fases (`{ id, label, state: "pending" | "running" | "done" | "failed" | "skipped", elapsedMs?, detail? }`): `✓` concluído, spinner rodando, `○` pendente, `✗` falhou, `-` pulado, sempre com a palavra do estado; o spinner só anda enquanto há um item rodando. `ui.LogTail({ lines, follow?, focused? })` é um log que rola: acompanha o fim até o usuário subir com a roda do mouse e volta a acompanhar ao chegar no fim; ele ocupa a altura que o pai der. Com `focused`, o teclado também rola: `↑`/`↓` uma linha, `pgup`/`pgdn` uma página, `home` o começo, `end` o fim (e volta a acompanhar). Sem `focused` as teclas ficam com a página.

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { CommandCtx, Sdk, StepItem } from "@pvx/sdk";

// pvx-module.json: "permissions": { "exec": ["dnf"] }
export default (sdk: Sdk) => {
  const { h, Panel, Steps, LogTail, useJob, useKey } = sdk.ui;
  const fases = ["pacotes", "banco"];

  function Instalador() {
    const job = useJob("instala");
    useKey("i", "instala", () => void job.start("instalar", { secrets: { senha: "gerada-no-form" } }).catch(() => {}));
    useKey("x", "para", () => void job.stop());
    const feitas = job.lines.filter((l) => l.startsWith("✓ ")).length;
    const items: StepItem[] = fases.map((f, i) => ({
      id: f, label: f, state: i < feitas ? "done" : i === feitas && job.status.state === "running" ? "running" : "pending",
    }));
    return (
      <Panel>
        <Steps items={items} />
        <LogTail lines={job.lines} />
      </Panel>
    );
  }

  return {
    commands: {
      instalar: {
        help: "Instala em segundo plano",
        args: [{ name: "senha", help: "Senha do banco", kind: "option", secret: true }],
        async run(ctx: CommandCtx) {
          for (const f of fases) {
            ctx.jobLog(`fase ${f}`);
            const r = await ctx.exec("dnf", ["-y", "install", f], { timeoutMs: 40 * 60_000, buffer: false, onLine: (l) => ctx.jobLog(l) });
            if (r.code !== 0) return ctx.out.error(`${f} falhou (${r.code})`);
            ctx.out.success(`${f} instalado`);
          }
        },
      },
    },
    pages: { instalador: { title: "Instalador", render: () => <Instalador /> } },
  };
};
```

## Componentes de fluxo: conversa, botão, progresso, grade, espera e cópia

Um instalador guiado, uma operação longa ou qualquer tela de várias etapas usa estes componentes em vez de desenhar o seu (`UI.md`, "Componentes do framework"). Todos respondem a teclado e a mouse e usam só tokens do tema.

- **`Conversation`**: perguntas uma de cada vez. `questions` é `{ id, title, field, summary?, skip? }[]`, e `field` é qualquer `FieldSpec` de `Fields` (`line`, `secret`, `choice`, `multi`, `toggle`, `area`; o `id` e o `label` do campo são ignorados: valem o `id` e o `title` da pergunta). `answers` é o estado do módulo (controlado): o fluxo chama `onAnswer(id, valor)` a cada resposta e lê os valores de volta, inclusive como valor inicial. A pergunta respondida vira `✓ título   resumo` (`summary(valor)`; sem ele: o rótulo da opção, `sim`/`não`, `●●●●●●●●` para `secret`); a próxima aparece como `○ título`. `↑` no topo da pergunta atual sobe para a lista de respondidas; `enter` (ou clique) numa linha a reabre no lugar, e depois de confirmar o fluxo volta para onde estava; `esc` cancela a reabertura. Depois da última pergunta vem a etapa de **confirmação**: todas as perguntas (as de `skip: true` entram aqui, marcadas "(padrão)" até serem editadas; o valor vem de `answers`), os seus `footerSummary` ("antes de instalar") e o botão principal (`confirmLabel`, padrão "confirmar"; `ctrl+enter` também confirma). `onConfirm(answers)` só roda daí: nada se aplica antes. `header` desenha algo acima das linhas; `onCancel` acrescenta `[ cancelar ]` e roda no `esc` do topo (sem ele, o `pop` da página). Precisa de uma página (acrescenta linhas ao rodapé).
- **`Button`**: `[ rótulo ]` clicável. `primary` usa o acento em negrito; `keys` (`enter`, `ctrl+enter`, `a`) registra a tecla na página, então o rodapé e o `?` a mostram; `focused` o desenha selecionado (para quem o alcança por teclado).
- **`ProgressBar`**: uma linha de `━` na largura toda, com `%` e tempos. `value` de 0 a 1; `startedAt` (ms) liga o tempo decorrido (atualiza a cada segundo) e, rodando, o `faltam ~` (de `etaMs`, a duração total esperada; sem ele, pelo ritmo até agora). `state="failed"` pinta de vermelho o trecho do ponto de parada, colado ao preenchido, e diz `falhou em`; `state="done"` enche a barra e diz `concluído em`.
- **`CellGrid`**: uma célula por item (`▪` feito, rodando e falhou, cada um no seu tom; `▫` pendente), quebrada na largura, com legenda das contagens. O mouse passa por cima (realça), clica (seleciona e chama `onPress(id)`); o teclado (setas, `enter`) vale enquanto a página tem o foco, ou com `focused`; na borda a seta fica com a página. O rótulo da célula selecionada ou sob o mouse aparece embaixo.
- **`Loading`** e **`useAsync(fn, deps)`**: toda leitura ou ação que passe de ~300 ms mostra `Loading` (spinner e texto). `useAsync` roda `fn` ao montar e quando `deps` mudam (ou em `run()`), e devolve `{ loading, data, error, run }`; o último `data` fica enquanto roda de novo, e só a chamada mais nova vale.
- **`useCopy()`**: `copy(texto, { title? })` copia pelo clipboard do host e do terminal (OSC 52), mostra por alguns segundos um painel com exatamente o que foi copiado e o aviso `✓ copiado`. Sem clipboard, diz `não copiou: <causa>`, mantém o painel (dá para selecionar com o mouse) e resolve `false`.

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { Question, Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Conversation, Text, Panel, useState, useCopy } = sdk.ui;
  const perguntas: Question[] = [
    { id: "versao", title: "Versão", field: { id: "versao", label: "", kind: "choice", options: [{ value: "18", label: "18", detail: "recomendado" }, { value: "16", label: "16" }] } },
    { id: "senha", title: "Senha", field: { id: "senha", label: "", kind: "secret", generate: "ctrl+g" } },
    // não é perguntada, mas aparece na confirmação como "(padrão)" e dá para editar lá
    { id: "extras", title: "Pacotes extras", skip: true, field: { id: "extras", label: "", kind: "multi", options: [{ value: "lic", label: "licenciados" }, { value: "bl", label: "blocklist" }] } },
  ];

  function Instalar() {
    const [respostas, setRespostas] = useState<Record<string, string | boolean>>({ extras: "lic,bl" });
    const copiar = useCopy();
    return (
      <Panel>
        <Conversation
          questions={perguntas}
          answers={respostas}
          onAnswer={(id, valor) => setRespostas((r) => ({ ...r, [id]: valor }))}
          confirmLabel="instalar"
          footerSummary={<Text tone="warn">a central reinicia ao terminar</Text>}
          onConfirm={(r) => void copiar(`pvx exemplo instalar --versao ${String(r.versao)}`, { title: "comando" })}
        />
      </Panel>
    );
  }

  return { pages: { instalar: { title: "Instalar", render: () => <Instalar /> } } };
};
```

<!-- test -->
```tsx
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { CellItem, Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, ProgressBar, CellGrid, Loading, Button, useAsync, useState, useNudge } = sdk.ui;

  function Andamento() {
    const nudge = useNudge();
    const [inicio] = useState(() => Date.now());
    const lista = useAsync(async () => ["a", "b", "c"], []); // leitura: mostra Loading enquanto não chega
    if (lista.loading && !lista.data) return <Loading label="lendo a lista…" />;
    const cells: CellItem[] = (lista.data ?? []).map((id, i) => ({ id, label: `pacote ${id}`, state: i === 0 ? "done" : i === 1 ? "running" : "pending" }));
    return (
      <>
        <ProgressBar value={1 / 3} startedAt={inicio} etaMs={20 * 60_000} />
        <CellGrid cells={cells} onPress={(id) => nudge(`pacote ${id}`)} focused />
        <Button label="atualizar" keys="r" onPress={() => void lista.run()} />
      </>
    );
  }

  return { pages: { andamento: { title: "Andamento", render: () => <Andamento /> } } };
};
```

## Segurança

**Isto não é um sandbox.** O módulo roda no mesmo processo do pvx, como root nas centrais. Nada impede um módulo de chamar `Bun.spawn`, `node:child_process`, `fetch` ou `node:fs` direto, e de contornar `ctx.*`. As permissões declarativas dão ao técnico uma lista honesta do que o módulo diz usar, e fazem o uso correto falhar alto quando passa do declarado. A barreira real é a revisão humana do commit.

**Modelo de confiança**

- Um módulo instalado por `modules add` só é importado depois de o técnico aprovar aquele commit, por padrão um a um (`modules trust <id> --sha <sha>`, ou `--trust` no `add`; veja "confiança sempre" abaixo). A aprovação fica em `PVX_HOME/trust.json` com o sha, quem aprovou e as permissões vistas.
- O módulo só carrega se `HEAD` for igual ao sha aprovado e a árvore git estiver limpa. Commit novo ou arquivo alterado: não carrega.
- `modules update` busca e lista os commits novos e as mudanças de permissões. Por padrão só avança com `--trust <sha do remoto>`; o avanço vai exatamente àquele commit (fast-forward). A exceção é a confiança sempre, descrita abaixo.
- **Confiança sempre** (`--always` junto de `--trust` ou `--sha`; tecla `T` na tela de revisão): os commits novos da mesma origem (a mesma URL) entram no `modules update` sem revisão. Continuam exigidos fast-forward, árvore limpa e manifest legível; cada aplicação automática fica no registro de auditoria. Revogue com `modules trust --revoke <id>`. A verificação em segundo plano da TUI só avisa, nunca aplica.
- **Módulos do catálogo** são confiados sempre: a instalação por id do catálogo, ou por uma URL igual à de uma entrada do catálogo, não abre a revisão, e as atualizações entram direto. Quem usa o catálogo confia em quem o publica.
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

`runCommand(moduleDir, linha, { env?, secrets?, confirmed?, sshClient?, isRoot? })` carrega **só** aquele módulo num `PVX_HOME` temporário novo, roda a linha (módulo primeiro, como na CLI) pelo `execute` do núcleo e devolve `{ ok, exit, lines }`. `secrets` entra como `PVX_SECRET_<NOME>`; `confirmed: true` equivale a `--yes`; `sshClient` é o `ctx.session.sshClient` do comando e `isRoot` o `ctx.isRoot` (padrão: o do processo real; `renderPage` e `runSession` assumem root).

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

`runSession(moduleDir)` carrega o módulo **uma vez** num `PVX_HOME` temporário e devolve `{ home, run(linha, { env?, secrets?, confirmed? }), renderPage(página, { cols, rows }) }`. Todas as chamadas dividem a mesma central: o que um `run` gravou no `store` está lá no próximo `run` e na página. `run` devolve `{ ok, exit, lines, text }` (`text` junta os textos das linhas). Use para sequências ("accept", depois "list") e para olhar a página depois de mudar o estado.

```ts
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { runSession, type TuiHarness } from "@pvx/testing";

let t: TuiHarness | undefined;
afterEach(() => t?.destroy());

test("sequência e página no mesmo estado", async () => {
  const s = await runSession(join(import.meta.dir, ".."));
  await s.run("meumodulo add item");
  expect((await s.run("meumodulo list")).text).toContain("item");
  t = await s.renderPage("contador");
  expect(t.frame()).toContain("item");
});
```

**Sistema falso para o teste de unidade.** Para testar um comando, uma prova ou uma consulta sem carregar o host, `@pvx/testing` traz o ponto de troca que todo módulo precisa: `fakeSystem({ rules?, files?, store?, netRules?, space?, sshClient?, clock?, isRoot? })` (`sshClient` vira o `ctx.session.sshClient` dos contextos; `clock: { now }` é a hora do sistema, que o `phases` usa e que o teste move mudando `now` (padrão: o relógio real); `isRoot` vira o `ctx.isRoot` (padrão `true`); um `exec` que grava as chamadas, transmite `lines` (stdout) e as linhas de `stderr` ao `onLine`, como o `exec` real (então entram no `tail` do `shell`), respeita `buffer: false` como o real (o resultado volta com `stdout` e `stderr` vazios, só o `onLine` vê as linhas: uma sonda que esquece `buffer: true` falha no teste como falharia na central) e responde pelas regras `(chamada) => { code?, stdout?, stderr?, lines? } | undefined`, um `fs` e um `store` em memória, e um `net`), `fakeCommandCtx(system, { args?, signal? })` (`signal` é o `ctx.signal`) (o `ctx` de um comando, com `shell`, `strategy` e `phases` reais sobre o sistema falso, `lines` com o que foi para `ctx.out` e `jobLines` com `ctx.jobLog`), `fakeReadCtx(system)` (o `ReadCtx` de provas e consultas, com `shell.run`/`shell.ok` e `strategy`) e `fakeSdk()` (o `sdk` de uma fábrica, com `proof`, `packages`, `strategy` e `errors` reais). O `fs` falso trata os `files` como uma árvore: uma pasta existe porque há um arquivo debaixo dela ou porque o `mkdir` a criou (`system.fs.dirs`). `list` e `entries` (com o tipo `file` ou `dir`) respondem sobre essa árvore e lançam `ENOENT` se a pasta não existe, como o real; `stat` dá `size` (bytes do texto), `isDir`, `mode` (`system.fs.modes`, padrão 0o644 e 0o755) e `mtimeMs` (`system.fs.mtimes`, padrão 0); `du` soma os bytes dos arquivos sob o caminho; `free` responde `system.fs.space` (`{ totalBytes, availableBytes }`, folgado por padrão: o teste muda `availableBytes` para simular o disco cheio); `remove` de uma pasta exige `recursive` e `/` é recusado. As permissões do manifest não são simuladas. O `net` falso responde pelas `netRules` `(chamada) => { status, body? } | undefined` (a `chamada` traz `url` e `init` de um `fetch`, ou `upload` de um `ctx.net.upload`), grava tudo em `system.netCalls` e, sem regra que responda, lança "rede indisponível no teste"; o `upload` falso exige que o arquivo exista no `fs` falso e nunca lê os bytes. O teste chama `comando.run(ctx)` e lê `system.lines()` (as linhas de comando rodadas), `system.fs.files` e `system.fs.modes` (o que foi gravado e com que modo) e `system.store.data`. Nada real roda e nada real é gravado.

```ts
import { expect, test } from "bun:test";
import { fakeCommandCtx, fakeSystem } from "@pvx/testing";
import { aplicar } from "../src/commands/aplicar.ts";

test("aplicar roda o nft e grava o marcador com modo 0600", async () => {
  const system = fakeSystem({ rules: [(call) => (call.cmd === "nft" ? { lines: ["nftables v1.0"] } : undefined)] });
  const ctx = fakeCommandCtx(system, { args: { engine: "nftables" } });
  await aplicar.run(ctx);
  expect(system.lines()[0]).toBe("nft --version");
  expect(system.fs.modes.get("/etc/meu-modulo/ultimo")).toBe(0o600);
});
```

**A fábrica real numa máquina falsa: `onFakeMachine(fábrica, system, { real? })`.** Para os testes que passam pelo host (`runSession`, `renderPage`) sem tocar a máquina, o módulo de teste (um diretório com `pvx-module.json`) exporta `onFakeMachine(fábrica, system)`: o loader importa a fábrica real como sempre, e todo comando, prova, consulta e widget recebe o `exec`, o `shell`, o `fs` e o `isRoot` do `FakeSystem` (o comando recebe também o `net`). `real(caminho)` devolve `true` para o que continua real (o diretório de estado do módulo, para o teste ler o que ele gravou). O teste importa o `system` do módulo de teste para armar regras e ler `system.lines()`, `system.fs.files` e `system.isRoot` (mude-o entre as chamadas).

```ts
// test/fixture/index.ts
import { fakeSystem, onFakeMachine } from "@pvx/testing";
import factory from "../../src/index.tsx";

export const system = fakeSystem({ rules: [(call) => (call.cmd === "dnf" ? { lines: ["Complete!"] } : undefined)], isRoot: true });
export default onFakeMachine(factory, system, { real: (caminho) => caminho.startsWith("/var/lib/meu-modulo/") });
```

Todas definem `PVX_HOME` e `PVX_USERMODULES` do processo: use um arquivo de teste por módulo, sem paralelismo dentro dele. Para uma consulta assíncrona, use `await t.waitForFrame((f) => f.includes("..."))`.

## Desenvolvimento

`modules link <pasta>` grava em `PVX_HOME` e por isso exige root, também na máquina de quem desenvolve: a regra é uid 0, sem atalho por variável de ambiente. Para desenvolver num Mac ou numa VM, aponte `PVX_HOME` para uma pasta sua e rode com `sudo -E`, que mantém a variável:

```sh
export PVX_HOME=$HOME/.pvx-dev
sudo -E pvx modules link ~/src/meu-modulo
sudo -E pvx meumodulo status
```

No repositório do pvx há um atalho sem root: `bun run dev:link ../meu-modulo` registra a pasta em `.dev/pvx` (o `PVX_HOME` do `bun dev`), valida o `pvx-module.json` e imprime id e caminho; depois rode `bun dev`. Sem argumento, `bun run dev:link` lista os módulos linkados; `bun run dev:unlink <id>` remove o link. É um script do repositório: o binário continua exigindo root e não tem atalho.

Para testes use `@pvx/testing` (`runSession`), que não precisa de root. `renderPage` e `runSession` aceitam `sshClient` e `isRoot`, e valem também para os comandos que a página roda.

## O que um módulo nunca faz

- Importar React, `@opentui/*` ou qualquer pacote: só `import type` do `@pvx/sdk` e imports relativos do próprio módulo (dependências vão empacotadas dentro dele).
- Trabalhar na fábrica (I/O, rede, exec, estado).
- Chamar `process.exit`, escrever em `stdout`/`stderr` direto ou pedir dados de forma bloqueante: sempre `ctx.out`, e falta de dado é exit 2 com a mensagem do que passar.
- Receber segredo por argumento, ou guardar segredo em log, estado, saída ou erro.
- Escrever em `prove()`, em consulta ou em `data()`: é somente leitura (o `ReadCtx` nem tem `store.set` nem `fs.write`), e o `exec` ali só roda sondas.
- Ler ou gravar o estado de outro módulo: só pelas consultas dele (`ctx.query`).
- Escrever em `PVX_HOME`, fora do `store` e do `log` que o host entrega.
- Escrever cor hex ou escapes ANSI em texto de UI: use tons e `Text`. O `<text>` mostra escapes literalmente.
- Depender de TTY: tudo que a TUI faz existe como comando na CLI.
- Chamar comando de outro módulo a partir de uma página: a página só roda comandos do próprio módulo.
