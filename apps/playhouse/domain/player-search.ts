export type PlayerContactSelection = {
  displayName: string;
  id: string;
  kind: "contact";
  resourceName: string;
};

export type PlayerGroupSelection = {
  displayName: string;
  kind: "group";
  memberCount: number;
  resourceName: string;
};

export type PlayerSelection = PlayerContactSelection | PlayerGroupSelection;

export type PlayerSearchResult = {
  displayName: string;
  email: string | null;
  kind: "contact";
  resourceName: string;
} | {
  displayName: string;
  kind: "group";
  memberCount: number;
  resourceName: string;
};

export type PlayerSearchResponse =
  | { message: string; status: "error" }
  | { results: PlayerSearchResult[]; status: "success" };

export type PlayerSelectionResponse =
  | { message: string; status: "error" }
  | { contact: PlayerSelection; status: "success" };

export type PlayerGroupMember = {
  displayName: string;
  email: string | null;
  resourceName: string;
};

export type PlayerGroupMembersResponse =
  | { members: PlayerGroupMember[]; status: "success" }
  | { message: string; status: "error" };
