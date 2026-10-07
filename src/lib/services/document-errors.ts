/** A rule the user can fix. The message is shown as-is. */
export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

/** The actor may not see this document. Always shown as "not found" so IDs reveal nothing. */
export class DocumentAccessError extends Error {
  constructor() {
    super("Document not found.");
    this.name = "DocumentAccessError";
  }
}
