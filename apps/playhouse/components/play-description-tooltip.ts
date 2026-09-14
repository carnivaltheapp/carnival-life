type DescriptionWidth = Pick<HTMLElement, "clientWidth" | "scrollWidth">;
type DescriptionRect = Pick<DOMRect, "bottom" | "left" | "top">;

export type DescriptionTooltipPosition = {
  left: number;
  placement: "above" | "below";
  top: number;
};

export function descriptionIsTruncated(element: DescriptionWidth) {
  return element.scrollWidth > element.clientWidth;
}

export function descriptionTooltipPosition(
  rect: DescriptionRect,
  viewportWidth: number,
): DescriptionTooltipPosition {
  const edgeInset = 12;
  const maxWidth = Math.min(420, viewportWidth - edgeInset * 2);
  const left = Math.min(
    Math.max(edgeInset, rect.left),
    Math.max(edgeInset, viewportWidth - maxWidth - edgeInset),
  );
  const placement = rect.top >= 72 ? "above" : "below";

  return {
    left,
    placement,
    top: placement === "above" ? rect.top - 6 : rect.bottom + 6,
  };
}
