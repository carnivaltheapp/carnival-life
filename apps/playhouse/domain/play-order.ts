export type OrderedPlay = {
  id: string;
  order: number;
};

export function orderUpdatesForInsertion({
  beforePlayId,
  destination,
  lowerBound = 0,
  movingPlayIds,
  step,
}: {
  beforePlayId: string | null;
  destination: OrderedPlay[];
  lowerBound?: number;
  movingPlayIds: string[];
  step: number;
}) {
  const moving = new Set(movingPlayIds);
  const remaining = destination.filter((play) => !moving.has(play.id));
  const requestedIndex = beforePlayId
    ? remaining.findIndex((play) => play.id === beforePlayId)
    : -1;
  const insertionIndex = requestedIndex >= 0 ? requestedIndex : remaining.length;
  const previousOrder = remaining[insertionIndex - 1]?.order ?? lowerBound;
  const nextOrder = remaining[insertionIndex]?.order;
  const availableStep = nextOrder === undefined
    ? step
    : Math.floor((nextOrder - previousOrder) / (movingPlayIds.length + 1));

  if (availableStep >= 1) {
    return movingPlayIds.map((id, index) => ({
      id,
      order: previousOrder + availableStep * (index + 1),
    }));
  }

  const inserted = [
    ...remaining.slice(0, insertionIndex),
    ...movingPlayIds.map((id) => ({ id, order: 0 })),
    ...remaining.slice(insertionIndex),
  ];
  const existingOrder = new Map(destination.map((play) => [play.id, play.order]));
  return inserted
    .map((play, index) => ({ id: play.id, order: lowerBound + (index + 1) * step }))
    .filter((play) => existingOrder.get(play.id) !== play.order);
}
