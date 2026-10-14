import { createElement, Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { SdkUi } from "@pvx/sdk";
import { hooks } from "./host.tsx";
import { Chip, KeyHint, List, LogTail, Meter, Panel, Row, Spacer, Steps, Table, Text } from "./kit.tsx";
import { Fields } from "./fields.tsx";
import { Form } from "./pages.tsx";
import { Button, CellGrid, Conversation, Loading, ProgressBar, useAsync } from "./flow.tsx";
import { useCopy } from "./copy.tsx";

/** `sdk.ui`: the one React copy of the process, handed to modules so they never import it. */
export const ui: SdkUi = {
  h: createElement as unknown as SdkUi["h"],
  Fragment,
  useState, useEffect, useMemo, useRef,
  Panel, Row, Text, Chip, Meter, KeyHint, Table, List, Form, Spacer, Steps, LogTail, Fields,
  Conversation, Button, ProgressBar, CellGrid, Loading, useAsync, useCopy,
  ...hooks,
};
export { PageHost, PagePane, pageScope, pageScreen } from "./pages.tsx";
export { PagesCtx, type PageDeps } from "./host.tsx";
