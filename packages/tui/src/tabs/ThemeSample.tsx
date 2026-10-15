import type { TuiState } from "@pvx/core";
import { Badge, Meter } from "../sdk-ui/display.tsx";
import { Button } from "../sdk-ui/button.tsx";
import { List, Notice, Steps } from "../sdk-ui/kit.tsx";
import { ThemePreview, useTheme } from "../theme-context.tsx";

/** From this many terminal columns the sample sits beside the options, with about 40% of the width. */
export const BESIDE_COLS = 120;
const BESIDE_SHARE = 0.36;
const MIN_SAMPLE_W = 36;
const FIELD_W = 14;

/** Cells the sample takes beside the options of a page `width` wide. */
export const sampleWidth = (width: number): number => Math.max(MIN_SAMPLE_W, Math.floor(width * BESIDE_SHARE));

function noop() {}

/** The real primitives in the theme being previewed (the section headers are drawn as lines: a `Panel` inside a `Panel` would nest gutters): a section header active and inactive, a selected row, a notice of each tone, two buttons, a field, a badge, a meter and a done step. */
function Sample() {
  const { c, g } = useTheme();
  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={c.bg} paddingX={1}>
      <text wrapMode="none" fg={c.dim} flexShrink={0}>prévia</text>
      <text wrapMode="none" flexShrink={0}><span fg={c.accent}>{`${g.gutter} `}</span><span fg={c.accent}><b>1 Seção ativa</b></span></text>
      <text wrapMode="none" flexShrink={0} fg={c.dim}>{"  2 Seção inativa"}</text>
      <List items={[{ id: "a", label: "linha selecionada", detail: "ok" }, { id: "b", label: "outra linha", detail: "ok" }]} selected="a" />
      <text wrapMode="none" flexShrink={0}> </text>
      <Notice level="ok">aplicado</Notice>
      <Notice level="warn">revise isto</Notice>
      <Notice level="error">falhou</Notice>
      <Notice level="info">para saber mais</Notice>
      <text wrapMode="none" flexShrink={0}> </text>
      <box flexDirection="row" columnGap={2} flexShrink={0}>
        <Button label="em foco" primary focused onPress={noop} />
        <Button label="sem foco" focused={false} onPress={noop} />
      </box>
      <text wrapMode="none" flexShrink={0} bg={c.panel} fg={c.text}>{" valor".padEnd(FIELD_W)}</text>
      <box flexDirection="row" columnGap={2} flexShrink={0}>
        <Badge label="ativo" tone="ok" />
        <Meter value={0.6} width={10} />
      </box>
      <Steps items={[{ id: "done", label: "etapa", state: "done" }]} />
    </box>
  );
}

/** The sample under `patch`: what the theme would look like if the hovered or cursor option were chosen. */
export function ThemeSample({ patch }: { patch: Partial<TuiState> }) {
  return (
    <ThemePreview patch={patch}>
      <Sample />
    </ThemePreview>
  );
}
