export const dynamic = "force-dynamic";

export default function Home() {
  const sha = process.env.DEPLOY_SHA ?? "dev";
  const deployedAt = process.env.DEPLOY_TIMESTAMP ?? "local";
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "3rem 1.5rem",
        maxWidth: "720px",
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
        GitOps Demo
      </h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>
        Deployed by a GitHub Actions workflow that invokes{" "}
        <code>conoha app deploy</code> from a self-hosted runner after a merge
        to <code>main</code>.
      </p>

      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "1.5rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        <Row label="Commit" value={sha} mono />
        <Row label="Deployed at" value={deployedAt} mono />
        <Row label="Runtime" value="Next.js standalone" />
      </div>

      <p style={{ marginTop: "2rem", color: "#999", fontSize: "0.8rem" }}>
        Merge to main to ship a new version.
      </p>
    </main>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "0.5rem 0",
        borderBottom: "1px solid #eee",
      }}
    >
      <span style={{ color: "#666" }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? "monospace" : "inherit",
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}
