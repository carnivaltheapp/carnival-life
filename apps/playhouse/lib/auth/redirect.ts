const SAFE_BASE_URL = "https://playhouse.invalid";

export function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/")) {
    return "/";
  }

  try {
    const destination = new URL(value, SAFE_BASE_URL);
    if (destination.origin !== SAFE_BASE_URL) {
      return "/";
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
