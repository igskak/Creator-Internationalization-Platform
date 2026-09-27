import type { z } from "zod";
import {
  aiSchema,
  appEnvSchema,
  dbSchema,
  e2eSchema,
  FLAG_DEFAULTS,
  instagramSchema,
  jobsSchema,
  observabilitySchema,
  securitySchema,
  storageSchema,
  supabaseSchema,
} from "./schemas";

const concerns = {
  db: dbSchema,
  supabase: supabaseSchema,
  storage: storageSchema,
  ai: aiSchema,
  jobs: jobsSchema,
  instagram: instagramSchema,
  security: securitySchema,
  observability: observabilitySchema,
  e2e: e2eSchema,
};

type Concerns = typeof concerns;

export type ServerEnv = { appEnv: z.output<typeof appEnvSchema> } & {
  [K in keyof Concerns]: z.output<Concerns[K]>;
};

export type EnvProblem = { name: string; kind: "missing" | "invalid"; reason: string };

/** Names the variables that are missing or invalid. Never contains a value. */
export class EnvValidationError extends Error {
  readonly problems: readonly EnvProblem[];

  constructor(problems: EnvProblem[]) {
    const lines = problems.map((p) =>
      p.kind === "missing" ? `  ${p.name}: missing` : `  ${p.name}: ${p.reason}`,
    );
    super(`Invalid server environment:\n${lines.join("\n")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

type Source = Record<string, string | undefined>;

/**
 * Validates the server environment and returns it grouped by concern. Throws
 * EnvValidationError listing every problem at once. The only place that reads process.env.
 */
export function loadServerEnv(source: Source = process.env): ServerEnv {
  const vars = cleanVars(source);
  const problems: EnvProblem[] = [];
  const appEnv = collect(appEnvSchema.safeParse(vars), vars, problems);
  const parsed = Object.fromEntries(
    Object.entries(concerns).map(([key, schema]) => [
      key,
      collect(schema.safeParse(vars), vars, problems),
    ]),
  );

  if (appEnv === "production") {
    problems.push(...productionProblems(vars));
  }
  if (problems.length > 0) throw new EnvValidationError(problems);

  return { ...parsed, appEnv } as ServerEnv;
}

/** Only the database variables, for scripts such as migrations and seeds. */
export function loadDbEnv(source: Source = process.env): ServerEnv["db"] {
  const vars = cleanVars(source);
  const problems: EnvProblem[] = [];
  const db = collect(dbSchema.safeParse(vars), vars, problems);
  if (problems.length > 0) throw new EnvValidationError(problems);
  return db as ServerEnv["db"];
}

// Empty values (`FOO=` in .env files) count as unset.
function cleanVars(source: Source): Source {
  const vars: Source = { ...FLAG_DEFAULTS };
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== "") vars[name] = value;
  }
  return vars;
}

function collect(
  result: z.ZodSafeParseResult<unknown>,
  vars: Source,
  problems: EnvProblem[],
): unknown {
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? "(environment)");
    const kind = vars[name] === undefined ? "missing" : "invalid";
    problems.push({ name, kind, reason: issue.message });
  }
  return undefined;
}

function productionProblems(vars: Source): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const expect = (name: keyof typeof FLAG_DEFAULTS, value: string) => {
    if (vars[name] !== value) {
      problems.push({ name, kind: "invalid", reason: `must be "${value}" in production` });
    }
  };
  expect("JOBS_MODE", "trigger");
  expect("AI_PROVIDER", "live");
  expect("STORAGE_PROVIDER", "r2");
  if (vars.E2E_TEST_AUTH_SECRET !== undefined) {
    problems.push({
      name: "E2E_TEST_AUTH_SECRET",
      kind: "invalid",
      reason: "must not be set in production",
    });
  }
  return problems;
}
