import type { PublicDevelopmentFeature } from "../../lib/development/roadmap.server";
import styles from "./[featureId]/public-feature.module.css";

function formatUpdatedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function PublicDevelopmentRoadmap({ features }: { features: PublicDevelopmentFeature[] }) {
  return (
    <main className={styles.page}>
      <section className={styles.component}>
        <header className={styles.componentHeader}>
          <span className={styles.eyebrow}>Carnival Development</span>
          <h1>All Features</h1>
          <p>{features.length} {features.length === 1 ? "feature" : "features"}</p>
        </header>
        <div className={styles.featureList}>
          {features.map((feature) => (
            <article className={styles.featureCard} key={feature.featureId}>
              <header className={styles.cardHeader}>
                <p className={styles.featureId}>{feature.featureId}</p>
                <h2>{feature.title}</h2>
              </header>
              <section className={styles.section} aria-label={`${feature.featureId} description`}>
                <h3>Description</h3>
                <p className={styles.longText}>{feature.description}</p>
              </section>
              <dl className={styles.details}>
                <div><dt>Component</dt><dd>{feature.component}</dd></div>
                <div><dt>Status</dt><dd>{feature.status}</dd></div>
                <div><dt>Priority</dt><dd>{feature.priority}</dd></div>
                <div><dt>Sequence</dt><dd>{feature.sequence ?? "Unsequenced"}</dd></div>
                <div>
                  <dt>Updated</dt>
                  <dd><time dateTime={feature.updatedAt}>{formatUpdatedDate(feature.updatedAt)}</time></dd>
                </div>
              </dl>
              <section className={styles.section} aria-label={`${feature.featureId} dependencies`}>
                <h3>Dependencies</h3>
                {feature.dependencies.length > 0 ? (
                  <ul className={styles.dependencies}>
                    {feature.dependencies.map((dependency) => (
                      <li key={dependency.featureId}>
                        <strong>{dependency.featureId}</strong> {dependency.title}
                      </li>
                    ))}
                  </ul>
                ) : <p>None</p>}
              </section>
              <section className={styles.section} aria-label={`${feature.featureId} notes`}>
                <h3>Notes</h3>
                <p className={styles.longText}>{feature.notes || "No notes."}</p>
              </section>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
