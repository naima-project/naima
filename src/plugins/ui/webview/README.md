# Webview builds for older Linux

The window of `naima ui` (`src/window-main.ts`) uses the webview library that `jsr:@webview/webview` downloads. On Linux that library needs GTK 4, WebKitGTK 6
and glibc 2.33 or newer, so it does not start on Ubuntu 20.04 or 22.04. The libraries here are built from webview/webview 0.12.0 for GTK 3, and `../open.ts`
tries them, in this order, only when the downloaded one fails:

| Folder                | Built on     | Needs                                                      |
| --------------------- | ------------ | ---------------------------------------------------------- |
| `linux/gtk3-webkit41` | Ubuntu 22.04 | glibc 2.34, GTK 3, WebKit2GTK 4.1 (`libwebkit2gtk-4.1-0`)  |
| `linux/gtk3-webkit40` | Ubuntu 20.04 | glibc 2.14, GTK 3, WebKit2GTK 4.0 (`libwebkit2gtk-4.0-37`) |

The C++ runtime is linked in statically, so each library needs only glibc and the system's GTK and WebKitGTK. Only x86_64 is built so far.

To rebuild one on a Linux host with podman (or docker, with `CONTAINER=docker`):

```sh
sh build-linux.sh gtk3-webkit40 linux
```

To check one in a container that has only the runtime packages, under a virtual display:

```sh
sh try-old.sh ubuntu:20.04 "libwebkit2gtk-4.0-37 libgtk-3-0" linux/gtk3-webkit40 ../../../window-main.ts "$(command -v deno)"
```

It prints whether the downloaded library and this one keep a window up. On Ubuntu 20.04 and 22.04 the downloaded one ends at once and these stay up.
