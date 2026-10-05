export type RequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

export function readRequestMeta(headers: Headers | undefined): RequestMeta {
  if (!headers) {
    return { ipAddress: null, userAgent: null };
  }
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipAddress = forwarded || headers.get("x-real-ip") || null;
  return {
    ipAddress: ipAddress?.slice(0, 64) ?? null,
    userAgent: headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}
