import pino, { type Logger } from "pino";
import { env } from "./env";

/** Anything matching these field names (at any depth) is censored in output. */
const REDACTED_FIELDS = [
  "apiKey",
  "api_key",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "secret",
  "dsn",
] as const;

/** Minimal structural type pino accepts as a destination (Writable matches). */
export interface LogDestination {
  write(chunk: string): void;
}

export function createLogger(destination?: LogDestination, level = env.LOG_LEVEL): Logger {
  return pino(
    {
      level,
      base: { service: "quodera" },
      redact: {
        paths: REDACTED_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
        censor: "[redacted]",
      },
    },
    destination,
  );
}

export const logger = createLogger();

export type { Logger };
