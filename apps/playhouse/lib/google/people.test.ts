import { describe, expect, it, vi } from "vitest";

import {
  canSearchGooglePeople,
  getGoogleContact,
  normalizePlayerSearchQuery,
  searchGoogleContacts,
  warmGoogleContactSearch,
} from "./people";

describe("Google People search", () => {
  it("normalizes queries and requires at least two characters", () => {
    expect(normalizePlayerSearchQuery("  David   Example ")).toBe(
      "David Example",
    );
    expect(canSearchGooglePeople(" D ")).toBe(false);
    expect(canSearchGooglePeople(" Da ")).toBe(true);
  });

  it("maps people.searchContacts results to minimal contact summaries", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              person: {
                emailAddresses: [{ value: "david@example.com" }],
                names: [{ displayName: "David Example" }],
                resourceName: "people/david",
              },
            },
            { person: { resourceName: "people/no-display" } },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      searchGoogleContacts("server-access-token", " Dav ", request),
    ).resolves.toEqual([
      {
        displayName: "David Example",
        email: "david@example.com",
        resourceName: "people/david",
      },
    ]);
    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://people.googleapis.com/v1/people:searchContacts",
    );
    expect(url.searchParams.get("query")).toBe("Dav");
    expect(url.searchParams.get("readMask")).toBe("names,emailAddresses");
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "Bearer server-access-token",
    });
  });

  it("supports Google's required empty-query search warmup", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );

    await warmGoogleContactSearch("server-access-token", request);
    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.searchParams.get("query")).toBe("");
    expect(url.pathname).toBe("/v1/people:searchContacts");
  });

  it("verifies a selected resource through people.get", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          names: [{ displayName: "David Example" }],
          resourceName: "people/david",
        }),
        { status: 200 },
      ),
    );

    await expect(
      getGoogleContact("server-access-token", "people/david", request),
    ).resolves.toMatchObject({
      displayName: "David Example",
      resourceName: "people/david",
    });
    expect(String(request.mock.calls[0]?.[0])).toContain(
      "/v1/people/david?personFields=names%2CemailAddresses",
    );
  });

  it("does not expose Google response details when lookup fails", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("sensitive Google response", { status: 401 }),
    );

    await expect(
      searchGoogleContacts("server-access-token", "Dav", request),
    ).rejects.toThrow("Google People lookup failed.");
  });
});
