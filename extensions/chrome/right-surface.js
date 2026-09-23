export const TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE = "toggleRightSurface";

export function isToggleRightSurfaceMessage(message) {
  return message?.type === TOGGLE_RIGHT_SURFACE_MESSAGE_TYPE;
}

export async function toggleRightSurface({ controller, currentWorkArea, reportDrawerState }) {
  const { workArea } = await currentWorkArea();
  const state = await controller.toggleRightSurface(workArea);
  reportDrawerState(state);
  return state;
}
