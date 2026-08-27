"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { BROWSER_TIME_ZONE_COOKIE } from "../lib/playhouse/time-zone";

export function BrowserTimeZone() {
  const router = useRouter();

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentValue = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${BROWSER_TIME_ZONE_COOKIE}=`))
      ?.slice(BROWSER_TIME_ZONE_COOKIE.length + 1);

    if (timeZone && currentValue !== timeZone) {
      document.cookie = `${BROWSER_TIME_ZONE_COOKIE}=${timeZone}; Path=/; Max-Age=31536000; SameSite=Lax`;
      router.refresh();
    }
  }, [router]);

  return null;
}
