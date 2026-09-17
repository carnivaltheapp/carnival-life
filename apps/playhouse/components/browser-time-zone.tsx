"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { saveBrowserTimeZone } from "../app/time-zone/actions";
import { BROWSER_TIME_ZONE_COOKIE } from "../lib/playhouse/time-zone";

export function BrowserTimeZone({ profileTimeZone }: { profileTimeZone: string }) {
  const router = useRouter();

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentValue = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${BROWSER_TIME_ZONE_COOKIE}=`))
      ?.slice(BROWSER_TIME_ZONE_COOKIE.length + 1);

    if (!timeZone) return;
    const cookieChanged = currentValue !== timeZone;
    if (cookieChanged) {
      document.cookie = `${BROWSER_TIME_ZONE_COOKIE}=${timeZone}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
    void (async () => {
      const profileChanged = profileTimeZone !== timeZone &&
        await saveBrowserTimeZone(timeZone);
      if (cookieChanged || profileChanged) router.refresh();
    })();
  }, [profileTimeZone, router]);

  return null;
}
