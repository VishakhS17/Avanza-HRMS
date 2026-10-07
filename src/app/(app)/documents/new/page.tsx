import type { Metadata } from "next";
import { HrUploadForm } from "@/app/(app)/documents/forms";
import { PageHeader } from "@/components/shared/page-header";
import { requireCan } from "@/lib/services/current-user";
import { listAssigneeChoices, listDocumentCategories } from "@/lib/services/documents";

export const metadata: Metadata = {
  title: "Upload document",
};

export default async function NewDocumentPage() {
  const user = await requireCan("documents.manage");
  const [categories, employees] = await Promise.all([listDocumentCategories(), listAssigneeChoices(user.id)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upload document"
        description="Policies and Other HR documents can go to many employees. Every other category belongs to one person. Documents for your own record need another HR Admin, except Policies."
      />
      <HrUploadForm categories={categories} employees={employees} selfId={user.id} />
    </div>
  );
}
