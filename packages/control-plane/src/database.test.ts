import { describe, expect, it } from "vitest";

import { resetTestDatabase } from "./database";

describe("resetTestDatabase", () => {
  it("refuses to reset a database that is not explicitly marked for tests", async () => {
    await expect(
      resetTestDatabase("postgresql://user:secret@db.example.com/production"),
    ).rejects.toThrow("database whose name is not marked test");
  });
});
