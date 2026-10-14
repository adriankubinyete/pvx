/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
// The page entry. Only `sdk.ui`: no React import.
import type { Sdk } from "@pvx/sdk";
import { makePainel } from "./Painel.tsx";

export function page(sdk: Sdk) {
  const { h } = sdk.ui;
  const Painel = makePainel(sdk.ui);
  return () => <Painel />;
}
