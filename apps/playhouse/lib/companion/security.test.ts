import { describe, expect, it } from "vitest";

import {
  bearerCredential,
  createDeviceCredential,
  createPairingCode,
  secretHash,
} from "./security";

describe("companion credential security", () => {
  it("creates short-lived-code material and independent high-entropy device credentials", () => {
    expect(createPairingCode()).toMatch(/^[A-Z0-9_-]{12}$/);
    const first = createDeviceCredential();
    const second = createDeviceCredential();
    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(secretHash(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(secretHash(first)).not.toContain(first);
  });

  it("accepts only a sufficiently long bearer credential", () => {
    const credential = createDeviceCredential();
    expect(bearerCredential(`Bearer ${credential}`)).toBe(credential);
    expect(bearerCredential("Bearer short")).toBeNull();
    expect(bearerCredential(null)).toBeNull();
  });
});
