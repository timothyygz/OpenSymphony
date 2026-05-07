const ESC = "\x1b[";

export const ANSI = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`,
  home: `${ESC}H`,
  clear: `${ESC}2J`,
  enterAltScreen: `${ESC}?1049h`,
  exitAltScreen: `${ESC}?1049l`,
} as const;

export function colorize(text: string, code: string): string {
  return `${code}${text}${ANSI.reset}`;
}

export function enterAltScreen(): void {
  process.stdout.write(ANSI.enterAltScreen);
}

export function exitAltScreen(): void {
  process.stdout.write(ANSI.exitAltScreen);
}

export function drawLines(lines: string[]): void {
  process.stdout.write(ANSI.home + ANSI.clear + lines.join("\n") + "\n");
}
