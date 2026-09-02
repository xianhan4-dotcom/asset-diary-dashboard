import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "web");
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const requestedPath = path.resolve(webRoot, `.${pathname}`);
    if (!requestedPath.startsWith(`${webRoot}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await fs.readFile(requestedPath);
    response.writeHead(200, {
      "content-type": types[path.extname(requestedPath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Asset Diary Dashboard: http://127.0.0.1:${port}`);
});
