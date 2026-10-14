// Reads the output of `dnf install` line by line. A `\r` progress redraw arrives as its own line: it only ever (re)marks a package
// as downloading, never as done.
import type { PackagePhase, PackageRef } from "@pvx/sdk";
import { type TrackerState, dropRunning, markDone, markFailed, nameOf, setRunning, splitNevra, type LineReader } from "./packages-state.ts";

const SUMMARY_LINE = /^(?:Install|Upgrade|Reinstall|Downgrade)\s+(\d+)\s+Packages?\b/;
const TABLE_SECTION = /^(?:Installing|Upgrading|Reinstalling|Downgrading)(?: dependencies| weak dependencies| group\/module packages)?:$/;
const OTHER_SECTION = /^[A-Z][A-Za-z ]+:$/;
const TABLE_ROW = /^\s?(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+ \S+)\s*$/;
const WRAPPED_NAME = /^\s?(\S+)\s*$/;
const WRAPPED_ROW = /^\s+(\S+)\s+(\S+)\s+(\S+)\s+([\d.]+ \S+)\s*$/;
const DOWNLOAD_LINE = /^\((?:\d+-)?\d+\/\d+\): (\S+?)\.rpm\s+(.*)$/;
const DOWNLOAD_DONE = /\|\s*[\d.]+ \S+\s+\d\d:\d\d\s*$/;
const TRANSACTION_LINE = /^\s*(Installing|Upgrading|Reinstalling|Downgrading|Running scriptlet|Verifying)\s*:\s*(\S+)\s+\d+\/\d+\s*$/;
const NO_MATCH = /^Error: Unable to find a match: (.+)$/;
const NO_MATCH_ARGUMENT = /^No match for argument: (\S+)/;
const SCRIPTLET_ERROR = /^Error (?:in \w+ scriptlet in rpm package|unpacking rpm package) (\S+)/;
const FAILED_HEADER = /^Failed:$/;
const RUNNING_TRANSACTION = /^Running transaction\s*$/;
const INSTALL_ACTIONS = new Set(["Installing", "Upgrading", "Reinstalling", "Downgrading"]);

const refOf = (state: TrackerState, nevra: string): PackageRef => {
  const parsed = splitNevra(nevra);
  return state.known[parsed.name] ?? parsed;
};

/** The transaction is sequential: a package that is no longer the one being installed is finished. */
const finishInstalling = (state: TrackerState) => {
  for (const pkg of state.progress.running.filter((running) => running.phase !== "download")) markDone(state, pkg);
};

const readSummary: LineReader = (state, line) => {
  const match = SUMMARY_LINE.exec(line);
  if (!match) return false;
  state.current += Number(match[1]);
  state.section = "none";
  return true;
};

const readSectionHeader: LineReader = (state, line) => {
  if (TABLE_SECTION.test(line)) state.section = "table";
  else if (OTHER_SECTION.test(line) && state.section === "table") state.section = "none";
  else return false;
  state.wrapped = undefined;
  return true;
};

const readTableRow: LineReader = (state, line) => {
  if (state.section !== "table") return false;
  const row = state.wrapped ? WRAPPED_ROW.exec(line) : TABLE_ROW.exec(line);
  if (row && state.wrapped) {
    state.known[state.wrapped] = { name: state.wrapped, arch: row[1], version: row[2]!, repo: row[3], size: row[4] };
    state.wrapped = undefined;
    return true;
  }
  if (row) {
    state.known[row[1]!] = { name: row[1]!, arch: row[2], version: row[3]!, repo: row[4], size: row[5] };
    return true;
  }
  const alone = WRAPPED_NAME.exec(line);
  if (alone && !line.startsWith("=")) state.wrapped = alone[1];
  return false;
};

const readDownload: LineReader = (state, line) => {
  const match = DOWNLOAD_LINE.exec(line);
  if (!match) return false;
  const ref = refOf(state, match[1]!);
  state.phase = "download";
  if (DOWNLOAD_DONE.test(match[2]!)) dropRunning(state, ref.name);
  else setRunning(state, ref, "download");
  return true;
};

const readTransactionStart: LineReader = (state, line) => {
  if (!RUNNING_TRANSACTION.test(line)) return false;
  state.progress.running = state.progress.running.filter((pkg) => pkg.phase !== "download");
  return true;
};

const PHASE_OF_ACTION: Record<string, PackagePhase> = { "Running scriptlet": "install", Verifying: "verify" };

const readTransactionLine: LineReader = (state, line) => {
  const match = TRANSACTION_LINE.exec(line);
  if (!match) return false;
  const action = match[1]!;
  const ref = refOf(state, match[2]!);
  state.phase = PHASE_OF_ACTION[action] ?? "install";
  if (INSTALL_ACTIONS.has(action)) {
    finishInstalling(state);
    setRunning(state, ref, "install");
  } else if (action === "Running scriptlet") setRunning(state, ref, "install");
  else markDone(state, ref); // Verifying
  return true;
};

const readFailure: LineReader = (state, line) => {
  const unmatched = NO_MATCH.exec(line)?.[1] ?? NO_MATCH_ARGUMENT.exec(line)?.[1];
  const names = unmatched ? unmatched.split(/\s+/) : [SCRIPTLET_ERROR.exec(line)?.[1]].filter((name): name is string => Boolean(name));
  if (FAILED_HEADER.test(line)) state.section = "failed";
  for (const name of names) markFailed(state, nameOf(name));
  return names.length > 0 || FAILED_HEADER.test(line);
};

const readFailedList: LineReader = (state, line) => {
  if (state.section !== "failed") return false;
  const text = line.trim();
  if (!text) state.section = "none";
  else for (const word of text.split(/\s+/)) markFailed(state, nameOf(word));
  return true;
};

export const DNF_READERS: LineReader[] = [readSummary, readSectionHeader, readTableRow, readDownload, readTransactionStart, readTransactionLine, readFailure, readFailedList];
