import type { PlayInputField } from "./play-input";

const PLAY_FORM_VALUE_FIELDS = [
  "basketId",
  "branch",
  "durationMinutes",
  "note",
  "place",
  "placementKind",
  "playType",
  "playerContactId",
  "playerDisplayName",
  "pushRule",
  "scheduledDate",
  "title",
  "url",
] as const;

export type PlayMutationValues = Partial<
  Record<(typeof PLAY_FORM_VALUE_FIELDS)[number], string>
>;

export type PlayMutationState = {
  fieldErrors?: Partial<Record<PlayInputField, string>>;
  message: string;
  redirectTo?: string;
  status: "idle" | "error" | "success";
  values?: PlayMutationValues;
};

export const INITIAL_PLAY_MUTATION_STATE: PlayMutationState = {
  message: "",
  status: "idle",
};

export function capturePlayMutationValues(formData: FormData): PlayMutationValues {
  return Object.fromEntries(
    PLAY_FORM_VALUE_FIELDS.flatMap((field) => {
      const value = formData.get(field);
      return typeof value === "string" ? [[field, value]] : [];
    }),
  );
}
