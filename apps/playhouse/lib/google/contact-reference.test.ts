import { describe, expect, it, vi } from "vitest";

import {
  isGooglePeopleResourceName,
  upsertSelectedContactReference,
} from "./contact-reference";

describe("selected Google contact persistence", () => {
  it("distinguishes canonical People resources from legacy display-only identifiers", () => {
    expect(isGooglePeopleResourceName("people/c5834981885377326691")).toBe(true);
    expect(isGooglePeopleResourceName("c5834981885377326691")).toBe(false);
    expect(isGooglePeopleResourceName("contact-reference-id")).toBe(false);
  });

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
