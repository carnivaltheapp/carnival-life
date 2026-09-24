import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { normalizeDevelopmentFeatureId } from "../../../domain/development-feature";
import { loadPublicDevelopmentFeature } from "../../../lib/development/roadmap.server";
import styles from "./public-feature.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  description: "A shared read-only Carnival Development feature.",
  robots: { follow: false, index: false },
  title: "Carnival Development Feature",
};

function formatUpdatedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function PublicDevelopmentFeaturePage({
  params,
}: {
  params: Promise<{ featureId: string }>;
}) {
  const { featureId: requestedFeatureId } = await params;
  const featureId = normalizeDevelopmentFeatureId(requestedFeatureId);
  if (!featureId) notFound();
  const feature = await loadPublicDevelopmentFeature(featureId);
  if (!feature) notFound();

  return (
    <main className={styles.page}>
      <article className={styles.feature}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Carnival Development</span>
          <p className={styles.featureId}>{feature.featureId}</p>
          <h1>{feature.title}</h1>
        </header>

        <section className={styles.section} aria-labelledby="description-heading">
          <h2 id="description-heading">Description</h2>
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

        <section className={styles.section} aria-labelledby="dependencies-heading">
          <h2 id="dependencies-heading">Dependencies</h2>
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

        <section className={styles.section} aria-labelledby="notes-heading">
          <h2 id="notes-heading">Notes</h2>
          <p className={styles.longText}>{feature.notes || "No notes."}</p>
        </section>
      </article>
    </main>
  );
}
