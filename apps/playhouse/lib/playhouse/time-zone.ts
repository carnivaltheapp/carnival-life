export const BROWSER_TIME_ZONE_COOKIE = "carnival-time-zone";

export function isSupportedTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(
  browserTimeZone: string | null | undefined,
  profileTimeZone: string | null | undefined,
) {
  if (isSupportedTimeZone(browserTimeZone)) {
    return browserTimeZone as string;
  }

  return isSupportedTimeZone(profileTimeZone) ? (profileTimeZone as string) : "UTC";
}
