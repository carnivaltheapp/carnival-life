export type DestinationNavigationMode = "baskets" | "calendar";

export function destinationNavigationModeForView(
  viewKind: "all" | "basket" | "calendar",
): DestinationNavigationMode {
  return viewKind === "basket" ? "baskets" : "calendar";
}

export function toggleDestinationNavigationMode(
  mode: DestinationNavigationMode,
): DestinationNavigationMode {
  return mode === "calendar" ? "baskets" : "calendar";
}
