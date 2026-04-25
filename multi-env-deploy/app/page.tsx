export const dynamic = "force-dynamic";

const ENV_BADGE: Record<string, { label: string; color: string }> = {
  production: { label: "PRODUCTION", color: "#d32f2f" },
  staging: { label: "STAGING", color: "#ed6c02" },
  dev: { label: "LOCAL", color: "#666" },
};

export default function Home() {
  const envName = process.env.DEPLOY_ENV ?? "dev";
  const sha = process.env.DEPLOY_SHA ?? "dev";
  const deployedAt = process.env.DEPLOY_TIMESTAMP ?? "local";
  const badge = ENV_BADGE[envName] ?? ENV_BADGE.dev;

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "3rem 1.5rem",
        maxWidth: "720px",
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "inline-block",
          padding: "0.25rem 0.75rem",
          borderRadius: "4px",
          background: badge.color,
          color: "#fff",
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          marginBottom: "1rem",
        }}
      >
        {badge.label}
      </div>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
        Multi-env Deploy Demo
      </h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>
        <code>develop</code> ブランチは staging、<code>main</code> ブランチは
        production。GitHub Environments のシークレットがブランチごとに別 VPS を指します。
      </p>

      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "1.5rem",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}
      >
        <Row label="Environment" value={envName} mono />
        <Row label="Commit" value={sha} mono />
        <Row label="Deployed at" value={deployedAt} mono />
      </div>
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
