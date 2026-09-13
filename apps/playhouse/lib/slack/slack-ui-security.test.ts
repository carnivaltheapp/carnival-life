import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");

describe("Slack settings and credential boundary", () => {
  it("keeps tokens private and RPCs service-role-only", () => {
    const migration = readFileSync(resolve(root, "supabase/migrations/202609130001_slack_connections.sql"), "utf8");
    expect(migration).toContain("private.slack_connection_credentials");
    expect(migration).toContain("revoke all on table private.slack_connection_credentials from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_slack_connection_credential");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("(select auth.uid()) = owner_user_id");
  });

  it("renders only connection metadata and resolved names", () => {
    const settings = readFileSync(resolve(root, "apps/playhouse/components/slack-connection-settings.tsx"), "utf8");
    const field = readFileSync(resolve(root, "apps/playhouse/components/player-slack-field.tsx"), "utf8");
    expect(settings).toContain("Connect Slack");
    expect(settings).toContain("Reconnect Slack");
    expect(settings).not.toMatch(/accessToken|refreshToken/);
    expect(field).toContain("playerSlackResolved");
  });
});
