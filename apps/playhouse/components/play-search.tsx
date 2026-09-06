"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 200;

export function PlaySearch({ initialQuery }: { initialQuery: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized === initialQuery) return;
    const timeout = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (normalized) nextParams.set("q", normalized.slice(0, 200));
      else nextParams.delete("q");
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [initialQuery, pathname, query, router, searchParams]);

  function clear() {
    setQuery("");
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("q");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  return (
    <label className="playSearch">
      <span className="srOnly">Search Plays</span>
      <input
        aria-label="Search Plays"
        maxLength={200}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            clear();
          }
        }}
        placeholder="Search Plays"
        ref={inputRef}
        type="search"
        value={query}
      />
      {query ? (
        <button aria-label="Clear Play search" onClick={clear} title="Clear" type="button">
          ×
        </button>
      ) : null}
    </label>
  );
}
