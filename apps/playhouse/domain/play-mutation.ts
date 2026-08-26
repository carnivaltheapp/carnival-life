import type { PlayInputField } from "./play-input";

export type PlayMutationState = {
  fieldErrors?: Partial<Record<PlayInputField, string>>;
  message: string;
  status: "idle" | "error" | "success";
};

export const INITIAL_PLAY_MUTATION_STATE: PlayMutationState = {
  message: "",
  status: "idle",
};
