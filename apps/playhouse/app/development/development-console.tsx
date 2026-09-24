"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  DEVELOPMENT_COMPONENTS,
  DEVELOPMENT_PRIORITIES,
  DEVELOPMENT_STATUSES,
  filterDevelopmentFeatures,
  type DevelopmentComponent,
  type DevelopmentFeature,
  type DevelopmentFeatureInput,
  type DevelopmentPriority,
  type DevelopmentStatus,
} from "../../domain/development-feature";
import styles from "./development.module.css";

type Identity = { displayName: string; email: string | null };
type Draft = DevelopmentFeatureInput;

const emptyDraft: Draft = {
  component: "PlayHouse",
  dependencies: [],
  description: "",
  notes: "",
  priority: "Medium",
  sequence: null,
  status: "Idea",
  title: "",
};

function Icon({ name }: { name: DevelopmentComponent | "All Features" }) {
  const paths: Record<typeof name, string> = {
    "All Features": "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    "Calendar": "M5 4h14v16H5zM8 2v4M16 2v4M5 9h14",
    "Carnival AI": "M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z",
    "Chrome Extension": "M12 3a9 9 0 109 9H11M5 7h12M8 20l5-9M12 12a3 3 0 100 6 3 3 0 000-6z",
    "Contacts / Players": "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 8a3 3 0 110 6M17 16a5 5 0 015 5",
    "Gmail": "M3 6l9 7 9-7v12H3zM3 6l9 7 9-7",
    "Incoming / Integrations": "M4 12h11M11 8l4 4-4 4M17 4h3v16h-3",
    "Logger / Changelog": "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
    "Mobile / PWA": "M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM10 18h4",
    "PlayHouse": "M4 20V8l8-5 8 5v12M8 20v-7h8v7",
    "Roller": "M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8",
    "Settings / Infrastructure": "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M4.9 4.9L7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1",
    "Slack": "M8 3v12a2 2 0 01-4 0V9a2 2 0 012-2h12M16 21V9a2 2 0 014 0v6a2 2 0 01-2 2H6",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d={paths[name]} />
    </svg>
  );
}

function initials(identity: Identity) {
  return identity.displayName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function featureDraft(feature: DevelopmentFeature): Draft {
  return {
    component: feature.component,
    dependencies: feature.dependencies,
    description: feature.description,
    notes: feature.notes,
    priority: feature.priority,
    sequence: feature.sequence,
    status: feature.status,
    title: feature.title,
  };
}

function componentTone(component: DevelopmentComponent) {
  if (["Gmail", "Slack", "Incoming / Integrations"].includes(component)) return styles.componentGreen;
  if (["Calendar", "Chrome Extension", "Mobile / PWA"].includes(component)) return styles.componentBlue;
  if (["Roller", "Carnival AI"].includes(component)) return styles.componentGold;
  if (["Contacts / Players", "Logger / Changelog"].includes(component)) return styles.componentRose;
  return styles.componentPurple;
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

export function DevelopmentConsole({
  dataError,
  identity,
  initialFeatures,
}: {
  dataError: boolean;
  identity: Identity;
  initialFeatures: DevelopmentFeature[];
}) {
  const [features, setFeatures] = useState(initialFeatures);
  const [component, setComponent] = useState<DevelopmentComponent | "All Features">("All Features");
  const [priority, setPriority] = useState<DevelopmentPriority | "All Priorities">("All Priorities");
  const [status, setStatus] = useState<DevelopmentStatus | "All Statuses">("All Statuses");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<DevelopmentFeature | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuFeatureId, setMenuFeatureId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(dataError ? "Roadmap data could not be loaded." : "");

  const visibleFeatures = useMemo(() => filterDevelopmentFeatures(features, {
    component,
    priority,
    query,
    status,
  }), [component, features, priority, query, status]);

  useEffect(() => {
    if (!menuFeatureId) return;
    const close = () => setMenuFeatureId(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menuFeatureId]);

  useEffect(() => {
    if (!dialogOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) closeDialog();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  });

  function openNewFeature() {
    setEditing(null);
    setDraft({ ...emptyDraft, component: component === "All Features" ? "PlayHouse" : component });
    setConfirmDelete(false);
    setMessage("");
    setDialogOpen(true);
  }

  function openFeature(feature: DevelopmentFeature, deleting = false) {
    setEditing(feature);
    setDraft(featureDraft(feature));
    setConfirmDelete(deleting);
    setMenuFeatureId(null);
    setMessage("");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setConfirmDelete(false);
    setEditing(null);
    setDraft(emptyDraft);
    setMessage("");
  }

  async function saveFeature(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.description.trim()) {
      setMessage("Title and description are required.");
      return;
    }
    setSaving(true);
    setMessage("");
    const endpoint = editing
      ? `/api/development/features/${editing.id}`
      : "/api/development/features";
    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(draft),
        headers: { "Content-Type": "application/json" },
        method: editing ? "PATCH" : "POST",
      });
      if (!response.ok) {
        setMessage(await responseMessage(response, "Feature could not be saved."));
        return;
      }
      const { feature } = await response.json() as { feature: DevelopmentFeature };
      setFeatures((current) => editing
        ? current.map((item) => item.id === feature.id ? feature : item)
        : [...current, feature]);
      closeDialog();
    } catch {
      setMessage("Feature could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteFeature() {
    if (!editing) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/development/features/${editing.id}`, { method: "DELETE" });
      if (!response.ok) {
        setMessage(await responseMessage(response, "Feature could not be deleted."));
        return;
      }
      setFeatures((current) => current
        .filter((item) => item.id !== editing.id)
        .map((item) => ({
          ...item,
          dependencies: item.dependencies.filter((dependency) => dependency !== editing.id),
        })));
      closeDialog();
    } catch {
      setMessage("Feature could not be deleted. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.console}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/" aria-label="Carnival Life home">
          <span className={styles.brandMark}>C</span>
          <span><strong>Carnival</strong><small>Life</small></span>
        </Link>
        <nav className={styles.navigation} aria-label="Development components">
          {(["All Features", ...DEVELOPMENT_COMPONENTS] as const).map((item) => (
            <button
              className={component === item ? styles.navActive : styles.navItem}
              key={item}
              onClick={() => setComponent(item)}
              type="button"
            >
              <Icon name={item} />
              <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className={styles.account}>
          <span className={styles.avatar}>{initials(identity)}</span>
          <span><strong>{identity.displayName}</strong><small>{identity.email ?? "Carnival account"}</small></span>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div>
            <h1>Carnival Development</h1>
            <p>Features, priorities &amp; development sequence</p>
          </div>
          <span className={styles.motto}>Building a more<br /><strong>connected life</strong></span>
        </header>

        <div className={styles.controls}>
          <label className={styles.search}>
            <span className={styles.searchIcon} aria-hidden="true">⌕</span>
            <span className="srOnly">Search features</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search features..."
              type="search"
              value={query}
            />
          </label>
          <label className={styles.selectControl}>
            <span className="srOnly">Filter by status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option>All Statuses</option>
              {DEVELOPMENT_STATUSES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className={styles.selectControl}>
            <span className="srOnly">Filter by priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
              <option>All Priorities</option>
              {DEVELOPMENT_PRIORITIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button className={styles.newButton} onClick={openNewFeature} type="button">
            <span aria-hidden="true">+</span> New Feature
          </button>
        </div>

        {message && !dialogOpen ? <p className={styles.pageMessage} role="alert">{message}</p> : null}

        <div className={styles.tableCard}>
          <div className={styles.tableSummary}>
            <strong>{component}</strong>
            <span>{visibleFeatures.length} {visibleFeatures.length === 1 ? "feature" : "features"}</span>
          </div>
          <div className={styles.tableScroller}>
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Component</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Sequence</th>
                  <th><span className="srOnly">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleFeatures.map((feature) => (
                  <tr key={feature.id} onClick={() => openFeature(feature)}>
                    <td className={styles.featureCell}>
                      <strong>{feature.title}</strong>
                      <p>{feature.description}</p>
                    </td>
                    <td><span className={`${styles.pill} ${componentTone(feature.component)}`}>{feature.component}</span></td>
                    <td><span className={`${styles.pill} ${styles[`status${feature.status}`]}`}>{feature.status}</span></td>
                    <td><span className={`${styles.pill} ${styles[`priority${feature.priority}`]}`}>{feature.priority}</span></td>
                    <td className={styles.sequence}>{feature.sequence ?? "—"}</td>
                    <td className={styles.actionCell}>
                      <button
                        aria-expanded={menuFeatureId === feature.id}
                        aria-label={`Actions for ${feature.title}`}
                        className={styles.menuButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFeatureId((current) => current === feature.id ? null : feature.id);
                        }}
                        type="button"
                      >
                        <span aria-hidden="true">⋮</span>
                      </button>
                      {menuFeatureId === feature.id ? (
                        <div className={styles.rowMenu} onClick={(event) => event.stopPropagation()} role="menu">
                          <button onClick={() => openFeature(feature)} role="menuitem" type="button">Edit</button>
                          <button onClick={() => openFeature(feature, true)} role="menuitem" type="button">Delete</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleFeatures.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No features found</strong>
                <p>Try adjusting the filters or add a new roadmap feature.</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {dialogOpen ? (
        <div className={styles.modalBackdrop} onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) closeDialog();
        }}>
          <section aria-labelledby="feature-dialog-title" aria-modal="true" className={styles.modal} role="dialog">
            <div className={styles.modalHeading}>
              <div>
                <span>{editing ? "Roadmap feature" : "New roadmap item"}</span>
                <h2 id="feature-dialog-title">{editing ? "Edit Feature" : "New Feature"}</h2>
              </div>
              <button aria-label="Close" onClick={closeDialog} type="button">×</button>
            </div>
            <form onSubmit={saveFeature}>
              <div className={styles.formGrid}>
                <label className={styles.fullField}>Title <em>*</em>
                  <input autoFocus maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required value={draft.title} />
                </label>
                <label className={styles.fullField}>Description <em>*</em>
                  <textarea maxLength={2000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} required rows={4} value={draft.description} />
                </label>
                <label>Component
                  <select onChange={(event) => setDraft({ ...draft, component: event.target.value as DevelopmentComponent })} value={draft.component}>
                    {DEVELOPMENT_COMPONENTS.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>Status
                  <select onChange={(event) => setDraft({ ...draft, status: event.target.value as DevelopmentStatus })} value={draft.status}>
                    {DEVELOPMENT_STATUSES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>Priority
                  <select onChange={(event) => setDraft({ ...draft, priority: event.target.value as DevelopmentPriority })} value={draft.priority}>
                    {DEVELOPMENT_PRIORITIES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>Sequence
                  <input min="0" onChange={(event) => setDraft({ ...draft, sequence: event.target.value ? Number(event.target.value) : null })} step="1" type="number" value={draft.sequence ?? ""} />
                </label>
                <fieldset className={styles.fullField}>
                  <legend>Dependencies</legend>
                  <div className={styles.dependencies}>
                    {features.filter((feature) => feature.id !== editing?.id).map((feature) => (
                      <label key={feature.id}>
                        <input
                          checked={draft.dependencies.includes(feature.id)}
                          onChange={(event) => setDraft({
                            ...draft,
                            dependencies: event.target.checked
                              ? [...draft.dependencies, feature.id]
                              : draft.dependencies.filter((id) => id !== feature.id),
                          })}
                          type="checkbox"
                        />
                        <span>{feature.title}</span>
                      </label>
                    ))}
                    {features.filter((feature) => feature.id !== editing?.id).length === 0
                      ? <p>No other features are available.</p> : null}
                  </div>
                </fieldset>
                <label className={styles.fullField}>Notes
                  <textarea maxLength={4000} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={4} value={draft.notes} />
                </label>
              </div>
              {message ? <p className={styles.formMessage} role="alert">{message}</p> : null}
              {confirmDelete ? (
                <div className={styles.deleteConfirmation} role="alert">
                  <span><strong>Delete this feature?</strong><small>This cannot be undone.</small></span>
                  <button disabled={saving} onClick={() => setConfirmDelete(false)} type="button">Keep Feature</button>
                  <button disabled={saving} onClick={deleteFeature} type="button">Confirm Delete</button>
                </div>
              ) : (
                <div className={styles.modalActions}>
                  {editing ? <button className={styles.deleteButton} disabled={saving} onClick={() => setConfirmDelete(true)} type="button">Delete Feature</button> : <span />}
                  <button className={styles.cancelButton} disabled={saving} onClick={closeDialog} type="button">Cancel</button>
                  <button className={styles.saveButton} disabled={saving} type="submit">{saving ? "Saving..." : editing ? "Save Changes" : "Save Feature"}</button>
                </div>
              )}
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
