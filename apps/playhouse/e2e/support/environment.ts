import { execFileSync } from "node:child_process";
import path from "node:path";

export type E2eEnvironment = {
  anonKey: string;
  serviceRoleKey: string;
  supabaseUrl: string;
};

function parseSupabaseEnvironment(output: string) {
  return Object.fromEntries(
    output
      .replace(/\u001b\[[0-9;]*m/g, "")
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
        return match ? [[match[1], match[2]]] : [];
      }),
  );
}

function localSupabaseEnvironment(): E2eEnvironment {
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  let status: Record<string, string>;

  try {
    status = parseSupabaseEnvironment(
      execFileSync(command, ["supabase", "status", "-o", "env"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }),
    );
  } catch {
    throw new Error(
      "The local Supabase stack is not running. Start Docker, run `npm run db:start`, then retry `npm run test:e2e`.",
    );
  }

  return {
    anonKey: status.PUBLISHABLE_KEY || status.ANON_KEY || "",
    serviceRoleKey: status.SECRET_KEY || status.SERVICE_ROLE_KEY || "",
    supabaseUrl: status.API_URL || "",
  };
}

function assertSafeLocalEnvironment(environment: E2eEnvironment) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(environment.supabaseUrl);
  } catch {
    throw new Error("PLAYHOUSE_E2E_SUPABASE_URL must be a valid local Supabase URL.");
  }

  if (
    (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") ||
    !environment.anonKey ||
    !environment.serviceRoleKey
  ) {
    throw new Error(
      "PlayHouse E2E tests refuse non-local Supabase projects and require local anon and service-role keys.",
    );
  }
}

export function resolveE2eEnvironment(): E2eEnvironment {
  const explicit = {
    anonKey: process.env.PLAYHOUSE_E2E_SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.PLAYHOUSE_E2E_SUPABASE_SERVICE_ROLE_KEY || "",
    supabaseUrl: process.env.PLAYHOUSE_E2E_SUPABASE_URL || "",
  };
  const environment = Object.values(explicit).some(Boolean)
    ? explicit
    : localSupabaseEnvironment();

  assertSafeLocalEnvironment(environment);
  return environment;
}

export function resolvedE2eEnvironment(): E2eEnvironment {
  const environment = {
    anonKey: process.env.PLAYHOUSE_E2E_SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.PLAYHOUSE_E2E_SUPABASE_SERVICE_ROLE_KEY || "",
    supabaseUrl: process.env.PLAYHOUSE_E2E_SUPABASE_URL || "",
  };
  assertSafeLocalEnvironment(environment);
  return environment;
}
