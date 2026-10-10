import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forEachEmployee } from "@/lib/services/job-isolation";

describe("forEachEmployee", () => {
  it("continues after one employee throws and reports that failure", async () => {
    const seen: string[] = [];
    const result = await forEachEmployee(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      (employee) => employee.id,
      async (employee) => {
        seen.push(employee.id);
        if (employee.id === "b") throw new Error("balance row missing");
      },
    );
    assert.deepEqual(seen, ["a", "b", "c"]);
    assert.deepEqual(result.failures, [{ employeeId: "b", message: "balance row missing" }]);
  });
});
