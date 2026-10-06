"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { decideApprovalAction, type InboxActionState } from "@/app/(app)/inbox/actions";

const initialState: InboxActionState = {};

const commentClassName =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function DecisionForm({ approvalId }: { approvalId: string }) {
  const [state, action, pending] = useActionState(decideApprovalAction, initialState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="approvalId" value={approvalId} />
      <label className="space-y-1.5 text-sm">
        <span className="font-medium text-foreground">Comment</span>
        <textarea name="comment" className={commentClassName} maxLength={500} />
        <span className="block text-xs text-muted-foreground">Required when you reject.</span>
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="APPROVED" disabled={pending}>
          {pending ? "Saving…" : "Approve"}
        </Button>
        <Button type="submit" name="decision" value="REJECTED" variant="outline" disabled={pending}>
          Reject
        </Button>
      </div>
    </form>
  );
}
