import { join } from "node:path";

/** System-fixed: never derived from $HOME or SUDO_USER. */
export const pvxHome = () => process.env.PVX_HOME || "/etc/pvx";
export const usermodulesDir = () => process.env.PVX_USERMODULES || join(pvxHome(), "usermodules");
export const moduleStateDir = (id: string) => join(pvxHome(), "modules", id, "state");
export const logsDir = () => join(pvxHome(), "logs");
/** Where login hooks live; `PVX_PROFILED_DIR` moves it (tests). */
export const profiledDir = () => process.env.PVX_PROFILED_DIR || "/etc/profile.d";
