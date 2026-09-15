import { auxRoleForUrl } from "./workspace-tabs.js";

export const OPEN_IN_AUX_MESSAGE_TYPE = "openInAux";

export function isOpenInAuxMessage(message) {
  return message?.type === OPEN_IN_AUX_MESSAGE_TYPE;
}

export async function routeOpenInAuxMessage({
  controller,
  currentWorkArea,
  logger = console,
  message,
  reportDrawerState,
}) {
  logger.info?.("Carnival: openInAux received", routeLogLabel(message.url));
  const role = auxRoleForUrl(message.url);
  logger.info?.("HOT_TAB_ROUTE_START", {
    hostname: routeHostname(message.url),
    role,
  });
  const { monitorId, workArea } = await currentWorkArea();
  await controller.openCarnivalContext(
    message.url,
    workArea,
    monitorId,
    role,
  );
  reportDrawerState(await controller.state());
}

function routeHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-url";
  }
}

function routeLogLabel(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
