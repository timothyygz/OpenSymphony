export function parseBitableUrl(
  url: string,
): { appToken: string; tableId?: string } | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/base\/([A-Za-z0-9]+)/);
    if (!match) return null;
    const appToken = match[1]!;
    const tableId = u.searchParams.get("table") ?? undefined;
    return { appToken, tableId };
  } catch {
    return null;
  }
}
