import type { DocumentActionState } from "@/lib/document-actions";

export function ActionMessage({ state }: { state: DocumentActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-secondary">{state.message ?? "Saved."}</p>;
  return null;
}

export const textAreaClassName =
  "min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const fileHint = "PDF, PNG, or JPEG, up to 4 MB.";
