import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { normalizeDevelopmentFeatureId } from "../../../domain/development-feature";
import {
  loadPublicDevelopmentComponent,
  loadPublicDevelopmentFeature,
  type PublicDevelopmentFeature,
} from "../../../lib/development/roadmap.server";
import styles from "./public-feature.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  description: "Shared read-only Carnival Development planning details.",
  robots: { follow: false, index: false },
  title: "Carnival Development Feature",
};

function formatUpdatedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

function FeaturePlanningDetails({ feature }: { feature: PublicDevelopmentFeature }) {
  return (
    <>
      <section className={styles.section} aria-label={`${feature.featureId} description`}>
        <h2>Description</h2>
        <p className={styles.longText}>{feature.description}</p>
      </section>

      <dl className={styles.details}>
        <div><dt>Status</dt><dd>{feature.status}</dd></div>
        <div><dt>Priority</dt><dd>{feature.priority}</dd></div>
        <div><dt>Sequence</dt><dd>{feature.sequence ?? "Unsequenced"}</dd></div>
        <div>
          <dt>Updated</dt>
          <dd><time dateTime={feature.updatedAt}>{formatUpdatedDate(feature.updatedAt)}</time></dd>
        </div>
      </dl>

      <section className={styles.section} aria-label={`${feature.featureId} dependencies`}>
        <h2>Dependencies</h2>
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
        <h2>Notes</h2>
        <p className={styles.longText}>{feature.notes || "No notes."}</p>
      </section>
    </>
  );
}

export default async function PublicDevelopmentFeaturePage({
  params,
}: {
  params: Promise<{ featureId: string }>;
}) {
  const { featureId: requestedFeatureId } = await params;
  const featureId = normalizeDevelopmentFeatureId(requestedFeatureId);
  if (!featureId) {
    const component = await loadPublicDevelopmentComponent(requestedFeatureId);
    if (!component) notFound();
    return (
      <main className={styles.page}>
        <section className={styles.component}>
          <header className={styles.componentHeader}>
            <span className={styles.eyebrow}>Carnival Development Component</span>
            <h1>{component.name}</h1>
            <p>{component.features.length} {component.features.length === 1 ? "feature" : "features"}</p>
          </header>
          <div className={styles.featureList}>
            {component.features.map((feature) => (
              <article className={styles.featureCard} key={feature.featureId}>
                <header className={styles.cardHeader}>
                  <p className={styles.featureId}>{feature.featureId}</p>
                  <h2>{feature.title}</h2>
                </header>
                <FeaturePlanningDetails feature={feature} />
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  }
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

        <dl className={styles.details}>
          <div><dt>Component</dt><dd>{feature.component}</dd></div>
        </dl>
        <FeaturePlanningDetails feature={feature} />
      </article>
    </main>
  );
}
