import type { PageSummary } from "@skail-catalog-import/contracts";

/** A page with more than one attempt was written again: after a rejected write or a crash in the middle of it. */
export function PagesTable({ pages }: { pages: PageSummary[] }) {
  return (
    <section>
      <h2>Pages</h2>
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Products</th>
            <th>Duration</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.page} className={p.attempts > 1 ? "retried" : undefined}>
              <td>{p.page}</td>
              <td>{p.products ?? "rejected, retrying"}</td>
              <td>{p.durationMs === null ? "" : `${p.durationMs} ms`}</td>
              <td>{p.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Attempts counts the writes the target catalog received for the page. The pages imported before a crash stay at
        1, because they are not read again.
      </p>
    </section>
  );
}
