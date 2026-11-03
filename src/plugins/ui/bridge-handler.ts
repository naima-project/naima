// The platform bridge's contract over HTTP, as one request handler built only on the web's own Request, Response and
// streams: it runs on Deno, Node and Bun alike and imports nothing, so a backend on any of them can mount it.
//
//   POST <prefix>/<command>   body: the arguments as a JSON object
//     200 {"ok": <answer>}    the command's answer
//     404 {"error": "..."}    no such command
//     400 {"error": "..."}    the body is not a JSON object
//     500 {"error": "..."}    the command threw
//   GET  <prefix>/<feed>      a stream of server-sent events, one `data: <JSON>` per event the feed emits, until the
//                             client goes; 404 when there is no such feed, 405 for a command
//   anything else             `otherwise`, or 404
//
// The handlers and feeds are the same shape as the ones the page's localBridge runs, so a command or a feed can move
// from the page to the server without the machines noticing. platform/server.ts mounts it on Deno with the built page.
//
// Until this release the bridge was called the platform port, and its commands lived at /port/. Without a prefix
// given, the handler still answers there too, for one more release.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Handlers = { [command: string]: (args: { [key: string]: Json }) => Json | Promise<Json> };
/** A feed: it starts emitting when a client listens, and stops when the function it returns is called. */
export type Feeds = { [feed: string]: (emit: (event: Json) => void) => () => void };

export interface BridgeHandlerOptions {
  handlers: Handlers;
  feeds?: Feeds;
  /** Where the bridge's commands and feeds live, /bridge by default; the page's webBridge is given the same. */
  prefix?: string;
  /** What answers every other request: the built page, say. */
  otherwise?: (req: Request) => Response | Promise<Response>;
}

/** The prefix the bridge's commands lived at when it was called the port; answered for one more release. */
const LEGACY_PREFIX = "/port";

/** How often a feed's stream sends a comment, so that nothing between drops a silent connection. */
const KEEP_ALIVE_MS = 15_000;

const json = (status: number, body: { ok: Json } | { error: string }) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A feed as a stream of server-sent events: the feed starts with the stream and stops when the client goes. */
function eventStream(feed: Feeds[string]): Response {
  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // the client went between two events: cancel stops the feed
        }
      };
      send(": bridge feed\n\n");
      const alive = setInterval(() => send(": keep-alive\n\n"), KEEP_ALIVE_MS);
      const end = feed((event) => send(`data: ${JSON.stringify(event)}\n\n`));
      stop = () => {
        clearInterval(alive);
        end();
      };
    },
    cancel() {
      stop();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}

/** The bridge's request handler, apart from any server, so that it can be tested and mounted anywhere. */
export function bridgeHandler(options: BridgeHandlerOptions): (req: Request) => Promise<Response> {
  const prefixes = options.prefix === undefined ? ["/bridge", LEGACY_PREFIX] : [options.prefix.replace(/\/+$/, "")];
  const feeds = options.feeds ?? {};
  return async (req) => {
    const path = new URL(req.url).pathname;
    const prefix = prefixes.find((p) => path.startsWith(p + "/"));
    if (prefix === undefined) {
      return options.otherwise ? options.otherwise(req) : new Response("not found", { status: 404 });
    }
    const name = decodeURIComponent(path.slice(prefix.length + 1));
    if (req.method === "GET") {
      const feed = Object.hasOwn(feeds, name) ? feeds[name] : undefined;
      if (feed) return eventStream(feed);
      if (Object.hasOwn(options.handlers, name)) {
        return json(405, { error: `${name} is a command: the bridge takes POST` });
      }
      return json(404, { error: `no such feed: ${name}` });
    }
    if (req.method !== "POST") return json(405, { error: "the bridge takes POST" });
    const handler = Object.hasOwn(options.handlers, name) ? options.handlers[name] : undefined;
    if (!handler) return json(404, { error: `no such command: ${name}` });
    let args: unknown;
    try {
      const text = await req.text();
      args = text.trim() ? JSON.parse(text) : {};
    } catch {
      return json(400, { error: "the body is not JSON" });
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      return json(400, { error: "the arguments are not a JSON object" });
    }
    try {
      return json(200, { ok: await handler(args as { [key: string]: Json }) });
    } catch (e) {
      return json(500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}
