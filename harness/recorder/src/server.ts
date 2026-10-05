import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

export interface RecorderOptions {
  /** Directory the JSONL files are written to, one `<run>.jsonl` per run. */
  outDir: string;
  /** Static roots, keyed by URL prefix (the fixture page and the built library). */
  mounts: Record<string, string>;
  port?: number;
  /** Default 127.0.0.1. Set 0.0.0.0 only to reach the fixture from a phone on your network. */
  host?: string;
}

export interface Recorder {
  server: Server;
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** Run ids become file names, so anything else is rejected rather than sanitised. */
export function validRunId(run: string | null): run is string {
  return run !== null && /^[A-Za-z0-9._-]{1,64}$/.test(run) && !run.startsWith(".");
}

function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(
  mounts: Record<string, string>,
  pathname: string,
  res: ServerResponse,
): boolean {
  for (const [prefix, root] of Object.entries(mounts)) {
    if (pathname !== prefix && !pathname.startsWith(prefix === "/" ? "/" : `${prefix}/`)) continue;
    const rel = pathname.slice(prefix.length) || "/";
    const base = resolve(root);
    let file = normalize(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) continue;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) continue;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
    return true;
  }
  return false;
}

/** Local JSONL sink: POST /record?run=<id> appends one line per body; GET serves the mounts. */
export function startRecorder(opts: RecorderOptions): Promise<Recorder> {
  mkdirSync(opts.outDir, { recursive: true });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "POST" && url.pathname === "/record") {
      const run = url.searchParams.get("run");
      if (!validRunId(run)) {
        res.writeHead(400).end("bad run id");
        return;
      }
      try {
        const body = (await readBody(req)).trim();
        JSON.parse(body);
        await appendFile(join(opts.outDir, `${run}.jsonl`), `${body}\n`);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end("bad body");
      }
      return;
    }
    if (req.method === "GET" && serveStatic(opts.mounts, url.pathname, res)) return;
    res.writeHead(404).end("not found");
  });
  return new Promise((resolveStart) => {
    const host = opts.host ?? "127.0.0.1";
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolveStart({
        server,
        url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
