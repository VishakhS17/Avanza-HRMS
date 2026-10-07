import { readRequestMeta } from "@/lib/request-meta";
import { getCurrentUser } from "@/lib/services/current-user";
import { documentFileResponse } from "@/lib/services/documents";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return documentFileResponse({
    actor: await getCurrentUser(),
    documentId: id,
    version: new URL(request.url).searchParams.get("version"),
    requestUrl: request.url,
    meta: readRequestMeta(request.headers),
  });
}
