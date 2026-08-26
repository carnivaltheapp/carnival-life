export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Carnival PlayHouse home">
          <span className="brandMark" aria-hidden="true">
            C
          </span>
          <span>Carnival PlayHouse</span>
        </a>
        <span className="phaseBadge">Phase 0</span>
      </header>

      <section className="hero" id="main-content">
        <div className="heroCopy">
          <p className="eyebrow">Welcome to Carnival Life</p>
          <h1>Carnival PlayHouse</h1>
          <p className="lede">
            A new home for the things you want and need to do, built to make
            room for more of what matters.
          </p>
          <div className="status" role="status">
            <span className="statusDot" aria-hidden="true" />
            Application shell ready
          </div>
        </div>

        <aside className="preview" aria-label="PlayHouse preview">
          <div className="previewHeader">
            <span>Today</span>
            <span className="previewDate">PlayHouse is taking shape</span>
          </div>
          <div className="emptyState">
            <span className="spark" aria-hidden="true">
              ✦
            </span>
            <h2>Your Plays will live here.</h2>
            <p>
              This first shell verifies routing, responsive styling, PWA
              metadata, and deployment. Play management arrives in Phase 1.
            </p>
          </div>
        </aside>
      </section>

      <footer>
        <span>Carnival Life</span>
        <span>Make room for what matters.</span>
      </footer>
    </main>
  );
}
