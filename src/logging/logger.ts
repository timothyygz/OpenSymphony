import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function issueLogger(issueId: string, issueIdentifier: string) {
  return logger.child({ issue_id: issueId, issue_identifier: issueIdentifier });
}

export function sessionLogger(sessionId: string) {
  return logger.child({ session_id: sessionId });
}
