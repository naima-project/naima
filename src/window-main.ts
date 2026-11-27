// The window `naima ui` opens: the system's own webview (WebKit on macOS, WebKitGTK on Linux, WebView2 on Windows) on the
// UI's address, started by open.ts as a process of its own, since the window's loop holds the thread it runs on. Nothing is
// built or installed: the webview library's small native part is fetched once into Deno's cache. Closing the window ends it.
//
//   deno run --allow-ffi --allow-net --allow-read --allow-write --allow-env window-main.ts <url> <title>

import { Webview } from "jsr:@webview/webview@0.9.0"

const [url, title] = Deno.args
if (!url) {
  console.error("window-main: no address to open")
  Deno.exit(2)
}
const w = new Webview(false, { width: 1280, height: 860, hint: 0 })
w.title = title || "Naima"
w.navigate(url)
w.run()
