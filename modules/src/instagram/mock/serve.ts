import { createServer, type Server } from "node:http";
import type { MockGraphApi } from "./graph-mock";

/**
 * Serves the mock Graph API over HTTP (plan 13 §13.4): the E2E server points
 * `INSTAGRAM_GRAPH_BASE_URL` at it. Resolves with the server and its base URL.
 */
export function serveMockGraphApi(
  mock: MockGraphApi,
  port = 0,
): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const host = req.headers.host ?? "localhost";
    const request = new Request(`http://${host}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers: req.headers as Record<string, string>,
      ...(chunks.length > 0 && req.method !== "GET" ? { body: Buffer.concat(chunks) } : {}),
    });
    try {
      const response = await mock.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
    } catch {
      // A dropped connection: the caller sees no answer.
      res.destroy();
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
