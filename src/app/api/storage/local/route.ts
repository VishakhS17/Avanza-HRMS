import { serveLocalFile } from "@/lib/storage/local";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  return serveLocalFile(new URL(request.url).searchParams.get("token"));
}
