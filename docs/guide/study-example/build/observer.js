import { n as LOCK, t as CLIENTS } from "./shared.js";
// src/observer.svelte.ts
function holderOf(s) {
	return CLIENTS.find((c) => s.phase.at[c] === "HOLDING") ?? null;
}
function init(_config, s) {
	return {
		steps: 0,
		holder: holderOf(s),
		queue: [...s.queue],
		askedAt: {},
		waits: Object.fromEntries(CLIENTS.map((c) => [c, []])),
		messages: []
	};
}
function on(m, e) {
	const n = structuredClone(m);
	n.steps++;
	const who = String(e.input.args[0]);
	if (e.input.action === "ask") n.askedAt[who] = n.steps;
	n.messages.push({
		from: who,
		to: LOCK,
		label: e.input.phrase ?? e.input.action,
		title: e.input.label
	});
	for (const o of e.outputs) {
		const to = String(o.args[0]);
		if (o.action === "grant" && to in n.askedAt) {
			n.waits[to] = [...n.waits[to] ?? [], n.steps - n.askedAt[to]];
			delete n.askedAt[to];
		}
		n.messages.push({
			from: LOCK,
			to,
			label: o.phrase ?? o.action,
			title: o.label
		});
	}
	n.messages = n.messages.slice(-120);
	n.holder = holderOf(e.after);
	n.queue = [...e.after.queue];
	return n;
}
export { init, on };
