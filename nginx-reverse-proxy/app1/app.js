const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App 1 - Frontend</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem; background: #f5f5f5; color: #333; }
    h1 { margin-bottom: 1rem; }
    .card { background: #fff; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
    code { background: #e8e8e8; padding: 0.2rem 0.4rem; border-radius: 4px; }
    #result { margin-top: 1rem; }
    button { padding: 0.5rem 1.5rem; background: #1976d2; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
  </style>
</head>
<body>
  <h1>Nginx Reverse Proxy Demo</h1>
  <div class="card">
    <p>This page is served by <strong>App 1</strong> (Node.js) via <code>/</code></p>
  </div>
  <div class="card">
    <p>Click to call <strong>App 2</strong> (Python) via <code>/api/hello</code></p>
    <button onclick="callApi()">Call API</button>
    <div id="result"></div>
  </div>
  <div class="card">
    <p>Check proxy headers via <code>/debug/headers</code></p>
    <button onclick="debugHeaders()">Show Headers</button>
    <pre id="headers" style="margin-top:0.5rem;background:#222;color:#0f0;padding:1rem;border-radius:4px;overflow-x:auto;display:none"></pre>
  </div>
  <script>
    async function callApi() {
      const res = await fetch("/api/hello");
      const data = await res.json();
      document.getElementById("result").innerHTML =
        '<p style="margin-top:0.5rem">Response: <code>' + JSON.stringify(data) + '</code></p>';
    }
    async function debugHeaders() {
      const res = await fetch("/debug/headers");
      const data = await res.json();
      const el = document.getElementById("headers");
      el.style.display = "block";
      el.textContent = JSON.stringify(data, null, 2);
    }
  </script>
</body>
</html>`);
});

server.listen(3000, () => console.log("App 1 running on port 3000"));
