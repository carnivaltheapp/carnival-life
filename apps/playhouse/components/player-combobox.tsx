"use client";

import { useEffect, useId, useState } from "react";

import {
  searchPlayerContacts,
  selectPlayerContact,
} from "../app/players/actions";
import type {
  PlayerSearchResult,
  PlayerSelection,
} from "../domain/player-search";
import {
  canSearchGooglePeople,
  MIN_PLAYER_SEARCH_LENGTH,
} from "../lib/google/people";

const SEARCH_DEBOUNCE_MS = 300;

export function PlayerCombobox({
  error,
  initialSelection,
}: {
  error?: string;
  initialSelection: PlayerSelection | null;
}) {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState(initialSelection?.displayName ?? "");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [selected, setSelected] = useState<PlayerSelection | null>(
    initialSelection,
  );
  const [status, setStatus] = useState<"idle" | "loading" | "selecting">(
    "idle",
  );
  const shouldSearch =
    (!selected || query !== selected.displayName) &&
    canSearchGooglePeople(query);

  useEffect(() => {
    if (!shouldSearch) {
      return;
    }

    let isCurrent = true;
    const timeout = window.setTimeout(async () => {
      setStatus("loading");
      const response = await searchPlayerContacts(query);
      if (!isCurrent) {
        return;
      }
      setActiveIndex(-1);
      setStatus("idle");
      if (response.status === "error") {
        setResults([]);
        setMessage(response.message);
      } else {
        setResults(response.results);
        setMessage(
          response.results.length === 0 ? "No matching Google contacts." : null,
        );
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrent = false;
      window.clearTimeout(timeout);
    };
  }, [query, shouldSearch]);

  async function chooseResult(result: PlayerSearchResult) {
    setStatus("selecting");
    setMessage(null);
    const response = await selectPlayerContact(result.resourceName);
    setStatus("idle");
    if (response.status === "error") {
      setMessage(response.message);
      return;
    }

    setSelected(response.contact);
    setQuery(response.contact.displayName);
    setResults([]);
    setIsFocused(false);
  }

  const showMenu =
    isFocused &&
    (status !== "idle" || results.length > 0 || Boolean(message));

  return (
    <div className="field compactField field--wide playerField">
      <label className="playerInputLabel">
        <span className="controlLabel">Player</span>
        <input
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showMenu}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          onBlur={() => setIsFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
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
              setActiveIndex((index) =>
                index <= 0 ? results.length - 1 : index - 1,
              );
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              void chooseResult(results[activeIndex]);
            } else if (event.key === "Escape") {
              setResults([]);
              setIsFocused(false);
            }
          }}
          placeholder={`No Player · type ${MIN_PLAYER_SEARCH_LENGTH}+ characters`}
          role="combobox"
          value={query}
        />
      </label>
      <input name="playerContactId" type="hidden" value={selected?.id ?? ""} />
      <input
        name="playerDisplayName"
        type="hidden"
        value={selected?.displayName ?? ""}
      />
      {selected ? (
        <button
          aria-label="Clear Player"
          className="clearPlayerButton"
          onClick={() => {
            setQuery("");
            setSelected(null);
            setResults([]);
          }}
          type="button"
        >
          ×
        </button>
      ) : null}
      {showMenu ? (
        <div className="playerSearchMenu" id={listboxId} role="listbox">
          {status === "loading" ? (
            <p role="status">Searching Google contacts…</p>
          ) : status === "selecting" ? (
            <p role="status">Selecting Player…</p>
          ) : null}
          {results.map((result, index) => (
            <button
              aria-selected={index === activeIndex}
              className="playerSearchOption"
              key={result.resourceName}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void chooseResult(result)}
              role="option"
              type="button"
            >
              <strong>{result.displayName}</strong>
              {result.email ? <small>{result.email}</small> : null}
            </button>
          ))}
          {status === "idle" && message ? <p role="status">{message}</p> : null}
        </div>
      ) : null}
      {error ? <small className="fieldError">{error}</small> : null}
    </div>
  );
}
