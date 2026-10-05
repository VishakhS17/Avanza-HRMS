"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SettingsPreview() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <section className="max-w-lg rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-medium text-foreground">Workspace</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Settings are not saved yet. This form previews the shared field and
        confirm dialog.
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirmOpen(true);
        }}
      >
        <FormField
          label="Organization name"
          htmlFor="organization-name"
          hint="This value is a placeholder and is not stored."
        >
          <Input defaultValue="Avanza Logistics" />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit">Review</Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmOpen(true)}>
            Discard
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Nothing to save"
        description="Workspace settings will be stored in a later step. Closing this dialog leaves the page unchanged."
        confirmLabel="Close"
        cancelLabel="Back"
        onConfirm={() => undefined}
      />
    </section>
  );
}
