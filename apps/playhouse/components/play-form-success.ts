import type { PlayMutationState } from "../domain/play-mutation";

export function applySuccessfulPlaySave(
  status: PlayMutationState["status"],
  effects: {
    close: () => void;
    refresh: () => void;
  },
) {
  if (status !== "success") {
    return;
  }

  effects.close();
  effects.refresh();
}
