export class EmployeeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeError";
  }
}

export class EmployeeAccessError extends Error {
  readonly kind: "forbidden" | "not-found";

  constructor(kind: "forbidden" | "not-found", message: string) {
    super(message);
    this.name = "EmployeeAccessError";
    this.kind = kind;
  }
}

export class OrganizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganizationError";
  }
}
