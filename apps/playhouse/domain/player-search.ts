export type PlayerSearchResult = {
  displayName: string;
  email: string | null;
  resourceName: string;
};

export type PlayerSearchResponse =
  | { message: string; status: "error" }
  | { results: PlayerSearchResult[]; status: "success" };

export type PlayerSelection = {
  displayName: string;
  id: string;
};

export type PlayerSelectionResponse =
  | { message: string; status: "error" }
  | { contact: PlayerSelection; status: "success" };
