/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// Sem imports de React nem do host: tudo vem do `sdk.ui` injetado. Só `import type` do SDK.
import type { ModuleFactory, ReadCtx } from "@pvx/sdk";

const NOME_PADRAO = "mundo";

const factory: ModuleFactory = (sdk) => {
  // A fábrica só monta o objeto do módulo: nada de I/O, rede ou exec aqui.
  const { h, Panel, Text, KeyHint, useStore, useState, useKey } = sdk.ui;

  /** Um passo da prova: devolve o problema, ou nada quando está tudo certo. */
  const semSaudacao = ({ store }: ReadCtx) => (store.get("nome") ? undefined : sdk.proof.warn("ninguém foi saudado ainda"));

  function Painel() {
    const store = useStore();
    const [nome, setNome] = useState(() => store.get<string>("nome"));
    // `useKey` roda no render: o handler enxerga o estado do componente.
    useKey("s", "saúda o mundo", () => {
      store.set("nome", NOME_PADRAO);
      setNome(NOME_PADRAO);
    });
    return (
      <Panel title="exemplo">
        <Text tone={nome ? "ok" : "dim"}>{nome ? `olá, ${nome}` : "ninguém foi saudado"}</Text>
        <KeyHint keys="s" label="saúda o mundo" />
      </Panel>
    );
  }

  return {
    commands: {
      saudar: {
        help: "Saúda alguém e guarda o nome",
        args: [{ name: "nome", help: "Quem saudar", kind: "positional" }],
        run(ctx) {
          const nome = ctx.arg("nome") ?? NOME_PADRAO;
          ctx.store.set("nome", nome);
          ctx.out.success(`olá, ${nome}`);
        },
      },
    },
    capabilities: [
      {
        id: "exemplo.saudacao",
        title: "Alguém foi saudado",
        goal: "O módulo já guardou um nome",
        fix: "exemplo saudar",
        prove: async (ctx) => (await sdk.proof.firstProblem(() => semSaudacao(ctx))) ?? sdk.proof.ok("saudação feita"),
      },
    ],
    pages: {
      painel: { title: "Exemplo", render: () => <Painel /> },
    },
  };
};
export default factory;
