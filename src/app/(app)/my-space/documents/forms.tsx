"use client";

import { useActionState } from "react";
import {
  acknowledgeDocumentAction,
  addOwnVersionAction,
  removeOwnDocumentAction,
  uploadOwnDocumentAction,
} from "@/app/(app)/my-space/documents/actions";
import { ActionMessage, fileHint, textAreaClassName } from "@/components/documents/action-message";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentActionState } from "@/lib/document-actions";
import { UPLOAD_ACCEPT } from "@/lib/storage/files";

const initialState: DocumentActionState = {};

export function OwnUploadForm({ categories }: { categories: { code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(uploadOwnDocumentAction, initialState);
  return (
    <form action={action} className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Category" htmlFor="own-category">
          <NativeSelect name="categoryCode" required defaultValue={categories[0]?.code ?? ""}>
            {categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Title" htmlFor="own-title">
          <Input name="title" required maxLength={120} placeholder="For example, Aadhaar card" />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="own-description" hint="Optional.">
        <textarea name="description" className={textAreaClassName} maxLength={500} />
      </FormField>
      <FormField label="File" htmlFor="own-file" hint={fileHint}>
        <Input name="file" type="file" accept={UPLOAD_ACCEPT} required />
      </FormField>
      <ActionMessage state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}

export function OwnVersionForm({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(addOwnVersionAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input name="file" type="file" accept={UPLOAD_ACCEPT} required aria-label="New version" className="max-w-xs" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Upload new version"}
        </Button>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}

export function OwnRemoveForm({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(removeOwnDocumentAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input name="reason" required minLength={3} maxLength={300} placeholder="Reason for removing" className="max-w-xs" aria-label="Reason for removing" />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Removing…" : "Remove"}
        </Button>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}

export function AcknowledgeForm({
  documentId,
  versionId,
  versionNumber,
}: {
  documentId: string;
  versionId: string;
  versionNumber: number;
}) {
  const [state, action, pending] = useActionState(acknowledgeDocumentAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="versionId" value={versionId} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : `I have read version ${versionNumber}`}
        </Button>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}
