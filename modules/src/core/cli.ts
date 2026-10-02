import { ValidationError } from "@rc/lib/errors";
import type { ServiceContext } from "./context";

/** A dev CLI command (`pnpm rc <name> [args]`). Modules register theirs in `cli-commands.ts`. */
export type CliCommand = {
  description: string;
  /** Shown in `rc help`, e.g. `hello [name]`. */
  usage?: string;
  run: (ctx: ServiceContext, args: string[]) => Promise<void>;
};

export type CliCommands = Record<string, CliCommand>;

/** Help text listing every registered command. */
export function cliHelp(commands: CliCommands): string {
  const rows = Object.entries(commands)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, command]) => `  ${(command.usage ?? name).padEnd(28)}${command.description}`);
  return ["Usage: pnpm rc <command> [args]", "", "Commands:", ...rows].join("\n");
}

/** Looks up `argv[0]` and runs it; throws ValidationError for a missing or unknown command. */
export async function runCliCommand(
  commands: CliCommands,
  ctx: ServiceContext,
  argv: string[],
): Promise<void> {
  const [name, ...args] = argv;
  const command = name ? commands[name] : undefined;
  if (!command) {
    const problem = name ? `Unknown command "${name}".` : "No command given.";
    throw new ValidationError(`${problem}\n\n${cliHelp(commands)}`);
  }
  await command.run(ctx, args);
}
