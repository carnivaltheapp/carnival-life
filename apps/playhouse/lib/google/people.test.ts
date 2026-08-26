import { describe, expect, it, vi } from "vitest";

import { listGoogleContacts } from "./people";

describe("Google People contact mapping", () => {
  it("paginates and keeps only contacts with a stable name or email", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            connections: [
              {
                emailAddresses: [{ value: "alex@example.com" }],
                names: [{ displayName: "Alex Example" }],
                resourceName: "people/alex",
              },
              { resourceName: "people/no-display" },
            ],
            nextPageToken: "next-page",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            connections: [
              {
                emailAddresses: [{ value: "fallback@example.com" }],
                resourceName: "people/fallback",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    await expect(listGoogleContacts("provider-token", request)).resolves.toEqual([
      {
        displayName: "Alex Example",
        email: "alex@example.com",
        resourceName: "people/alex",
      },
      {
        displayName: "fallback@example.com",
        email: "fallback@example.com",
        resourceName: "people/fallback",
      },
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1]?.[0])).toContain("pageToken=next-page");
  });

  it("does not expose a Google API response when import fails", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("sensitive provider response", { status: 401 }),
    );

    await expect(listGoogleContacts("provider-token", request)).rejects.toThrow(
      "Google contacts could not be imported.",
    );
  });
});
