// The view's module, as Naima's Models tab loads it: mount(target, host) returns { destroy }.
import { mount as mountSvelte, unmount } from "svelte";
import View from "./View.svelte";
import type { Host } from "./types.ts";

export function mount(target: HTMLElement, host: Host): { destroy(): void } {
  const app = mountSvelte(View, { target, props: { host } });
  return { destroy: () => void unmount(app) };
}
