"use client";

import { useState } from "react";

import { toggleRightSurface } from "../lib/desktop/toggle-right-surface";

export function WorkspaceSurfaceToggle() {
  const [pending, setPending] = useState(false);

  return (
    <button
      aria-label="Switch between Aux and Misc"
      className="workspaceSurfaceToggle"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await toggleRightSurface();
        } finally {
          setPending(false);
        }
      }}
      title="Switch between Aux and Misc (Alt+Shift+M)"
      type="button"
    >
      Aux ⇄ Misc
    </button>
  );
}
