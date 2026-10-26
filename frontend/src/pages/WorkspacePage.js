// UI-only feature boundary. Replace this empty state with a dedicated feature
// page when its API is implemented; do not put ETL business logic in the route map.
export default function WorkspacePage({ page }) {
  return (
    <>
      <div className="page-heading">
        <h1>{page.title}</h1>
        <p>{page.description}</p>
      </div>
      <section className="feature-empty" aria-labelledby="empty-title">
        <p className="nav-caption">{page.label}</p>
        <h2 id="empty-title">{page.emptyTitle}</h2>
        <p>{page.emptyDescription}</p>
        {page.action && <button className="button button-primary" type="button" disabled aria-describedby="feature-availability">{page.action}</button>}
        <p className="feature-availability" id="feature-availability">{page.availability}</p>
      </section>
    </>
  );
}
