import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { authRouteLimitResponse } from "@/lib/services/auth-rate-limit";

async function limited(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>,
) {
  const blocked = await authRouteLimitResponse(request);
  if (blocked) return blocked;
  return handler(request);
}

export function GET(request: NextRequest) {
  return limited(request, handlers.GET);
}

export function POST(request: NextRequest) {
  return limited(request, handlers.POST);
}
