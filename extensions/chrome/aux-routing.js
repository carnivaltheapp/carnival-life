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
  const { monitorId, workArea } = await currentWorkArea();
  await controller.openCarnivalContext(message.url, workArea, monitorId);
  reportDrawerState(await controller.state());
}

function routeLogLabel(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
