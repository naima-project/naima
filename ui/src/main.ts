// Mounts the app: the store is made once, here, and handed to every component through the context.
import { mount } from "svelte";
import "./fonts/inter.css";
import "./lib/ui/tokens.css";
import { storeContext } from "./lib/ui/store/store.svelte.ts";
import App from "./App.svelte";
import { makeStore } from "./app.svelte.ts";

mount(App, { target: document.getElementById("app")!, context: storeContext(makeStore()) });
