export class LeaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveError";
  }
}
