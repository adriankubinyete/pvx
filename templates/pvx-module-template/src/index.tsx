/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// Sem imports de React nem do host: tudo vem do `sdk.ui` injetado. Só `import type` do SDK.
import type { ModuleFactory } from "@pvx/sdk";

const factory: ModuleFactory = (sdk) => {
  // A fábrica só monta o objeto do módulo: nada de I/O, rede ou exec aqui.
  const { h, Panel, Text, KeyHint, useStore, useState } = sdk.ui;

  // `run()` de uma tecla não enxerga o estado do componente: a página entrega o setter por esta variável.
  let saudar: (() => void) | undefined;
  function Painel() {
    const store = useStore();
    const [nome, setNome] = useState(() => store.get<string>("nome"));
    saudar = () => {
      store.set("nome", "mundo");
      setNome("mundo");
    };
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
          const nome = typeof ctx.args.nome === "string" ? ctx.args.nome : "mundo";
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
        prove: ({ store }) =>
          store.get("nome") ? { level: "ok", text: "saudação feita" } : { level: "warn", text: "ninguém foi saudado ainda" },
      },
    ],
    pages: {
      painel: { title: "Exemplo", render: () => <Painel />, keys: [{ keys: "s", label: "saúda o mundo", run: () => saudar?.() }] },
    },
  };
};
export default factory;
