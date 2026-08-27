export function publicBaseUrl(request: Request, override?: string | null): URL | null {
  const candidates = [
    override,
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    new URL(request.url).origin,
  ];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) continue;
      url.pathname = "/";
      url.search = "";
      return url;
    } catch {
      continue;
    }
  }
  return null;
}

export function publicHttpsUrl(
  request: Request,
  path: string,
  override?: string | null
): string | null {
  const base = publicBaseUrl(request, override);
  return base ? new URL(path, base).toString() : null;
}

export function publicWebSocketUrl(
  request: Request,
  path: string,
  override?: string | null
): string | null {
  const url = publicHttpsUrl(request, path, override);
  return url ? url.replace(/^https:/, "wss:") : null;
}
