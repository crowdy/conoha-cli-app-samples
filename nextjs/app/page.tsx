export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
      }}
    >
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>
          Next.js on ConoHa
        </h1>
        <p style={{ fontSize: "1.2rem", color: "#666" }}>
          Deployed with <code>conoha app deploy</code>
        </p>
      </div>
    </main>
  );
}
