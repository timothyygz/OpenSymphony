import pino from "pino";
import { multistream } from "pino";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

export const LOGS_DIR = resolve(homedir(), ".open-symphony", "logs");

export function ensureLogDir(): string {
  mkdirSync(LOGS_DIR, { recursive: true });
  return LOGS_DIR;
}

let _logger: pino.Logger | null = null;
let _logFilePath: string | null = null;

export function setLogFilePath(path: string): void {
  _logFilePath = path;
}

function getLogger(): pino.Logger {
  if (!_logger) {
    const streams: pino.StreamEntry[] = [];

    const consoleDest = process.env.SYMPHONY_LOG_DEST === "stderr"
      ? pino.destination(2)
      : pino.destination(1);
    if (!(_logFilePath && process.env.SYMPHONY_LOG_DEST === "stderr")) {
      streams.push({ stream: consoleDest });
    }

    if (_logFilePath) {
      streams.push({ stream: pino.destination({ dest: _logFilePath, sync: false }) });
    }

    _logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        level: (label) => ({ level: label }),
      },
    }, multistream(streams));
  }
  return _logger;
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_, prop) {
    return Reflect.get(getLogger(), prop);
  },
});
