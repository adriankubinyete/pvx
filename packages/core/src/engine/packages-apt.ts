// Reads the output of `apt-get install` (and `apt install`) line by line.
import { type LineReader, dropRunning, markDone, markFailed, setRunning } from "./packages-state.ts";

const SUMMARY_LINE = /^(\d+) upgraded, (\d+) newly installed/;
/** `Get:3 http://deb.debian.org/debian bookworm/main amd64 curl amd64 7.88.1-10 [315 kB]` -> name, version, size. */
const GET_LINE = /^Get:\d+ \S+ \S+ \S+ (\S+) \S+ (\S+) \[([\d.]+ ?\S+)\]/;
const FETCHED_LINE = /^Fetched \d/;
const UNPACKING_LINE = /^Unpacking (\S+) \((\S+)\)/;
const SETTING_UP_LINE = /^Setting up (\S+) \((\S+)\)/;
const FAILURE_PATTERNS = [/^E: Unable to locate package (\S+)/, /^E: Package '(\S+)' has no installation candidate/, /^dpkg: error processing package (\S+)/];

/** `libc6:amd64` -> `libc6`. */
const bareName = (name: string) => name.split(":")[0]!;

const readSummary: LineReader = (state, line) => {
  const match = SUMMARY_LINE.exec(line);
  if (!match) return false;
  state.current += Number(match[1]) + Number(match[2]);
  return true;
};

const readGet: LineReader = (state, line) => {
  const match = GET_LINE.exec(line);
  if (!match) return false;
  state.phase = "download";
  for (const pkg of state.progress.running.filter((running) => running.phase === "download")) dropRunning(state, pkg.name);
  setRunning(state, { name: bareName(match[1]!), version: match[2]!, size: match[3] }, "download");
  return true;
};

const readFetched: LineReader = (state, line) => {
  if (!FETCHED_LINE.test(line)) return false;
  for (const pkg of state.progress.running.filter((running) => running.phase === "download")) dropRunning(state, pkg.name);
  return true;
};

const readUnpacking: LineReader = (state, line) => {
  const match = UNPACKING_LINE.exec(line);
  if (!match) return false;
  state.phase = "install";
  setRunning(state, { name: bareName(match[1]!), version: match[2]! }, "install");
  return true;
};

/** `Setting up` is the last thing apt does to a package: it is done. */
const readSettingUp: LineReader = (state, line) => {
  const match = SETTING_UP_LINE.exec(line);
  if (!match) return false;
  state.phase = "install";
  markDone(state, { name: bareName(match[1]!), version: match[2]! });
  return true;
};

const readFailure: LineReader = (state, line) => {
  for (const pattern of FAILURE_PATTERNS) {
    const name = pattern.exec(line)?.[1];
    if (!name) continue;
    markFailed(state, bareName(name));
    return true;
  }
  return false;
};

export const APT_READERS: LineReader[] = [readSummary, readGet, readFetched, readUnpacking, readSettingUp, readFailure];
