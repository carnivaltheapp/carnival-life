import { describe, expect, it, vi } from "vitest";

import {
  canSearchGooglePeople,
  getGoogleContact,
  getGoogleContactSlack,
  getGoogleContactsSlack,
  GoogleContactsPermissionError,
  normalizePlayerSearchQuery,
  searchGoogleContacts,
  warmGoogleContactSearch,
  updateGoogleContactSlack,
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

  it("reads Slack from the exact userDefined key", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      resourceName: "people/david",
      userDefined: [
        { key: "team", value: "Carnival" },
        { key: "slack", value: "https://carnival.slack.com/team/U1" },
      ],
    }), { status: 200 }));
    await expect(getGoogleContactSlack("token", "people/david", request)).resolves.toEqual({
      resourceName: "people/david",
      slack: "https://carnival.slack.com/team/U1",
    });
  });

  it("batch reads transient Slack values for grid contacts", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      responses: [
        { person: { resourceName: "people/david", userDefined: [{ key: "slack", value: "https://app.slack.com/david" }] } },
        { person: { resourceName: "people/blair", userDefined: [{ key: "team", value: "Carnival" }] } },
      ],
    }), { status: 200 }));
    await expect(getGoogleContactsSlack(
      "token",
      ["people/david", "people/blair"],
      request,
    )).resolves.toEqual({
      "people/blair": "",
      "people/david": "https://app.slack.com/david",
    });
    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.searchParams.getAll("resourceNames")).toEqual(["people/david", "people/blair"]);
    expect(url.searchParams.get("personFields")).toBe("userDefined");
  });

  it("preserves unrelated userDefined values and current metadata when updating Slack", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        etag: "etag-current",
        metadata: { sources: [{ etag: "source-etag", id: "c1", type: "CONTACT" }] },
        resourceName: "people/david",
        userDefined: [
          { key: "team", value: "Carnival" },
          { key: "slack", value: "https://old.slack.com/team/U1" },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        resourceName: "people/david",
        userDefined: [
          { key: "team", value: "Carnival" },
          { key: "slack", value: "https://new.slack.com/team/U1" },
        ],
      }), { status: 200 }));

    await expect(updateGoogleContactSlack(
      "token",
      "people/david",
      " https://new.slack.com/team/U1 ",
      request,
    )).resolves.toMatchObject({ slack: "https://new.slack.com/team/U1" });
    const updateUrl = new URL(String(request.mock.calls[1]?.[0]));
    expect(updateUrl.pathname).toBe("/v1/people/david:updateContact");
    expect(updateUrl.searchParams.get("updatePersonFields")).toBe("userDefined");
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      etag: "etag-current",
      metadata: { sources: [{ etag: "source-etag", id: "c1", type: "CONTACT" }] },
      resourceName: "people/david",
      userDefined: [
        { key: "team", value: "Carnival" },
        { key: "slack", value: "https://new.slack.com/team/U1" },
      ],
    });
  });

  it("clears only Slack from userDefined", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        metadata: { sources: [{ etag: "source-etag", type: "CONTACT" }] },
        resourceName: "people/david",
        userDefined: [{ key: "slack", value: "old" }, { key: "team", value: "Carnival" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        resourceName: "people/david",
        userDefined: [{ key: "team", value: "Carnival" }],
      }), { status: 200 }));
    await updateGoogleContactSlack("token", "people/david", "", request);
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body)).userDefined).toEqual([
      { key: "team", value: "Carnival" },
    ]);
  });

  it("surfaces missing Contacts write permission as a reconnectable error", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        metadata: { sources: [{ etag: "source-etag", type: "CONTACT" }] },
        resourceName: "people/david",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await expect(updateGoogleContactSlack("token", "people/david", "", request))
      .rejects.toBeInstanceOf(GoogleContactsPermissionError);
  });
});
