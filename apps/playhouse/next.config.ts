import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  agentRules: false,
  env: {
    NEXT_PUBLIC_CARNIVAL_BUILD_VERSION: buildVersion,
  },
  reactStrictMode: true,
};

export default nextConfig;
