"use client";

import { useEffect, useId, useState } from "react";

import {
  loadPlayerGroupMembers,
  searchPlayerContacts,
  selectPlayerContact,
  selectPlayerGroup,
} from "../app/players/actions";
import type {
  PlayerGroupMember,
  PlayerSearchResult,
  PlayerSelection,
} from "../domain/player-search";
import { canSearchGooglePeople, MIN_PLAYER_SEARCH_LENGTH } from "../lib/google/people";

const SEARCH_DEBOUNCE_MS = 300;

function selectionKey(selection: Pick<PlayerSelection, "kind" | "resourceName">) {
  return `${selection.kind}:${selection.resourceName}`;
}

export function PlayerCombobox({ error, initialSelections, onSelectionChange }: {
  error?: string;
  initialSelections: PlayerSelection[];
  onSelectionChange?: (selections: PlayerSelection[]) => void;
}) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<PlayerGroupMember[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [checkedMembers, setCheckedMembers] = useState<Set<string>>(new Set());
  const [isFocused, setIsFocused] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [selected, setSelected] = useState<PlayerSelection[]>(initialSelections);
  const [status, setStatus] = useState<"idle" | "loading" | "selecting">("idle");
  const shouldSearch = canSearchGooglePeople(query);

  useEffect(() => {
    if (!shouldSearch) return;
    let isCurrent = true;
    const timeout = window.setTimeout(async () => {
      setStatus("loading");
      const response = await searchPlayerContacts(query);
      if (!isCurrent) return;
      setActiveIndex(-1);
      setStatus("idle");
      if (response.status === "error") {
        setResults([]);
        setMessage(response.message);
      } else {
        const selectedKeys = new Set(selected.map(selectionKey));
        const available = response.results.filter((result) => !selectedKeys.has(selectionKey(result)));
        setResults(available);
        setMessage(available.length === 0 ? "No matching Google contacts or labels." : null);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      isCurrent = false;
      window.clearTimeout(timeout);
    };
  }, [query, selected, shouldSearch]);

  function updateSelected(next: PlayerSelection[]) {
    setSelected(next);
    onSelectionChange?.(next);
  }

  async function chooseResult(result: PlayerSearchResult) {
    setStatus("selecting");
    setMessage(null);
    const response = result.kind === "group"
      ? await selectPlayerGroup(result.resourceName)
      : await selectPlayerContact(result.resourceName);
    setStatus("idle");
    if (response.status === "error") {
      setMessage(response.message);
      return;
    }
    updateSelected([...selected, response.contact]);
    setQuery("");
    setResults([]);
    setActiveIndex(-1);
  }

  async function toggleGroup(group: Extract<PlayerSelection, { kind: "group" }>) {
    if (expandedGroup === group.resourceName) {
      setExpandedGroup(null);
      setGroupMembers([]);
      setGroupLoading(false);
      setCheckedMembers(new Set());
      return;
    }
    setExpandedGroup(group.resourceName);
    setGroupMembers([]);
    setGroupLoading(true);
    setCheckedMembers(new Set());
    setMessage(null);
    const response = await loadPlayerGroupMembers(group.resourceName);
    setGroupLoading(false);
    if (response.status === "error") {
      setExpandedGroup(null);
      setMessage(response.message);
      return;
    }
    setGroupMembers(response.members);
    setCheckedMembers(new Set(response.members.map(({ resourceName }) => resourceName)));
  }

  const firstContact = selected.find(
    (selection): selection is Extract<PlayerSelection, { kind: "contact" }> =>
      selection.kind === "contact",
  );
  const showMenu = isFocused && (status !== "idle" || results.length > 0 || Boolean(message));

  return (
    <div className="field compactField field--wide playerField playerMultiField">
      {selected.length ? (
        <div aria-label="Selected Players" className="playerSelectionList">
          {selected.map((selection) => (
            <div className={`playerSelection playerSelection--${selection.kind}`} key={selectionKey(selection)}>
              {selection.kind === "group" ? (
                <button
                  aria-expanded={expandedGroup === selection.resourceName}
                  className="playerSelectionName playerGroupName"
                  onClick={() => void toggleGroup(selection)}
                  type="button"
                >
                  <span aria-hidden="true" className="playerGroupIcon">👥</span>
                  <span>{selection.displayName}</span>
                  <small>{selection.memberCount} members</small>
                </button>
              ) : (
                <span className="playerSelectionName">
                  <span aria-hidden="true">●</span>
                  <span>{selection.displayName}</span>
                </span>
              )}
              <button
                aria-label={`Remove ${selection.displayName}`}
                className="removePlayerButton"
                onClick={() => {
                  if (expandedGroup === selection.resourceName) {
                    setExpandedGroup(null);
                    setGroupMembers([]);
                    setGroupLoading(false);
                    setCheckedMembers(new Set());
                  }
                  updateSelected(selected.filter((item) => selectionKey(item) !== selectionKey(selection)));
                }}
                type="button"
              >×</button>
              {selection.kind === "group" && expandedGroup === selection.resourceName ? (
                <div className="playerGroupMembers">
                  {groupLoading ? <p role="status">Loading current group members…</p> : null}
                  {!groupLoading && groupMembers.length ? groupMembers.map((member) => (
                    <label key={member.resourceName}>
                      <input
                        checked={checkedMembers.has(member.resourceName)}
                        onChange={(event) => {
                          setCheckedMembers((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(member.resourceName);
                            else next.delete(member.resourceName);
                            return next;
                          });
                        }}
                        type="checkbox"
                      />
                      <span>{member.displayName}</span>
                      {member.email ? <small>{member.email}</small> : null}
                    </label>
                  )) : null}
                  {!groupLoading && !groupMembers.length ? <p>No current group members.</p> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <label className="playerInputLabel">
        <input
          aria-label="Player"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showMenu}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          onBlur={() => setIsFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setMessage(null);
            setResults([]);
            setStatus("idle");
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp" && results.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => index <= 0 ? results.length - 1 : index - 1);
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              void chooseResult(results[activeIndex]);
            } else if (event.key === "Escape") {
              setResults([]);
              setIsFocused(false);
            }
          }}
          placeholder={`Add Player or label · type ${MIN_PLAYER_SEARCH_LENGTH}+ characters`}
          role="combobox"
          value={query}
        />
      </label>
      <input name="playerContactId" type="hidden" value={firstContact?.id ?? ""} />
      <input name="playerDisplayName" type="hidden" value={firstContact?.displayName ?? ""} />
      <input name="playerEntries" type="hidden" value={JSON.stringify(selected)} />
      {showMenu ? (
        <div className="playerSearchMenu" id={listboxId} role="listbox">
          {status === "loading" ? <p role="status">Searching Google contacts and labels…</p> : null}
          {status === "selecting" ? <p role="status">Selecting Player…</p> : null}
          {results.map((result, index) => (
            <button
              aria-selected={index === activeIndex}
              className={`playerSearchOption playerSearchOption--${result.kind}`}
              key={selectionKey(result)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void chooseResult(result)}
              role="option"
              type="button"
            >
              <strong>
                {result.kind === "group" ? <span aria-hidden="true">👥 </span> : null}
                {result.displayName}
              </strong>
              {result.kind === "group"
                ? <small>{result.memberCount} members</small>
                : result.email ? <small>{result.email}</small> : null}
            </button>
          ))}
          {status === "idle" && message ? <p role="status">{message}</p> : null}
        </div>
      ) : null}
      {error ? <small className="fieldError">{error}</small> : null}
    </div>
  );
}
