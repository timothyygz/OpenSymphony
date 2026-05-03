import pino from "pino";

let _logger: pino.Logger | null = null;

function getLogger(): pino.Logger {
  if (!_logger) {
    const dest = process.env.SYMPHONY_LOG_DEST === "stderr"
      ? pino.destination(2)
      : undefined;
    _logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      formatters: {
        level: (label) => ({ level: label }),
      },
    }, dest);
  }
  return _logger;
}

export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_, prop) {
    return Reflect.get(getLogger(), prop);
  },
});

export function issueLogger(issueId: string, issueIdentifier: string) {
  return logger.child({ issue_id: issueId, issue_identifier: issueIdentifier });
}

export function sessionLogger(sessionId: string) {
  return logger.child({ session_id: sessionId });
}
