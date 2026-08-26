import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import type { Database } from "../lib/supabase/database.types";
import { resolvedE2eEnvironment } from "./support/environment";

export type AuthenticatedTestContext = {
  admin: SupabaseClient<Database>;
  contacts: Array<{ displayName: string; id: string }>;
  context: BrowserContext;
  page: Page;
  user: SupabaseClient<Database>;
  userId: string;
};

export const test = base.extend<{ auth: AuthenticatedTestContext }>({
  auth: async ({ baseURL, browser }, provide) => {
    if (!baseURL) {
      throw new Error("Playwright baseURL is required for authenticated tests.");
    }

    const environment = resolvedE2eEnvironment();
    const admin = createClient<Database>(
      environment.supabaseUrl,
      environment.serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const email = `playhouse-e2e-${randomUUID()}@example.test`;
    const password = `E2e-${randomUUID()}!`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: { full_name: "PlayHouse E2E User" },
    });
    if (createError || !created.user) {
      throw new Error(`Could not create disposable E2E user: ${createError?.message}`);
    }

    const userClient = createClient<Database>(environment.supabaseUrl, environment.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signedIn, error: signInError } = await userClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError || !signedIn.session) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(`Could not sign in disposable E2E user: ${signInError?.message}`);
    }

    const { data: contactRows, error: contactError } = await userClient
      .from("contact_references")
      .insert([
        { display_name: "Alex Example", owner_user_id: created.user.id },
        { display_name: "Blair Example", owner_user_id: created.user.id },
      ])
      .select("id, display_name")
      .order("display_name", { ascending: true });
    if (contactError || contactRows?.length !== 2) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(`Could not seed disposable E2E contacts: ${contactError?.message}`);
    }
    const contacts = contactRows.map((contact) => ({
      displayName: contact.display_name,
      id: contact.id,
    }));

    const cookieJar = new Map<string, string>();
    const cookieClient = createServerClient<Database>(
      environment.supabaseUrl,
      environment.anonKey,
      {
        cookies: {
          getAll: () =>
            Array.from(cookieJar, ([name, value]) => ({ name, value })),
          setAll: (cookies) => {
            cookies.forEach(({ name, value }) => cookieJar.set(name, value));
          },
        },
      },
    );
    const { error: cookieError } = await cookieClient.auth.setSession({
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
    });
    if (cookieError || cookieJar.size === 0) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(`Could not create E2E session cookies: ${cookieError?.message}`);
    }

    const context = await browser.newContext();
    await context.addCookies(
      Array.from(cookieJar, ([name, value]) => ({ name, url: baseURL, value })),
    );
    const page = await context.newPage();

    try {
      await provide({
        admin,
        contacts,
        context,
        page,
        user: userClient,
        userId: created.user.id,
      });
    } finally {
      await context.close();
      await admin.auth.admin.deleteUser(created.user.id);
    }
  },
});

export { expect };
