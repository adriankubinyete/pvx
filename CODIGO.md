# Padrão de código do pvx

Este arquivo é a norma de código legível para o pvx e para os módulos. Leia antes de escrever ou revisar código. A interface tem a sua norma em `UI.md`; o contrato dos módulos está em `packages/sdk/README.md`.

## 1. Princípio

Código se lê muito mais do que se escreve. Quem lê deve entender **o que** acontece sem decifrar **como**. O corpo de alto nível se lê como uma lista de passos com nome; o detalhe mora em funções curtas abaixo dele.

## 2. Padrões

### Funções curtas, com nome de intenção

Uma função faz uma coisa, e o nome diz qual (`validateEngineName`, `saveEngineSetting`, `reportChosenEngine`).

```ts
// antes: o comando valida, grava e responde numa tacada
async run(ctx) {
  const name = str(ctx, "name");
  if (name && !(SETTINGS as readonly string[]).includes(name)) return ctx.out.error(`engine inválido: ${name} (use ${SETTINGS.join(", ")})`);
  if (name) ctx.store.set("engine", name);
  if (str(ctx, "zone")) ctx.store.set("zone", str(ctx, "zone"));
  const set = ctx.store.get<EngineSetting>("engine") ?? "auto";
  const picked = await pickEngine(ctx.exec, set);
  ctx.out.success(`engine: ${set}${"engine" in picked ? ` -> ${picked.engine.id}` : ` (${picked.error})`}`);
}

// depois: o corpo é uma lista de passos
async run(ctx) {
  const name = ctx.arg("name");
  if (name && !isEngineSetting(name)) {
    ctx.out.error(invalidEngineMessage(name));
    return;
  }
  if (name) saveEngineSetting(ctx.store, name);
  saveZone(ctx.store, ctx.option("zone"));
  await reportChosenEngine(ctx);
}
```

### Um nível de abstração por função

Não misture "decidir o que fazer" com "mexer em bytes". A função de cima chama; a de baixo faz.

### Tabelas em vez de ternário com 3 ramos ou mais

```ts
// antes
const mark = level === "ok" ? "✓" : level === "warn" ? "▲" : "✗";

// depois
const MARK_BY_LEVEL: Record<Level, string> = { ok: "✓", warn: "▲", error: "✗" };
const mark = MARK_BY_LEVEL[level];
```

### Retorno antecipado escrito às claras

```ts
// antes: o return esconde que a função devolve void
if (!hit.length) return ctx.out.warning(`${v} não estava em nenhuma lista`);

// depois
if (!hit.length) {
  ctx.out.warning(`${value} não estava em nenhuma lista`);
  return;
}
```

### Nomes inteiros

`state`, `answers`, `question`; nunca `s`, `a`, `q`. Letra só em índice de laço trivial (`i`). Exceção do projeto: `c` e `g` de `useTheme()`.

### Constantes com nome

Número e texto que têm significado ganham nome: `ROLLBACK_SECONDS`, `PREVIEW_MS`, `CONFIRM_STOP`.

### Um tipo por formato persistido

O que vai para o `store` tem um `interface` só, importado onde se usa; nunca um objeto escrito em linha em vários lugares.

```ts
// antes: o mesmo formato escrito por extenso em cada leitura
const last = store.get<{ at: string; engine: string; key: string; rules: number; failsafe?: string }>("lastApply");

// depois
interface LastApply { at: string; engine: string; key: string; rules: number; failsafe?: string }
const last = store.get<LastApply>("lastApply");
```

### Capacidades por `sdk.proof.firstProblem`, com passos nomeados

```ts
// antes: uma cadeia de ifs, cada um montando o objeto à mão
if (s.pend.state === "pending") return { level: "warn", text: `aplicação aguardando confirmação (${s.pend.left}s)`, fix: "firewall confirm" };
if (s.pend.state === "reverted") return { level: "error", text: "a última aplicação foi revertida automaticamente", fix: "firewall apply" };
if (!s.last) return { level: "warn", text: "o firewall nunca foi aplicado por este módulo", fix: "firewall apply" };
// ...

// depois: cada passo devolve um problema ou nada
const proveActive = async (ctx: ReadCtx) =>
  (await sdk.proof.firstProblem(
    () => pendingConfirmation(ctx),
    () => neverApplied(ctx),
    () => listsChangedSinceApply(ctx),
    () => rulesMissingFromEngine(ctx),
    () => bootNotEnabled(ctx),
  )) ?? sdk.proof.ok("regras aplicadas e conferidas com as listas");

const neverApplied = async (ctx: ReadCtx) => {
  const { last } = await summary(ctx);
  if (!last) return sdk.proof.warn("o firewall nunca foi aplicado por este módulo", { fix: "firewall apply" });
};
```

### Argumentos por `ctx.arg`, `ctx.flag`, `ctx.option` e `ctx.list`

```ts
// antes: cada módulo reinventa o leitor
const str = (ctx: CommandCtx, name: string) => (typeof ctx.args[name] === "string" ? (ctx.args[name] as string) : undefined);
const raw = str(ctx, "value") ?? "";

// depois
const rawValue = ctx.arg("value") ?? "";
```

### Lógica pura separada de efeito

Decidir (parsear, comparar, formatar) é função pura, testável sem `exec`, `fs` nem `store`. O efeito fica numa camada fina que chama a lógica.

```ts
// antes: remover mistura normalizar, mexer no estado, gravar e falar
run(ctx) {
  const st = load(ctx.store);
  const raw = str(ctx, "value") ?? "";
  const v = norm(a, raw) ?? raw;
  const hit = removeEntry(st, [a, b], v);
  if (!hit.length) return ctx.out.warning(`${v} não estava em nenhuma lista`);
  ctx.store.set("state", st);
  ctx.out.success(`removido: ${v}`);
  ctx.out.info(NEEDS_APPLY);
}

// depois: passos com nome, a lógica pura em removeFromLists
run(ctx) {
  const state = load(ctx.store);
  const value = normalizedValue(listA, ctx.arg("value") ?? "");
  const removed = removeFromLists(state, [listA, listB], value);
  if (!removed.length) {
    ctx.out.warning(`${value} não estava em nenhuma lista`);
    return;
  }
  saveState(ctx.store, state);
  reportRemoved(ctx, value);
}
```

### Um arquivo por assunto

O `index.tsx` de um módulo só liga as peças (comandos, capacidades, páginas); cada assunto (estado, engines, regras, telas) tem o seu arquivo.

## Estrutura de um módulo

Todo módulo novo segue o layout do `pvx-firewall` (a implementação de referência; leia o repositório dele) e do `templates/pvx-module-template/` (a versão mínima, para copiar). Um assunto, um arquivo; cada peça tem um lugar fixo.

```
src/
  index.tsx            só liga as peças
  state.ts             tipos persistidos + STORE_KEY
  texts.ts             textos do usuário + FIX.*
  exec.ts              helpers de ctx.exec, com constantes nomeadas
  <dominio>.ts         módulos de domínio puros, na raiz de src/
  commands/<assunto>.ts
  health/{prove,summary,queries,widgets}.ts
  page/                um componente por arquivo + helpers puros
test/                  stubs, helpers compartilhados, fake.ts
```

- `src/index.tsx`: só monta o objeto do módulo com o que vem dos outros arquivos. Quem abre o módulo vê o mapa inteiro em 15 linhas, e nenhum efeito roda na fábrica.
- `src/commands/<assunto>.ts`: um arquivo por assunto, cada comando como passos com nome (seção 2). Um arquivo por assunto deixa achar e revisar um comando sem ler os outros.
- `src/health/prove.ts`: as capacidades, cada prova por `sdk.proof.firstProblem` com passos nomeados. A lista de passos é a lista de problemas que o módulo sabe achar.
- `src/health/summary.ts`, `queries.ts`, `widgets.ts`: a leitura do estado real (uma só, reaproveitada), as consultas e os widgets. A leitura mora num lugar para prova, consulta e widget não divergirem.
- `src/state.ts`: os tipos persistidos (um por formato) e a tabela `STORE_KEY`. É o único lugar que diz o que o módulo grava.
- `src/texts.ts`: os textos do usuário e os comandos de correção `FIX.*`. Mudar a voz ou um comando de correção é editar um arquivo, e o UI.md e o teste de texto olham um lugar só.
- `src/exec.ts`: helpers de `ctx.exec`, com constantes nomeadas para programa, argumentos e tempo-limite. Todo processo passa por aqui, então a revisão de confiança e os stubs dos testes enxergam um ponto só.
- Módulos de domínio puros, na raiz de `src/` (parse, regras, cálculo): sem `exec`, `fs` nem `store`. Testam-se sem stub (seção 2, lógica pura).
- `src/page/`: um componente pequeno por arquivo, cada um uma fábrica sobre `sdk.ui` (`makeX(ui)`), mais helpers puros: `layout.ts` (tamanhos), `rows.ts` (dados para linhas), `outcome.ts` (resultado de comando para aviso) e `commands.ts` (os `useCommand` da página). Componente pequeno cabe numa tela de leitura, e o helper puro testa-se sem renderizar.
- `test/`: stubs legíveis, um por programa externo e comentado (o que ele finge e por quê), helpers compartilhados (como `withSshSession`) e `fake.ts` com `fakeSdk`. O teste lê como um roteiro e nunca toca a máquina.

## 3. Comentários

Explique o **porquê** ou uma restrição que não se vê no código. Nunca repita o que o código já diz.

```ts
// ruim: i++ // soma um
// bom: o registro diz "aplicado"; só o engine sabe se as regras ainda estão carregadas (um flush externo deixa o registro intacto)
```

## 4. Evitar

- **Uma linha que faz tudo** (encadeado de `?.`, `&&`, ternários e vírgulas): o leitor tem de executá-la de cabeça. Quebre em passos nomeados.
- **Regex sem nome**: `/^(?:◆|◇|dev) (\S+)/` ninguém lê. Ponha numa função (`cardNameOf(line)`) ou numa constante com comentário do que casa.
- **Truque de bits ou de coerção sem helper**: `!!x`, `~~n`, `a | 0`. Escreva `Boolean(x)`, `Math.trunc(n)`.
- **`as never`, `as any` e casts que escondem o tipo**: o compilador deixa de ajudar. Corrija o tipo ou escreva uma função que valide.
- **Código morto e import sem uso**: confunde e apodrece. `bunx tsc --noEmit --noUnusedLocals` tem de passar.
- **`return ctx.out.x()` como atalho de saída**: parece que a função devolve valor. Chame, depois `return;`.
- **Ternário encadeado**: use `Record` ou `if`.

## 5. Genérico vai para o framework

Se outro módulo poderia usar (validação, leitura de argumento, parsing, formatação, padrão de UI, montagem de prova), a peça pertence ao SDK ou ao framework e é documentada no `UI.md` ou no README do SDK. O módulo não a mantém.

## 6. Revisão

1. Depois de escrever, rode `/simplify` no diff.
2. Fique só com as mudanças dele que **também** seguem este arquivo. Quando "mais curto" e "mais legível" brigam, vence a legibilidade: nunca comprima passos nomeados de volta em uma linha.
3. Pergunte: algo aqui serviria a outro módulo? (validação, parsing, formatação, padrão de UI, leitura de argumento, montagem de prova…) Então delegue ao SDK/framework em vez de manter no módulo, e documente.

### Checklist

- [ ] O corpo de cada função de alto nível se lê como uma lista de passos?
- [ ] Cada função faz uma coisa, e o nome diz qual?
- [ ] Não há ternário de 3 ramos ou mais, nem linha que faz tudo?
- [ ] Nenhum `return ctx.out.x()` e nenhum nome de uma letra (fora índice de laço e `c`/`g`)?
- [ ] Números e textos com significado têm nome, e cada formato persistido tem um tipo só?
- [ ] A lógica pura está separada dos efeitos (`exec`, `fs`, `store`)?
- [ ] Os comentários dizem o porquê, e não há código morto, import sem uso nem cast que esconda tipo?
- [ ] Algo aqui serviria a outro módulo? Se sim, está no SDK/framework e documentado?
