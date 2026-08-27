import { describe, expect, it } from "vitest";

import { MONGO_CLIENT_OPTIONS, mongoDiagnostic } from "./mongo-options";

describe("Mongo serverless options", () => {
  it("bounds connection selection and socket work", () => {
    expect(MONGO_CLIENT_OPTIONS).toMatchObject({
      connectTimeoutMS: 5_000,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
      socketTimeoutMS: 10_000,
    });
  });

  it("logs only safe error classifications", () => {
    const diagnostic = mongoDiagnostic(
      Object.assign(new Error("mongodb+srv://user:secret@example.test"), {
        code: "ETIMEDOUT",
      }),
    );
    expect(diagnostic).toEqual({ code: "ETIMEDOUT", name: "Error" });
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });
});
