import { describe, expect, it, vi } from "vitest";

import { upsertSelectedContactReference } from "./contact-reference";

describe("selected Google contact persistence", () => {
  it("persists only the authenticated account linkage and minimal cached fields", async () => {
    const persist = vi.fn().mockResolvedValue({ id: "contact-reference-id" });

    await expect(
      upsertSelectedContactReference({
        contact: {
          displayName: "David Example",
          email: "david@example.com",
          resourceName: "people/david",
        },
        googleAccountId: "google-account-id",
        ownerUserId: "authenticated-user-id",
        persist,
      }),
    ).resolves.toEqual({ id: "contact-reference-id" });
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({
      display_name: "David Example",
      email: "david@example.com",
      google_account_id: "google-account-id",
      owner_user_id: "authenticated-user-id",
      provider_resource_name: "people/david",
    });
  });
});
