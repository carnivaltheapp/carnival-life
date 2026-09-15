import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signOut: mocks.signOut } })),
}));

import { signOut } from "./actions";

describe("logout server action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads, signs out, and returns to the root login route without a module export error", async () => {
    await expect(signOut()).rejects.toThrow("REDIRECT:/");
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });
});
