import type { PlayListItem } from "./play";

export const ALL_BRANCHES = "";

export function playBranchName(branch: string | null | undefined) {
  const parts = (branch ?? "")
    .trim()
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (/^[a-z]:$/i.test(parts[0] ?? "") && parts[1]?.toLowerCase() === "google drive") {
    return parts[2] ?? null;
  }
  if (parts[0]?.toLowerCase() === "google drive") return parts[1] ?? null;
  return parts[0] ?? null;
}

export function playBranchOptions(plays: readonly PlayListItem[]) {
  const byNormalizedName = new Map<string, string>();
  for (const play of plays) {
    const name = playBranchName(play.branch);
    if (name) byNormalizedName.set(name.toLocaleLowerCase(), name);
  }
  return [...byNormalizedName.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );
}

export function filterPlaysByBranch(
  plays: readonly PlayListItem[],
  selectedBranch: string,
) {
  if (!selectedBranch) return [...plays];
  const normalizedSelection = selectedBranch.toLocaleLowerCase();
  return plays.filter(
    (play) => playBranchName(play.branch)?.toLocaleLowerCase() === normalizedSelection,
  );
}

export function validSelectedBranch(selectedBranch: string, options: readonly string[]) {
  return options.includes(selectedBranch) ? selectedBranch : ALL_BRANCHES;
}
