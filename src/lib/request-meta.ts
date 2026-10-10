export type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

function firstAddress(value: string | null): string | null {
  const address = value?.split(",")[0]?.trim() ?? "";
  if (!address || address.length > 64) return null;
  return address;
}

/**
 * Client IP for the audit log.
 * On Vercel, `x-vercel-forwarded-for` is set by the platform and is the address to keep.
 * The first value in `x-forwarded-for` is ignored everywhere, because the client can set it.
 * Off Vercel, only `x-real-ip` is used, and only when a trusted proxy in front of the app sets it.
 * If neither trusted header is present, the audit row stores no IP.
 */
export function clientIp(headers: Headers): string | null {
  const vercelForwarded = firstAddress(headers.get("x-vercel-forwarded-for"));
  if (vercelForwarded) return vercelForwarded;
  return firstAddress(headers.get("x-real-ip"));
}

export function readRequestMeta(headers: Headers | undefined): RequestMeta {
  if (!headers) {
    return { ipAddress: null, userAgent: null };
  }
  return {
    ipAddress: clientIp(headers),
    userAgent: headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}
