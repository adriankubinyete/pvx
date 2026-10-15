/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { CommandCtx, Sdk } from "@pvx/sdk";

// Pages for the layout tests: sections without boxes, the standard form, a page action the arrows reach, the confirm dialog, a button nobody can reach.
export default (sdk: Sdk) => {
  const { h, Panel, Text, List, Form, Fields, Button, useState, useKey, useConfirm } = sdk.ui;

  const ROWS = [
    { id: "daily", label: "diaria" },
    { id: "weekly", label: "semanal" },
    { id: "run", label: "▶ rodar agora" },
  ];

  /** Two sections; the arrows walk the first one, whose last row is the page action. */
  function Sections() {
    const [selected, setSelected] = useState("daily");
    const [message, setMessage] = useState("nada rodou");
    const index = ROWS.findIndex((row) => row.id === selected);
    useKey("↓", "desce", () => setSelected(ROWS[Math.min(ROWS.length - 1, index + 1)]!.id));
    useKey("↑", "sobe", () => setSelected(ROWS[Math.max(0, index - 1)]!.id));
    return (
      <Panel>
        <Panel title="[1] rotinas" tone="accent">
          <List items={ROWS} selected={selected} onAction={(id) => setMessage(id === "run" ? "rodando agora" : `abriu ${id}`)} />
        </Panel>
        <Panel title="[2] autenticação">
          <Text tone="dim">token válido</Text>
        </Panel>
        <Text>{message}</Text>
      </Panel>
    );
  }

  /** The command form, as the owner's autobackup page uses it. */
  function Register() {
    const [message, setMessage] = useState("");
    return (
      <Panel>
        <Form command="layout-demo register" title="Criar o usuário" submitLabel="criar e entrar" onRun={() => setMessage("rodou")} onCancel={() => setMessage("cancelou")} />
        <Text>{message}</Text>
      </Panel>
    );
  }

  /** Fields with a derived field and a delete. */
  function Folder() {
    const [message, setMessage] = useState("");
    return (
      <Panel>
        <Fields
          title="Pasta do cliente"
          description="Onde os backups ficam no UOE"
          fields={[
            { id: "cliente", label: "ID do cliente", kind: "line", required: true },
            { id: "empresa", label: "Empresa", kind: "line", required: true },
            { id: "pasta", label: "Pasta no UOE", kind: "line", derive: (values) => `clientes/${values.cliente}-${values.empresa}` },
          ]}
          onSubmit={(values) => setMessage(`salvou ${values.pasta}`)}
          onCancel={() => setMessage("cancelou")}
          onDelete={() => setMessage("removeu")}
          deleteConfirm={{ title: "Remover o cliente?", description: "Os backups ficam no UOE.", confirmLabel: "remover cliente", cancelLabel: "manter" }}
        />
        <Text>{message}</Text>
      </Panel>
    );
  }

  /** More fields than a short terminal shows: the area scrolls. */
  function Long() {
    return (
      <Panel>
        <Fields
          title="Muitos campos"
          fields={Array.from({ length: 12 }, (_, i) => ({ id: `f${i + 1}`, label: `Campo ${i + 1}`, kind: "line" as const }))}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      </Panel>
    );
  }

  /** `x` asks; the answer shows on the page. */
  function Ask() {
    const confirm = useConfirm();
    const [message, setMessage] = useState("sem resposta");
    useKey("x", "pergunta", () => void confirm({ title: "Remover o IP 10.0.0.1?", description: "A regra deixa de valer agora.", confirmLabel: "remover IP", cancelLabel: "manter", destructive: true }).then((yes) => setMessage(yes ? "confirmou" : "manteve")));
    return (
      <Panel>
        <Text>{message}</Text>
      </Panel>
    );
  }

  /** A page button nobody can reach with the keyboard, and one with a key. */
  function Buttons({ keyed }: { keyed: boolean }) {
    return (
      <Panel>
        <Button label="rodar agora" primary keys={keyed ? "r" : undefined} onPress={() => {}} />
      </Panel>
    );
  }

  return {
    commands: {
      register: {
        help: "Cria o usuário no UOE",
        title: "Criar o usuário",
        args: [
          { name: "username", label: "Usuário", help: "Nome do novo usuário", kind: "positional", required: true },
          { name: "password", label: "Senha", help: "Senha do novo usuário (stdin, PVX_SECRET_PASSWORD ou prompt)", kind: "positional", secret: true, required: true },
          { name: "root-path", help: "Pasta raiz", kind: "option" },
          { name: "id-cliente", label: "ID do cliente", help: "letras, números e hífen", kind: "option" },
        ],
        run: (ctx: CommandCtx) => ctx.out.success("criado"),
      },
    },
    pages: {
      sections: { title: "Rotinas", render: () => <Sections />, tab: { label: "Rotinas", order: 1 } },
      register: { title: "Registrar", render: () => <Register /> },
      folder: { title: "Pasta", render: () => <Folder /> },
      long: { title: "Longa", render: () => <Long /> },
      ask: { title: "Pergunta", render: () => <Ask /> },
      orphan: { title: "Órfão", render: () => <Buttons keyed={false} /> },
      keyed: { title: "Com tecla", render: () => <Buttons keyed /> },
    },
  };
};
