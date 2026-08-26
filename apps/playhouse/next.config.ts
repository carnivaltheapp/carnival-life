import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

const buildVersion = new Intl.DateTimeFormat("sv-SE", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: "America/Los_Angeles",
  year: "numeric",
}).format(new Date());

function commitName() {
  const vercelMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE?.split(/\r?\n/, 1)[0].trim();
  if (vercelMessage) {
    return vercelMessage;
  }

  try {
    return execFileSync("git", ["log", "-1", "--pretty=%s"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "Unknown commit";
  }
}

const nextConfig: NextConfig = {
  agentRules: false,
  env: {
    NEXT_PUBLIC_CARNIVAL_BUILD_COMMIT: commitName(),
    NEXT_PUBLIC_CARNIVAL_BUILD_VERSION: buildVersion,
  },
  reactStrictMode: true,
};

export default nextConfig;
