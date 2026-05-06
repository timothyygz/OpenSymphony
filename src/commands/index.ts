export type CommandHandler = (args: string[]) => Promise<void>;

const commands = new Map<string, CommandHandler>();

export function registerCommand(name: string, handler: CommandHandler): void {
  commands.set(name, handler);
}

export function getCommand(name: string): CommandHandler | undefined {
  return commands.get(name);
}

export function getCommandNames(): string[] {
  return [...commands.keys()];
}
