/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import type { CommandCtx, Sdk } from "@pvx/sdk";

export default (sdk: Sdk) => {
  const { h, Panel, Text, useRef, useJob, useKey, useQuery } = sdk.ui;
  let ticks = 0;

  function Queries() {
    const renders = useRef(0);
    renders.current++;
    const tick = useQuery<number>("hooks-demo.tick", [], { refreshMs: 10 }); // clamped to 500
    const same = useQuery<number>("hooks-demo.same", [], { refreshMs: 500 });
    return (
      <Panel title="queries">
        <Text>{`tick=${tick.data ?? "-"} same=${same.data ?? "-"}`}</Text>
        <Text>{`renders=${renders.current}`}</Text>
      </Panel>
    );
  }

  function JobView() {
    const renders = useRef(0);
    renders.current++;
    const job = useJob("j", { tail: 3 });
    useKey("s", "inicia", () => void job.start("work").catch((e) => void console.error(e)));
    useKey("x", "para", () => void job.stop());
    return (
      <Panel title="job">
        <Text>{`job=${job.status.state} exit=${job.status.exit ?? "-"}`}</Text>
        <Text>{`lines=${job.lines.join("|")}`}</Text>
        <Text>{`renders=${renders.current}`}</Text>
      </Panel>
    );
  }

  return {
    commands: {
      work: {
        help: "Writes lines",
        run: async (ctx: CommandCtx) => {
          for (const n of [1, 2, 3, 4]) ctx.out.info(`l${n}`);
          if (ctx.args.hold) await new Promise((r) => setTimeout(r, 60_000));
        },
      },
    },
    queries: { "hooks-demo.tick": () => ++ticks, "hooks-demo.same": () => 7 },
    pages: { queries: { title: "Consultas", render: () => <Queries /> }, job: { title: "Job", render: () => <JobView /> } },
  };
};
