export async function routeAndHandleIncomingGmail({
  handle,
  playId,
  route,
  url,
}: {
  handle: (playId: string) => Promise<{ success: boolean }>;
  playId: string;
  route: (url: string) => Promise<boolean>;
  url: string;
}) {
  if (!await route(url)) return { handled: false, routed: false };
  const result = await handle(playId);
  return { handled: result.success, routed: true };
}
