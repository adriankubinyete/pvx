import { clean } from "../palette/search.ts";
import { useTheme } from "../theme-context.tsx";

/** The dim line above a screen that stacks on a tab (`módulos › adicionar`): where the technician is, without a box. */
export function Crumb({ parts }: { parts: string[] }) {
  const { c, g } = useTheme();
  return <text fg={c.dim} wrapMode="none" flexShrink={0}>{parts.map(clean).join(` ${g.query} `)}</text>;
}
