export async function GET() {
  const apiUrl = process.env.API_URL || "http://api:8080";
  const res = await fetch(`${apiUrl}/ucp/manifest`);
  const data = await res.json();
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
