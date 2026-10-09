// Subprocess helper: bun writer.ts <logsDir> <name> <count>
import { createLogger } from "../../src/logs/logger.ts";
const [dir, name, count] = process.argv.slice(2) as [string, string, string];
const log = createLogger(dir, name);
for (let i = 0; i < Number(count); i++) {
  log.info(`${name} ${i}`);
  await Bun.sleep(3);
}
