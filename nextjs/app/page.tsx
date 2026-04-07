interface Asset {
  name: string;
  download_count: number;
}

interface Release {
  tag_name: string;
  name: string;
  published_at: string;
  assets: Asset[];
}

async function getReleases(): Promise<Release[]> {
  const res = await fetch(
    "https://api.github.com/repos/crowdy/conoha-cli/releases",
    { next: { revalidate: 300 } }
  );
  if (!res.ok) return [];
  return res.json();
}

export default async function Home() {
  const releases = await getReleases();

  const totalDownloads = releases.reduce(
    (sum, r) => sum + r.assets.reduce((s, a) => s + a.download_count, 0),
    0
  );

  return (
    <main style={{ minHeight: "100vh", padding: "2rem", maxWidth: "960px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>
        conoha-cli Download Stats
      </h1>
      <p style={{ color: "#666", marginBottom: "2rem", fontSize: "0.9rem" }}>
        crowdy/conoha-cli GitHub Releases
      </p>

      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "2rem",
          marginBottom: "2rem",
          textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        }}
      >
        <div style={{ fontSize: "3.5rem", fontWeight: "bold", color: "#0070f3" }}>
          {totalDownloads.toLocaleString()}
        </div>
        <div style={{ color: "#666", marginTop: "0.25rem" }}>Total Downloads</div>
      </div>

      {releases.map((release) => {
        const releaseTotal = release.assets.reduce((s, a) => s + a.download_count, 0);
        return (
          <div
            key={release.tag_name}
            style={{
              background: "#fff",
              borderRadius: "8px",
              padding: "1.25rem",
              marginBottom: "1rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
              <div>
                <strong style={{ fontSize: "1.1rem" }}>{release.tag_name}</strong>
                <span style={{ color: "#999", marginLeft: "0.75rem", fontSize: "0.85rem" }}>
                  {new Date(release.published_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              <span style={{ fontWeight: "bold", color: "#0070f3" }}>
                {releaseTotal.toLocaleString()}
              </span>
            </div>
            {release.assets.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <tbody>
                  {release.assets.map((asset) => (
                    <tr key={asset.name} style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ padding: "0.4rem 0", color: "#555", fontFamily: "monospace", fontSize: "0.8rem" }}>
                        {asset.name}
                      </td>
                      <td style={{ padding: "0.4rem 0", textAlign: "right", fontWeight: 500 }}>
                        {asset.download_count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <p style={{ textAlign: "center", color: "#aaa", fontSize: "0.75rem", marginTop: "2rem" }}>
        Cached for 5 minutes &middot; Deployed with conoha app deploy
      </p>
    </main>
  );
}
