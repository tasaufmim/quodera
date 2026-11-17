import { z } from "zod";

/**
 * Env files and CI frequently set variables to the EMPTY STRING ("SENTRY_DSN="),
 * which is semantically "unset". Normalize before validation.
 */
const emptyToUndefined = (value: unknown): unknown => (value === "" ? undefined : value);

const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/**
 * Environment variables the app actually reads, validated once at import.
 * Adding a new variable? Add it here AND to .env.example (the secret manifest)
 * — GUARDRAILS #9.
 *
 * Unknown variables are ignored; missing required ones fail fast with a clear
 * zod error instead of a cryptic undefined somewhere deep in a request.
 */
const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  DATABASE_URL: optionalSecret,
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ),
  SENTRY_DSN: optionalSecret,
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
