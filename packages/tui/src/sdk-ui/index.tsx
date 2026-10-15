import { createElement, Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { SdkUi } from "@pvx/sdk";
import { hooks } from "./host.tsx";
import { Chip, KeyHint, List, LogTail, Notice, Panel, Row, Scroll, Spacer, Steps, Table, Text } from "./kit.tsx";
import { Badge, Details, Meter, Spark } from "./display.tsx";
import { Button } from "./button.tsx";
import { Fields } from "./fields.tsx";
import { Form } from "./pages.tsx";
import { CellGrid, Conversation, Loading, ProgressBar, useAsync } from "./flow.tsx";
import { CopyBlock, useCopy } from "./copy.tsx";
import { RunPanel } from "./run-panel.tsx";

/** `sdk.ui`: the one React copy of the process, handed to modules so they never import it. */
export const ui: SdkUi = {
  h: createElement as unknown as SdkUi["h"],
  Fragment,
  useState, useEffect, useMemo, useRef,
  Panel, Row, Text, Chip, Meter, Spark, Badge, Details, CopyBlock, Scroll, KeyHint, Table, List, Form, Spacer, Steps, LogTail, Notice, Fields,
  Conversation, Button, ProgressBar, CellGrid, Loading, useAsync, useCopy, RunPanel,
  ...hooks,
};
export { PageHost, PagePane, pageScope, pageScreen } from "./pages.tsx";
export { PagesCtx, type PageDeps } from "./host.tsx";
