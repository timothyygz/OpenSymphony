export function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    width +=
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols
      (code >= 0xff01 && code <= 0xff60)    // Fullwidth
        ? 2
        : 1;
  }
  return width;
}

export function padCell(value: string, width: number, align: "left" | "right" = "left"): string {
  const dw = displayWidth(value);
  const padding = Math.max(0, width - dw);
  return align === "right"
    ? " ".repeat(padding) + value
    : value + " ".repeat(padding);
}

export function truncate(str: string, maxWidth: number): string {
  if (displayWidth(str) <= maxWidth) return str;
  let width = 0;
  let end = 0;
  for (const ch of str) {
    const cw = displayWidth(ch);
    if (width + cw > maxWidth - 3) break;
    width += cw;
    end += ch.length;
  }
  return str.slice(0, end) + "...";
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "0";
  const s = String(value);
  const sign = s.startsWith("-") ? "-" : "";
  const unsigned = sign ? s.slice(1) : s;
  const reversed = unsigned.split("").reverse().join("");
  const grouped = reversed.replace(/(\d{3})(?=\d)/g, "$1,");
  return sign + grouped.split("").reverse().join("");
}

export function formatRuntime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}m ${s}s`;
}
