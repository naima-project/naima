import { A as template_effect, B as push, C as comment, D as delegate, E as text, F as sibling, I as set, L as state, M as child, N as first_child, O as delegated, P as only_child, R as user_derived, S as append, T as from_svg, V as reset, _ as index, a as prop, b as set_text, c as bind_element_size, d as set_attribute, f as set_style, g as each, h as snippet, i as onMount, j as user_effect, k as get, l as CLASS, m as append_styles, n as LOCK, o as rest_props, p as set_class, r as at, s as bind_this, t as CLIENTS, u as attribute_effect, v as if_block, w as from_html, x as unmount, y as mount$1, z as pop } from "./shared.js";
// node_modules/.deno/svelte@5.57.3/node_modules/svelte/src/internal/disclose-version.js
if (typeof window !== "undefined") ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add("5");
// ../../../../src/plugins/verifier-mcrl2/widgets/ui/components/Pannable.svelte
var rest_excludes = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy",
	"label",
	"ignore",
	"box",
	"width",
	"slide",
	"onslide",
	"onpan",
	"onpanstart",
	"onpanend",
	"onpinch",
	"children",
	"class"
]);
var root$3 = from_html(`<div><!></div>`);
var $$css$3 = {
	hash: "svelte-1gg7oec",
	code: ".pannable.svelte-1gg7oec {overflow-x:auto;min-width:0;max-width:100%;cursor:grab;user-select:none;-webkit-user-select:none;}.pannable.panning.svelte-1gg7oec {cursor:grabbing;}"
};
function Pannable($$anchor, $$props) {
	push($$props, true);
	append_styles($$anchor, $$css$3);
	/** What the box shows, as people call it: the box is a region named after it. */
	/** A selector: a press on an element inside it never pans. */
	/** The scrolling box, for its owner to scroll or measure. */
	/** The box's width in CSS px, as it measures it. */
	/** A selector: a press on an element inside it slides that handle instead of panning, reported through onslide. */
	/** The pointer's x in client px while a handle slides: at the press, at each move, at the release. */
	/** For a box that does not scroll but whose owner moves a window over its content (a zoomed time axis): a drag by
	* any pointer reports the horizontal travel since the last report, in CSS px, instead of scrolling the box. The
	* owner gives the keys and the wheel that move it as far, and sets touch-action: none on what the drag starts on. */
	/** A pan starts (the pointer travelled past the slop), and ends (released, or a pinch began). */
	/** Two pointers pinch the box: their distance before over after a move, and their middle's x in client px. */
	let box = prop($$props, "box", 15), width = prop($$props, "width", 15, 0), cls = prop($$props, "class", 3, ""), rest = rest_props($$props, rest_excludes);
	/** The pointers down on the box, while a pinch may start: their last place. */
	const down = /* @__PURE__ */ new Map();
	/** The pinch under way: the two pointers' last distance. */
	let pinch = null;
	const spread = () => {
		const [a, b] = [...down.values()];
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
	};
	/** The pointer sliding a handle, while it does. */
	let sliding = null;
	/** How far a press may travel, in CSS px, and still be a click. */
	const SLOP = 4;
	/** Where the press started and the box's scroll then, while a press lasts: this component's own UI state. */
	let from = null;
	let panning = state(false);
	/** Where the pointer was at the last report to onpan. */
	let last = 0;
	let swallow = false;
	function onpointerdown(event) {
		if ($$props.onpinch) {
			down.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY
			});
			if (down.size === 2) {
				if (get(panning)) $$props.onpanend?.();
				from = null;
				set(panning, false);
				pinch = spread();
				for (const id of down.keys()) try {
					box()?.setPointerCapture(id);
				} catch {}
				return;
			}
		}
		if ($$props.slide && $$props.onslide && event.button === 0 && event.target.closest?.($$props.slide)) {
			event.preventDefault();
			sliding = event.pointerId;
			try {
				box()?.setPointerCapture(event.pointerId);
			} catch {}
			$$props.onslide(event.clientX, "start");
			return;
		}
		if (event.pointerType !== "mouse" && !$$props.onpan || event.button !== 0) return;
		if ($$props.ignore && event.target.closest?.($$props.ignore)) return;
		from = {
			x: event.clientX,
			y: event.clientY,
			left: box()?.scrollLeft ?? 0,
			id: event.pointerId
		};
		last = event.clientX;
	}
	function onpointermove(event) {
		if (pinch !== null && down.has(event.pointerId)) {
			down.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY
			});
			const d = spread();
			if (d > 0 && pinch > 0) {
				const [a, b] = [...down.values()];
				$$props.onpinch?.(pinch / d, ((a?.x ?? 0) + (b?.x ?? 0)) / 2);
			}
			pinch = d;
			return;
		}
		if (sliding !== null) {
			if (event.pointerId === sliding) $$props.onslide?.(event.clientX, "move");
			return;
		}
		if (!from || event.pointerId !== from.id || !box()) return;
		const dx = event.clientX - from.x;
		if (!get(panning) && Math.hypot(dx, event.clientY - from.y) < SLOP) return;
		if (!get(panning)) {
			set(panning, true);
			box().setPointerCapture(event.pointerId);
			if ($$props.onpan) $$props.onpanstart?.();
		}
		if ($$props.onpan) {
			$$props.onpan(event.clientX - last);
			last = event.clientX;
		} else box(box().scrollLeft = from.left - dx, true);
	}
	function onpointerup(event) {
		if (down.delete(event.pointerId) && pinch !== null) {
			if (down.size < 2) pinch = null;
			swallow = true;
			from = null;
			return;
		}
		if (sliding !== null) {
			if (event.pointerId !== sliding) return;
			sliding = null;
			$$props.onslide?.(event.clientX, "end");
			return;
		}
		if (!from || event.pointerId !== from.id) return;
		swallow = get(panning);
		if (get(panning) && $$props.onpan) $$props.onpanend?.();
		from = null;
		set(panning, false);
	}
	function onclickcapture(event) {
		if (!swallow) return;
		swallow = false;
		event.stopPropagation();
		event.preventDefault();
	}
	var div = root$3();
	attribute_effect(div, () => ({
		...rest,
		class: `pannable ${cls() ?? ""}`,
		role: "region",
		"aria-label": $$props.label,
		onpointerdown,
		onpointermove,
		onpointerup,
		onpointercancel: onpointerup,
		onclickcapture,
		[CLASS]: { panning: get(panning) }
	}), void 0, void 0, void 0, "svelte-1gg7oec");
	var node = child(div);
	snippet(node, () => $$props.children);
	reset(div);
	bind_this(div, ($$value) => box($$value), () => box());
	bind_element_size(div, "clientWidth", width);
	append($$anchor, div);
	pop();
}
// ../../../../src/plugins/verifier-mcrl2/widgets/study/layout.ts
var unit = (dx, dy) => {
	const d = Math.hypot(dx, dy);
	return d > 1e-9 ? [dx / d, dy / d] : [1, 0];
};
var LOOP_OUT0 = unit(-.6, -1);
var LOOP_OUT1 = unit(.6, -1);
function layout(nodes, edges, opts = {}) {
	const horizontal = (opts.direction ?? "horizontal") === "horizontal";
	const layerGap = opts.layerGap ?? 56;
	const nodeGap = opts.nodeGap ?? 28;
	const margin = opts.margin ?? 20;
	const n = nodes.length;
	const nd = (v) => nodes[v];
	const ge = (i) => edges[i];
	const base = nodes.map((_, i) => i);
	if (opts.order) {
		const cmp = opts.order;
		base.sort((a, b) => cmp(nd(a).id, nd(b).id) || a - b);
	}
	const seq = new Array(n).fill(0);
	base.forEach((v, k) => seq[v] = k);
	const index = /* @__PURE__ */ new Map();
	nodes.forEach((x, i) => {
		if (!index.has(x.id)) index.set(x.id, i);
	});
	const fsOf = (v) => horizontal ? nd(v).width : nd(v).height;
	const csOf = (v) => horizontal ? nd(v).height : nd(v).width;
	const labelF = (i) => (horizontal ? ge(i).labelWidth : ge(i).labelHeight) ?? 0;
	const labelC = (i) => (horizontal ? ge(i).labelHeight : ge(i).labelWidth) ?? 0;
	const all = [];
	edges.forEach((e, i) => {
		const s = index.get(e.from), t = index.get(e.to);
		if (s !== void 0 && t !== void 0) all.push({
			i,
			s,
			t
		});
	});
	const loops = all.filter((e) => e.s === e.t);
	const links = all.filter((e) => e.s !== e.t);
	const out = nodes.map(() => []);
	links.forEach((e, k) => out[e.s].push(k));
	const reversed = new Array(links.length).fill(false);
	{
		const state = new Array(n).fill(0);
		for (const r of base) {
			if (state[r]) continue;
			state[r] = 1;
			const stack = [[r, 0]];
			while (stack.length) {
				const top = stack[stack.length - 1];
				const v = top[0];
				const outs = out[v];
				if (top[1] < outs.length) {
					const k = outs[top[1]++];
					const w = links[k].t;
					if (state[w] === 1) reversed[k] = true;
					else if (!state[w]) {
						state[w] = 1;
						stack.push([w, 0]);
					}
				} else {
					state[v] = 2;
					stack.pop();
				}
			}
		}
	}
	const dagIn = nodes.map(() => []);
	const dagOut = nodes.map(() => []);
	links.forEach((e, k) => {
		const [a, b] = reversed[k] ? [e.t, e.s] : [e.s, e.t];
		dagOut[a].push(b);
		dagIn[b].push(a);
	});
	const forced = nodes.map((x) => {
		const r = opts.rank?.[x.id];
		return typeof r === "number" && Number.isFinite(r) ? Math.round(r) : void 0;
	});
	const topo = [];
	{
		const deg = dagIn.map((l) => l.length);
		const queue = base.filter((v) => deg[v] === 0);
		for (let q = 0; q < queue.length; q++) {
			const v = queue[q];
			topo.push(v);
			for (const w of dagOut[v]) if (--deg[w] === 0) queue.push(w);
		}
	}
	const rank = new Array(n).fill(0);
	const r = (v) => rank[v];
	for (const v of topo) rank[v] = forced[v] ?? dagIn[v].reduce((m, u) => Math.max(m, r(u) + 1), 0);
	for (let pass = 0; pass < 8; pass++) {
		let moved = false;
		for (const v of topo) {
			if (forced[v] !== void 0) continue;
			const lo = dagIn[v].reduce((m, u) => Math.max(m, r(u) + 1), -Infinity);
			const hi = dagOut[v].reduce((m, u) => Math.min(m, r(u) - 1), Infinity);
			const d = dagIn[v].length - dagOut[v].length;
			const want = d > 0 ? lo : d < 0 ? hi : r(v);
			if (Number.isFinite(want) && want !== r(v) && want >= lo && want <= hi) {
				rank[v] = want;
				moved = true;
			}
		}
		if (!moved) break;
	}
	if (n) {
		const min = Math.min(...rank);
		for (let v = 0; v < n; v++) rank[v] = r(v) - min;
	}
	const lr = (v) => r(v) * 2;
	const layerCount = n ? Math.max(...rank) * 2 + 1 : 0;
	const V = nodes.map((_, v) => ({
		layer: lr(v),
		real: true,
		fs: fsOf(v),
		lo: csOf(v) / 2,
		hi: csOf(v) / 2,
		up: [],
		down: []
	}));
	const vn = (v) => V[v];
	const routes = [];
	for (const e of links) {
		const rs = lr(e.s), rt = lr(e.t);
		if (rs === rt) {
			routes.push({
				e,
				back: false,
				flat: true,
				chain: [e.s, e.t],
				labelNode: -1
			});
			continue;
		}
		const back = rs > rt;
		const [a, b] = back ? [e.t, e.s] : [e.s, e.t];
		const span = Math.abs(rt - rs);
		const lf = labelF(e.i), lc = labelC(e.i);
		const labelAt = lf > 0 || lc > 0 ? 2 * Math.floor((span - 2) / 4) : -1;
		const chain = [a];
		let labelNode = -1;
		for (let k = 0; k < span - 1; k++) {
			const x = {
				layer: lr(a) + 1 + k,
				real: false,
				fs: 0,
				lo: 0,
				hi: 0,
				up: [],
				down: []
			};
			if (k === labelAt) {
				x.fs = lf;
				x.lo = lc + 8;
				labelNode = V.length;
			}
			chain.push(V.length);
			V.push(x);
		}
		chain.push(b);
		for (let k = 0; k + 1 < chain.length; k++) {
			const u = chain[k], w = chain[k + 1];
			const virtuals = (vn(u).real ? 0 : 1) + (vn(w).real ? 0 : 1);
			const wt = virtuals === 2 ? 8 : virtuals === 1 ? 2 : 1;
			vn(u).down.push({
				u: w,
				w: wt
			});
			vn(w).up.push({
				u,
				w: wt
			});
		}
		routes.push({
			e,
			back,
			flat: false,
			chain,
			labelNode
		});
	}
	const shapeOf = (v) => nd(v).shape ?? "rect";
	const border = (v, center, toward) => {
		const a = fsOf(v) / 2, b = csOf(v) / 2;
		let dx = toward[0] - center[0], dy = toward[1] - center[1];
		if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) [dx, dy] = [1, 0];
		if (a <= 0 || b <= 0) return [center[0], center[1]];
		const t = shapeOf(v) === "circle" ? 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2) : Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
		return [center[0] + dx * t, center[1] + dy * t];
	};
	const loopGeom = (v, k, center) => {
		const fs = fsOf(v), cs = csOf(v);
		const L = (Math.max(22, .5 * Math.min(fs, cs)) + 14 * k) * 1.3;
		const spread = .35 * (1 + k * .4) * Math.max(fs, 1);
		const p0 = border(v, center, [center[0] - spread, center[1] - cs]);
		const p1 = border(v, center, [center[0] + spread, center[1] - cs]);
		return [
			p0,
			[p0[0] + LOOP_OUT0[0] * L, p0[1] + LOOP_OUT0[1] * L],
			[p1[0] + LOOP_OUT1[0] * L, p1[1] + LOOP_OUT1[1] * L],
			p1
		];
	};
	{
		const k = new Array(n).fill(0);
		for (const e of loops) {
			const g = loopGeom(e.s, k[e.s], [0, 0]);
			k[e.s] = k[e.s] + 1;
			const reach = -Math.min(...g.map((p) => p[1])) + labelC(e.i) + 6;
			vn(e.s).lo = Math.max(vn(e.s).lo, reach);
		}
	}
	const layers = Array.from({ length: layerCount }, () => []);
	const lay = (l) => layers[l];
	const ord = new Array(V.length).fill(0);
	const o = (v) => ord[v];
	const renumber = (L) => L.forEach((v, i) => ord[v] = i);
	const incremental = opts.incremental ?? false;
	if (incremental) {
		const placedV = new Array(V.length).fill(false);
		const insert = (x) => {
			const l = vn(x).layer;
			const L = lay(l);
			const mine = [...vn(x).up, ...vn(x).down].filter((d) => placedV[d.u]);
			const cost = new Array(L.length + 2).fill(0);
			for (const d of mine) {
				const p = o(d.u), nl = vn(d.u).layer;
				L.forEach((y, j) => {
					for (const e of nl < l ? vn(y).up : vn(y).down) {
						if (!placedV[e.u]) continue;
						const q = o(e.u);
						if (q > p) cost[j + 1] = cost[j + 1] + d.w * e.w;
						else if (q < p) {
							cost[0] = cost[0] + d.w * e.w;
							cost[j + 1] = cost[j + 1] - d.w * e.w;
						}
					}
				});
			}
			const mean = (ds) => {
				const ps = ds.filter((d) => placedV[d.u]).map((d) => o(d.u) / Math.max(lay(vn(d.u).layer).length, 1));
				return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : void 0;
			};
			const mx = mean(mine);
			let target = L.length;
			if (mx !== void 0) {
				target = 0;
				L.forEach((y, j) => {
					const my = mean([...vn(y).up, ...vn(y).down]);
					if (my !== void 0 && my <= mx) target = j + 1;
				});
			}
			let best = -1, bestCost = Infinity, run = 0;
			for (let s = 0; s <= L.length; s++) {
				run += cost[s];
				if (run < bestCost || run === bestCost && Math.abs(s - target) <= Math.abs(best - target)) {
					best = s;
					bestCost = run;
				}
			}
			L.splice(best, 0, x);
			renumber(L);
			placedV[x] = true;
		};
		const byNode = nodes.map(() => []);
		for (const rt of routes) {
			if (rt.flat) continue;
			byNode[rt.e.s].push(rt);
			byNode[rt.e.t].push(rt);
		}
		const routed = /* @__PURE__ */ new Set();
		for (const v of base) {
			for (const rt of byNode[v]) {
				const other = rt.e.s === v ? rt.e.t : rt.e.s;
				if (routed.has(rt) || !placedV[other]) continue;
				routed.add(rt);
				const inner = rt.chain.slice(1, -1);
				for (const x of rt.chain[0] === v ? inner.reverse() : inner) insert(x);
			}
			insert(v);
		}
	} else {
		const seen = new Array(V.length).fill(false);
		const roots = base.slice().sort((a, b) => r(a) - r(b) || seq[a] - seq[b]);
		for (const root of roots) {
			if (seen[root]) continue;
			seen[root] = true;
			lay(vn(root).layer).push(root);
			const stack = [[root, 0]];
			while (stack.length) {
				const top = stack[stack.length - 1];
				const ds = vn(top[0]).down;
				if (top[1] >= ds.length) {
					stack.pop();
					continue;
				}
				const u = ds[top[1]++].u;
				if (seen[u]) continue;
				seen[u] = true;
				lay(vn(u).layer).push(u);
				stack.push([u, 0]);
			}
		}
		layers.forEach(renumber);
	}
	const crossBetween = (l) => {
		const segs = [];
		for (const u of lay(l)) for (const d of vn(u).down) segs.push([
			o(u),
			o(d.u),
			d.w
		]);
		segs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
		const size = lay(l + 1).length;
		const tree = new Array(size + 1).fill(0);
		let total = 0, sum = 0;
		for (const [, b, w] of segs) {
			let le = 0;
			for (let i = b + 1; i > 0; i -= i & -i) le += tree[i];
			total += w * (sum - le);
			for (let i = b + 1; i <= size; i += i & -i) tree[i] = tree[i] + w;
			sum += w;
		}
		return total;
	};
	const crossings = () => {
		let c = 0;
		for (let l = 0; l + 1 < layerCount; l++) c += crossBetween(l);
		return c;
	};
	const sortLayer = (l, fromUp) => {
		const L = lay(l);
		const near = (v) => fromUp ? vn(v).up : vn(v).down;
		const keyed = [];
		L.forEach((v, i) => {
			let s = 0, ws = 0;
			for (const d of near(v)) {
				s += o(d.u) * d.w;
				ws += d.w;
			}
			if (ws) keyed.push({
				v,
				b: s / ws,
				i
			});
		});
		keyed.sort((x, y) => x.b - y.b || x.i - y.i);
		let k = 0;
		const res = L.map((v) => near(v).length ? keyed[k++].v : v);
		layers[l] = res;
		renumber(res);
	};
	const pairCross = (v, w) => {
		let c = 0;
		for (const a of vn(v).up) for (const b of vn(w).up) if (o(a.u) > o(b.u)) c += a.w * b.w;
		for (const a of vn(v).down) for (const b of vn(w).down) if (o(a.u) > o(b.u)) c += a.w * b.w;
		return c;
	};
	const transpose = () => {
		for (let round = 0; round < 6; round++) {
			let improved = false;
			for (const L of layers) for (let i = 0; i + 1 < L.length; i++) {
				const v = L[i], w = L[i + 1];
				if (pairCross(w, v) < pairCross(v, w)) {
					L[i] = w;
					L[i + 1] = v;
					ord[w] = i;
					ord[v] = i + 1;
					improved = true;
				}
			}
			if (!improved) break;
		}
	};
	if (!incremental) {
		let bestC = crossings();
		let best = layers.map((L) => L.slice());
		let stale = 0;
		for (let it = 0; it < 24 && bestC > 0; it++) {
			if (it % 2 === 0) for (let l = 1; l < layerCount; l++) sortLayer(l, true);
			else for (let l = layerCount - 2; l >= 0; l--) sortLayer(l, false);
			transpose();
			const c = crossings();
			if (c < bestC) {
				bestC = c;
				best = layers.map((L) => L.slice());
				stale = 0;
			} else if (++stale >= 4) break;
		}
		best.forEach((L, l) => layers[l] = L);
		layers.forEach(renumber);
	}
	const C = new Array(V.length).fill(0);
	const c = (v) => C[v];
	const sep = (a, b) => vn(a).hi + vn(b).lo + (vn(a).real && vn(b).real ? nodeGap : nodeGap / 2);
	{
		const N = V.length;
		const conflicts = /* @__PURE__ */ new Set();
		const key = (a, b) => a < b ? a * N + b : b * N + a;
		for (let l = 1; l < layerCount; l++) {
			const prev = lay(l - 1), L = lay(l);
			let k0 = 0, scan = 0;
			L.forEach((v, i) => {
				const inner = vn(v).real ? void 0 : vn(v).up.find((d) => !vn(d.u).real);
				const k1 = inner ? o(inner.u) : prev.length;
				if (inner || i === L.length - 1) {
					for (const s of L.slice(scan, i + 1)) for (const d of vn(s).up) {
						const p = o(d.u);
						if ((p < k0 || k1 < p) && !(!vn(d.u).real && !vn(s).real)) conflicts.add(key(d.u, s));
					}
					scan = i + 1;
					k0 = k1;
				}
			});
		}
		const runs = [];
		for (const fromUp of [true, false]) for (const fromLeft of [true, false]) {
			let order = fromUp ? layers : layers.slice().reverse();
			if (!fromLeft) order = order.map((L) => L.slice().reverse());
			const pos = new Array(N).fill(0);
			const root = new Array(N).fill(0).map((_, v) => v);
			const align = root.slice();
			for (const L of order) L.forEach((v, i) => pos[v] = i);
			for (const L of order) {
				let last = -1;
				for (const v of L) {
					const ws = (fromUp ? vn(v).up : vn(v).down).map((d) => d.u).sort((a, b) => pos[a] - pos[b]);
					if (!ws.length) continue;
					const mp = (ws.length - 1) / 2;
					for (let i = Math.floor(mp); i <= Math.ceil(mp); i++) {
						const w = ws[i];
						if (align[v] === v && last < pos[w] && !conflicts.has(key(v, w))) {
							align[w] = v;
							align[v] = root[v] = root[w];
							last = pos[w];
						}
					}
				}
			}
			const gap = (u, v) => (fromLeft ? vn(u).hi + vn(v).lo : vn(u).lo + vn(v).hi) + (vn(u).real && vn(v).real ? nodeGap : nodeGap / 2);
			const succ = /* @__PURE__ */ new Map();
			const indeg = new Array(N).fill(0);
			for (const L of order) for (let i = 1; i < L.length; i++) {
				const a = root[L[i - 1]], b = root[L[i]];
				const m = succ.get(a) ?? /* @__PURE__ */ new Map();
				if (!m.has(b)) indeg[b] = indeg[b] + 1;
				m.set(b, Math.max(m.get(b) ?? 0, gap(L[i - 1], L[i])));
				succ.set(a, m);
			}
			const topoB = root.filter((x, v) => x === v).filter((v) => indeg[v] === 0);
			for (let q = 0; q < topoB.length; q++) for (const b of succ.get(topoB[q])?.keys() ?? []) if ((indeg[b] = indeg[b] - 1) === 0) topoB.push(b);
			const xs = new Array(N).fill(0);
			for (const a of topoB) for (const [b, w] of succ.get(a) ?? []) xs[b] = Math.max(xs[b], xs[a] + w);
			for (let q = topoB.length - 1; q >= 0; q--) {
				const a = topoB[q];
				let min = Infinity;
				for (const [b, w] of succ.get(a) ?? []) min = Math.min(min, xs[b] - w);
				if (min !== Infinity) xs[a] = Math.max(xs[a], min);
			}
			runs.push(root.map((x) => fromLeft ? xs[x] : -xs[x]));
		}
		const span = (xs) => {
			let lo = Infinity, hi = -Infinity;
			xs.forEach((x, v) => {
				lo = Math.min(lo, x - vn(v).lo);
				hi = Math.max(hi, x + vn(v).hi);
			});
			return [lo, hi];
		};
		const widths = runs.map((xs) => span(xs)[1] - span(xs)[0]);
		const narrow = runs[widths.indexOf(Math.min(...widths))];
		const [nlo, nhi] = span(narrow);
		runs.forEach((xs, k) => {
			const [lo, hi] = span(xs);
			const delta = k % 2 === 0 ? nlo - lo : nhi - hi;
			for (let v = 0; v < N; v++) xs[v] = xs[v] + delta;
		});
		for (let v = 0; v < N; v++) {
			const s = runs.map((xs) => xs[v]).sort((a, b) => a - b);
			C[v] = N ? (s[1] + s[2]) / 2 : 0;
		}
	}
	const place = (L) => {
		const m = L.length;
		if (!m) return;
		const off = new Array(m).fill(0);
		for (let i = 1; i < m; i++) off[i] = off[i - 1] + sep(L[i - 1], L[i]);
		const blocks = [];
		L.forEach((v, i) => {
			const w = 1;
			blocks.push({
				w,
				s: w * (c(v) - off[i]),
				n: 1
			});
			while (blocks.length > 1) {
				const p = blocks[blocks.length - 2], q = blocks[blocks.length - 1];
				if (p.s / p.w <= q.s / q.w) break;
				blocks.pop();
				p.w += q.w;
				p.s += q.s;
				p.n += q.n;
			}
		});
		let i = 0;
		for (const b of blocks) for (let j = 0; j < b.n; j++, i++) C[L[i]] = b.s / b.w + off[i];
	};
	layers.forEach(place);
	const F = new Array(V.length).fill(0);
	{
		const size = layers.map((L) => L.reduce((m, v) => Math.max(m, vn(v).fs), 0));
		let f = 0;
		layers.forEach((L, l) => {
			if (l) f += size[l - 1] / 2 + layerGap / 2 + size[l] / 2;
			for (const v of L) F[v] = f;
		});
	}
	const at = (v) => [F[v], C[v]];
	const drawn = [];
	const curve = (anchors, tangents, flowAligned) => {
		const A = (k) => anchors[k];
		const m = anchors.length;
		const tan = anchors.map((_, k) => tangents[k] ?? (k === 0 ? unit(A(1)[0] - A(0)[0], A(1)[1] - A(0)[1]) : unit(A(k)[0] - A(k - 1)[0], A(k)[1] - A(k - 1)[1])));
		const pts = [A(0)];
		for (let k = 0; k + 1 < m; k++) {
			const a = A(k), b = A(k + 1), ta = tan[k], tb = tan[k + 1];
			const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
			const h0 = flowAligned[k] ? Math.abs(b[0] - a[0]) * .5 : d * .4;
			const h1 = flowAligned[k + 1] ? Math.abs(b[0] - a[0]) * .5 : d * .4;
			pts.push([a[0] + ta[0] * h0, a[1] + ta[1] * h0], [b[0] - tb[0] * h1, b[1] - tb[1] * h1], b);
		}
		return pts;
	};
	const clearance = (tangent, i) => Math.abs(tangent[1]) * labelF(i) / 2 + Math.abs(tangent[0]) * labelC(i) / 2 + 4;
	const bez = (p, k, t) => {
		const a = p[3 * k], b = p[3 * k + 1], cc = p[3 * k + 2], d = p[3 * k + 3];
		const s = 1 - t;
		const pt = (j) => s * s * s * a[j] + 3 * s * s * t * b[j] + 3 * s * t * t * cc[j] + t * t * t * d[j];
		const tg = (j) => 3 * s * s * (b[j] - a[j]) + 6 * s * t * (cc[j] - b[j]) + 3 * t * t * (d[j] - cc[j]);
		return {
			at: [pt(0), pt(1)],
			tan: unit(tg(0), tg(1))
		};
	};
	const pairKey = (rt) => `${Math.min(rt.e.s, rt.e.t)} ${Math.max(rt.e.s, rt.e.t)}`;
	const pairs = /* @__PURE__ */ new Map();
	for (const rt of routes) if (!rt.flat) pairs.set(pairKey(rt), (pairs.get(pairKey(rt)) ?? 0) + 1);
	const fan = /* @__PURE__ */ new Map();
	{
		const bundles = /* @__PURE__ */ new Map();
		for (const rt of routes) {
			if (!rt.flat) continue;
			const key = `${Math.min(rt.e.s, rt.e.t)} ${Math.max(rt.e.s, rt.e.t)}`;
			bundles.set(key, [...bundles.get(key) ?? [], rt]);
		}
		for (const group of bundles.values()) {
			const spacing = Math.max(18, ...group.map((rt) => labelC(rt.e.i) + 10));
			group.forEach((rt, k) => fan.set(rt, k * spacing));
		}
	}
	for (const rt of routes) {
		const { s, t, i } = rt.e;
		const cs = at(s), ct = at(t);
		if (rt.flat) {
			const bow = Math.max(vn(s).fs, vn(t).fs) / 2 + 22 + (fan.get(rt) ?? 0);
			const M = [(cs[0] + ct[0]) / 2 + bow, (cs[1] + ct[1]) / 2];
			const start = border(s, cs, M), end = border(t, ct, M);
			const chord = unit(end[0] - start[0], end[1] - start[1]);
			const pts = curve([
				start,
				M,
				end
			], [
				null,
				chord,
				null
			], [
				false,
				false,
				false
			]);
			drawn.push({
				i,
				pts,
				label: [M[0] + clearance(chord, i), M[1]],
				back: false,
				self: false
			});
			continue;
		}
		const chain = rt.back ? rt.chain.slice().reverse() : rt.chain;
		const keep = (v) => vn(v).layer % 2 === 0 || v === rt.labelNode || (pairs.get(pairKey(rt)) ?? 0) > 1;
		const inner = chain.slice(1, -1).filter(keep).map(at);
		const start = border(s, cs, inner[0] ?? ct), end = border(t, ct, inner[inner.length - 1] ?? cs);
		const anchors = [
			start,
			...inner,
			end
		];
		const last = anchors.length - 1;
		const dir = rt.back ? -1 : 1;
		const pts = curve(anchors, anchors.map((_, k) => k === 0 || k === last ? null : [dir, 0]), anchors.map((_, k) => k > 0 && k < last));
		let label;
		if (rt.labelNode >= 0) {
			const lp = at(rt.labelNode);
			label = [lp[0], lp[1] - labelC(i) / 2 - 4];
		} else {
			const segs = (pts.length - 1) / 3;
			const { at: mid, tan } = segs % 2 ? bez(pts, (segs - 1) / 2, .5) : bez(pts, segs / 2, 0);
			let nrm = [-tan[1], tan[0]];
			if (nrm[1] > 0) nrm = [-nrm[0], -nrm[1]];
			const d = clearance(tan, i);
			label = [mid[0] + nrm[0] * d, mid[1] + nrm[1] * d];
		}
		drawn.push({
			i,
			pts,
			label,
			back: rt.back,
			self: false
		});
	}
	{
		const k = new Array(n).fill(0);
		for (const e of loops) {
			const g = loopGeom(e.s, k[e.s], at(e.s));
			k[e.s] = k[e.s] + 1;
			const top = bez(g, 0, .5).at;
			drawn.push({
				i: e.i,
				pts: g,
				label: [top[0], top[1] - labelC(e.i) / 2 - 4],
				back: false,
				self: true
			});
		}
	}
	drawn.sort((a, b) => a.i - b.i);
	const T = (p) => horizontal ? [p[0], p[1]] : [p[1], p[0]];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const grow = (x0, y0, x1, y1) => {
		minX = Math.min(minX, x0);
		minY = Math.min(minY, y0);
		maxX = Math.max(maxX, x1);
		maxY = Math.max(maxY, y1);
	};
	const placed = nodes.map((x, v) => {
		const p = T(at(v));
		grow(p[0] - x.width / 2, p[1] - x.height / 2, p[0] + x.width / 2, p[1] + x.height / 2);
		return p;
	});
	const outEdges = drawn.map((d) => {
		const pts = d.pts.map(T);
		for (const [x, y] of pts) grow(x, y, x, y);
		const label = T(d.label);
		const lw = ge(d.i).labelWidth ?? 0, lh = ge(d.i).labelHeight ?? 0;
		grow(label[0] - lw / 2, label[1] - lh / 2, label[0] + lw / 2, label[1] + lh / 2);
		return {
			d,
			pts,
			label
		};
	});
	if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
	const dx = margin - minX, dy = margin - minY;
	const r2 = (x) => Math.round(x * 100) / 100;
	const fmt = (p) => `${r2(p[0])} ${r2(p[1])}`;
	return {
		nodes: nodes.map((x, v) => ({
			...x,
			x: placed[v][0] + dx,
			y: placed[v][1] + dy,
			layer: r(v)
		})),
		edges: outEdges.map(({ d, pts, label }) => {
			const e = ge(d.i);
			const p = pts.map(([x, y]) => [x + dx, y + dy]);
			let path = `M ${fmt(p[0])}`;
			for (let k = 1; k + 2 < p.length; k += 3) path += ` C ${fmt(p[k])}, ${fmt(p[k + 1])}, ${fmt(p[k + 2])}`;
			const end = p[p.length - 1];
			const prev = p[p.length - 2];
			return {
				id: e.id,
				from: e.from,
				to: e.to,
				path,
				points: p,
				arrow: {
					x: end[0],
					y: end[1],
					angle: Math.atan2(end[1] - prev[1], end[0] - prev[0]) * 180 / Math.PI
				},
				label: {
					x: label[0] + dx,
					y: label[1] + dy
				},
				back: d.back,
				self: d.self
			};
		}),
		width: maxX - minX + 2 * margin,
		height: maxY - minY + 2 * margin
	};
}
// ../../../../src/plugins/verifier-mcrl2/widgets/study/Graph.svelte
var root$2 = from_svg(`<text class="elabel svelte-1i3pdf7" text-anchor="middle"> </text>`);
var root_1$2 = from_svg(`<title> </title>`);
var root_2$2 = from_svg(`<g><path class="line svelte-1i3pdf7"></path><path></path><!><!></g>`);
var root_3$1 = from_svg(`<circle class="initial svelte-1i3pdf7" r="8"></circle>`);
var root_4$1 = from_svg(`<rect class="shape svelte-1i3pdf7" rx="12"></rect><text class="nlabel svelte-1i3pdf7" y="4" text-anchor="middle"> </text>`, 1);
var root_5 = from_svg(`<circle class="shape svelte-1i3pdf7"></circle><text class="nlabel svelte-1i3pdf7" y="4" text-anchor="middle"> </text>`, 1);
var root_6 = from_svg(`<tspan x="0"> </tspan>`);
var root_7 = from_svg(`<text class="nsub svelte-1i3pdf7" text-anchor="middle"></text>`);
var root_8 = from_svg(`<g role="button" tabindex="0"><circle class="hit svelte-1i3pdf7" r="9"></circle><circle class="pinhead svelte-1i3pdf7" cy="-2" r="3.6"></circle><line class="pinneedle svelte-1i3pdf7" x1="0" y1="1.5" x2="0" y2="7"></line><title> </title></g>`);
var root_9 = from_svg(`<g role="button" tabindex="0"><circle class="hit svelte-1i3pdf7" r="9"></circle><path class="starshape svelte-1i3pdf7" d="M0,-5 L1.5,-1.6 L5,-1.6 L2.2,0.7 L3.2,4.4 L0,2.2 L-3.2,4.4 L-2.2,0.7 L-5,-1.6 L-1.5,-1.6 Z"></path><title> </title></g>`);
var root_10 = from_svg(`<g class="place svelte-1i3pdf7"><g role="button" tabindex="0"><!><!><!></g><!><!></g>`);
var root_11 = from_html(`<div class="measure svelte-1i3pdf7"><svg role="img" class="svelte-1i3pdf7"><!><!></svg></div>`);
var root_12 = from_html(`<div class="graph svelte-1i3pdf7"><div class="controls svelte-1i3pdf7" role="toolbar"><button>horizontal</button> <button>vertical</button> <span class="sep svelte-1i3pdf7"></span> <button aria-label="Zoom out" class="svelte-1i3pdf7">−</button> <span class="pct svelte-1i3pdf7"> </span> <button aria-label="Zoom in" class="svelte-1i3pdf7">+</button> <button class="svelte-1i3pdf7">fit</button></div> <!></div>`);
var $$css$2 = {
	hash: "svelte-1i3pdf7",
	code: ".graph.svelte-1i3pdf7 {display:flex;flex-direction:column;block-size:100%;min-block-size:0;gap:var(--space-xs);}.controls.svelte-1i3pdf7 {display:flex;align-items:center;gap:var(--space-xs);font-family:var(--font-family-mono);font-size:var(--font-size-2xs);color:var(--color-text-muted);}.controls.svelte-1i3pdf7 button:where(.svelte-1i3pdf7) {font:inherit;min-block-size:var(--size-target);min-inline-size:var(--size-target);padding:var(--space-none) var(--space-sm);color:var(--color-text-muted);background:none;border:var(--border-width-thin) solid transparent;border-radius:var(--radius-full);cursor:pointer;}.controls.svelte-1i3pdf7 button:where(.svelte-1i3pdf7):hover {color:var(--color-accent);}.controls.svelte-1i3pdf7 button.on:where(.svelte-1i3pdf7) {color:var(--color-text);border-color:var(--color-border-strong);}.sep.svelte-1i3pdf7 {flex:1;}.pct.svelte-1i3pdf7 {min-inline-size:var(--size-target);text-align:center;}.graph.svelte-1i3pdf7 .pan {flex:1;min-block-size:0;overflow:auto;}.measure.svelte-1i3pdf7 {min-inline-size:100%;min-block-size:100%;display:grid;place-items:center;}svg.svelte-1i3pdf7 {display:block;}text.svelte-1i3pdf7 {font-family:var(--font-family-body);}.place.svelte-1i3pdf7 {transition:transform var(--motion-duration-settle) var(--motion-easing-standard), opacity var(--motion-duration-settle) var(--motion-easing-standard);}\n  @media (prefers-reduced-motion: reduce) {.place.svelte-1i3pdf7 {transition:none;}\n  }\n\n  /* ---- edges: the road solid, the roads left dashed and faint, what may come dotted */.line.svelte-1i3pdf7 {fill:none;stroke:var(--color-text-muted);stroke-width:1.3;}.head.svelte-1i3pdf7 {fill:var(--color-text-muted);stroke:var(--color-text-muted);stroke-width:1.3;stroke-linejoin:round;}.edge.road.svelte-1i3pdf7 .line:where(.svelte-1i3pdf7),\n  .edge.road.svelte-1i3pdf7 .head:where(.svelte-1i3pdf7) {stroke:var(--color-text);}.edge.road.svelte-1i3pdf7 .head:where(.svelte-1i3pdf7) {fill:var(--color-text);}\n  /* UML: a transition's arrowhead is open. */.edge.svelte-1i3pdf7 .head.open:where(.svelte-1i3pdf7) {fill:none;}.edge.faded.svelte-1i3pdf7 {opacity:0.38;}.edge.faded.svelte-1i3pdf7 .line:where(.svelte-1i3pdf7) {stroke-dasharray:5 4;}.edge.ahead.svelte-1i3pdf7 .line:where(.svelte-1i3pdf7) {stroke-dasharray:1.5 4;stroke-linecap:round;}.edge.ahead.svelte-1i3pdf7 {opacity:0.55;}.elabel.svelte-1i3pdf7 {font-size:var(--font-size-2xs);fill:var(--color-text-muted);paint-order:stroke;stroke:var(--color-surface-raised);stroke-width:4;stroke-linejoin:round;}.edge.road.svelte-1i3pdf7 .elabel:where(.svelte-1i3pdf7) {fill:var(--color-text);}\n\n  /* ---- nodes */.node.svelte-1i3pdf7 {cursor:pointer;}.shape.svelte-1i3pdf7 {fill:var(--color-surface-raised);stroke:var(--color-text);stroke-width:1.4;}.initial.svelte-1i3pdf7 {fill:var(--color-text);}.nlabel.svelte-1i3pdf7 {font-size:var(--font-size-xs);fill:var(--color-text);}.nsub.svelte-1i3pdf7 {font-size:var(--font-size-2xs);fill:var(--color-text-muted);}.node.svelte-1i3pdf7:hover .shape:where(.svelte-1i3pdf7),\n  .node.svelte-1i3pdf7:focus .shape:where(.svelte-1i3pdf7) {stroke:var(--color-accent);}.node.current.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {fill:var(--color-accent);stroke:var(--color-accent);}.node.current.svelte-1i3pdf7 .nlabel:where(.svelte-1i3pdf7) {fill:var(--color-on-accent);}.node.faded.svelte-1i3pdf7 {opacity:0.38;}.node.faded.pinned.svelte-1i3pdf7 {opacity:1;}.node.ahead.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {fill:none;stroke:var(--color-text-muted);stroke-dasharray:2 3;}.node.ahead.svelte-1i3pdf7 .nlabel:where(.svelte-1i3pdf7) {fill:var(--color-text-muted);}.node.run.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {fill:var(--color-accent);stroke:var(--color-accent);}.node.run.svelte-1i3pdf7 .nlabel:where(.svelte-1i3pdf7),\n  .node.done.svelte-1i3pdf7 .nlabel:where(.svelte-1i3pdf7),\n  .node.queue.svelte-1i3pdf7 .nlabel:where(.svelte-1i3pdf7) {fill:var(--color-surface-raised);}.node.ask.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {stroke:var(--color-accent);stroke-width:2.6;}.node.queue.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {fill:var(--color-text-muted);stroke:var(--color-text-muted);}.node.done.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {fill:var(--color-text);}.node.held.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {stroke-dasharray:2 3;}.node.fail.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {stroke:var(--color-danger);}.node.picked.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {stroke:var(--color-accent);stroke-width:3;}.node.goal.svelte-1i3pdf7 .shape:where(.svelte-1i3pdf7) {stroke-width:3;}\n\n  /* ---- the marks: pin and bookmark, shown on hover and focus, always when set */.mark.svelte-1i3pdf7 {cursor:pointer;opacity:0;transition:opacity var(--motion-duration-fast) var(--motion-easing-standard);}.place.svelte-1i3pdf7:hover .mark:where(.svelte-1i3pdf7),\n  .place.svelte-1i3pdf7:focus-within .mark:where(.svelte-1i3pdf7),\n  .mark.set.svelte-1i3pdf7 {opacity:1;}.hit.svelte-1i3pdf7 {fill:transparent;}.pinhead.svelte-1i3pdf7 {fill:none;stroke:var(--color-text-muted);stroke-width:1.4;}.pinneedle.svelte-1i3pdf7 {stroke:var(--color-text-muted);stroke-width:1.4;}.pin.set.svelte-1i3pdf7 .pinhead:where(.svelte-1i3pdf7) {fill:var(--color-accent);stroke:var(--color-accent);}.pin.set.svelte-1i3pdf7 .pinneedle:where(.svelte-1i3pdf7) {stroke:var(--color-accent);}.starshape.svelte-1i3pdf7 {fill:none;stroke:var(--color-text-muted);stroke-width:1.2;stroke-linejoin:round;}.star.set.svelte-1i3pdf7 .starshape:where(.svelte-1i3pdf7) {fill:var(--color-accent);stroke:var(--color-accent);}.mark.svelte-1i3pdf7:hover .pinhead:where(.svelte-1i3pdf7),\n  .mark.svelte-1i3pdf7:hover .pinneedle:where(.svelte-1i3pdf7),\n  .mark.svelte-1i3pdf7:hover .starshape:where(.svelte-1i3pdf7) {stroke:var(--color-accent);}"
};
function Graph($$anchor, $$props) {
	push($$props, true);
	append_styles($$anchor, $$css$2);
	/** Nodes of the same layer drawn first come first: the road before the roads left. */
	/** Follow this node: scroll it into view when it changes. */
	/** Zoom to fit while the drawing is larger than its box and nobody has zoomed by hand. */
	/** Place each node once and never move it as the graph grows (a path explored), at the price of more crossings. */
	let notation = prop($$props, "notation", 3, "directed-graph"), direction = prop($$props, "direction", 15, "horizontal"), pinned = prop($$props, "pinned", 19, () => /* @__PURE__ */ new Set()), bookmarked = prop($$props, "bookmarked", 19, () => /* @__PURE__ */ new Set()), follow = prop($$props, "follow", 3, null), autofit = prop($$props, "autofit", 3, false), stable = prop($$props, "stable", 3, false);
	const uml = user_derived(() => notation() === "uml-state-machine");
	/** The widest caption, in the drawing's units. */
	const subWidth = user_derived(() => Math.max(0, ...$$props.nodes.map((n) => n.sub ? Math.max(...n.sub.split("\n").map((l) => l.length)) * 6.2 : 0)));
	const size = (n) => n.kind === "initial" ? {
		width: 18,
		height: 18
	} : get(uml) ? {
		width: Math.max(64, 18 + n.label.length * 8),
		height: 36
	} : {
		width: 34,
		height: 34
	};
	const placed = user_derived(() => layout($$props.nodes.map((n) => ({
		id: n.id,
		...size(n),
		shape: n.kind === "initial" || !get(uml) ? "circle" : "rounded"
	})), $$props.edges.map((e) => ({
		id: e.id,
		from: e.from,
		to: e.to,
		labelWidth: e.label ? Math.min(150, e.label.length * 6.5) : 0,
		labelHeight: e.label ? 14 : 0
	})), {
		direction: direction(),
		incremental: stable(),
		layerGap: get(uml) ? 96 : Math.max(84, (direction() === "horizontal" ? get(subWidth) : 0) + 30),
		nodeGap: get(uml) ? 34 : get(subWidth) > 0 ? direction() === "horizontal" ? 66 : get(subWidth) - 10 : 40,
		...$$props.order ? { order: $$props.order } : {},
		...$$props.nodes.some((n) => n.rank !== void 0) ? { rank: Object.fromEntries($$props.nodes.filter((n) => n.rank !== void 0).map((n) => [n.id, n.rank])) } : {}
	}));
	const byId = user_derived(() => new Map($$props.nodes.map((n) => [n.id, n])));
	const edgeById = user_derived(() => new Map($$props.edges.map((e) => [e.id, e])));
	let zoom = state(1);
	let box = state(void 0);
	let boxW = state(0);
	let boxH = state(0);
	const fit = () => {
		if (!get(boxW) || !get(boxH)) return;
		set(zoom, Math.max(.2, Math.min(2.5, Math.min(get(boxW) / get(W), get(boxH) / get(H)))), true);
	};
	let byHand = state(false);
	const zoomBy = (f) => {
		set(byHand, true);
		set(zoom, Math.max(.2, Math.min(4, get(zoom) * f)), true);
	};
	/** Room around the drawing for the captions under the nodes, which may be wider than the nodes. */
	const pad = user_derived(() => get(uml) ? 8 : Math.max(8, get(subWidth) / 2 - 10));
	const W = user_derived(() => get(placed).width + 2 * get(pad));
	const H = user_derived(() => get(placed).height + 2 * get(pad));
	user_effect(() => {
		if (!autofit() || get(byHand) || !get(boxW) || !get(boxH)) return;
		const z = Math.min(1, get(boxW) / get(W), get(boxH) / get(H));
		if (Math.abs(z - get(zoom)) > .01) set(zoom, Math.max(.2, z), true);
	});
	user_effect(() => {
		const id = follow();
		const p = get(placed).nodes.find((n) => n.id === id);
		if (!p || !get(box)) return;
		const x = (p.x + get(pad)) * get(zoom) - get(box).clientWidth / 2;
		const y = (p.y + get(pad)) * get(zoom) - get(box).clientHeight / 2;
		get(box).scrollTo({
			left: Math.max(0, x),
			top: Math.max(0, y),
			behavior: "smooth"
		});
	});
	const arrow = (x, y, a) => {
		const r = a * Math.PI / 180;
		const back = (d, side) => {
			const t = r + Math.PI + side * .42;
			return `${x + Math.cos(t) * d},${y + Math.sin(t) * d}`;
		};
		return get(uml) ? `M ${back(9, -1)} L ${x},${y} L ${back(9, 1)}` : `M ${back(9, -1)} L ${x},${y} L ${back(9, 1)} Z`;
	};
	var div = root_12();
	var div_1 = child(div);
	var button = child(div_1);
	let classes;
	var button_1 = sibling(button, 2);
	let classes_1;
	var button_2 = sibling(button_1, 4);
	var span = sibling(button_2, 2);
	var text = only_child(span);
	var button_3 = sibling(span, 2);
	var button_4 = sibling(button_3, 2);
	reset(div_1);
	Pannable(sibling(div_1, 2), {
		get label() {
			return $$props.label;
		},
		class: "pan",
		ignore: ".node, .mark",
		get box() {
			return get(box);
		},
		set box($$value) {
			set(box, $$value, true);
		},
		children: ($$anchor, $$slotProps) => {
			var div_2 = root_11();
			var svg = child(div_2);
			var node_1 = child(svg);
			each(node_1, 17, () => get(placed).edges, (pe) => pe.id, ($$anchor, pe) => {
				const e = user_derived(() => get(edgeById).get(get(pe).id));
				var g = root_2$2();
				let classes_2;
				var path = child(g);
				var path_1 = sibling(path);
				let classes_3;
				var node_2 = sibling(path_1);
				var consequent = ($$anchor) => {
					var text_1 = root$2();
					var text_2 = only_child(text_1, true);
					template_effect(() => {
						set_attribute(text_1, "x", get(pe).label.x);
						set_attribute(text_1, "y", get(pe).label.y);
						set_text(text_2, get(e).label);
					});
					append($$anchor, text_1);
				};
				if_block(node_2, ($$render) => {
					if (get(e)?.label) $$render(consequent);
				});
				var node_3 = sibling(node_2);
				var consequent_1 = ($$anchor) => {
					var title = root_1$2();
					var text_3 = only_child(title, true);
					template_effect(() => set_text(text_3, get(e).title));
					append($$anchor, title);
				};
				if_block(node_3, ($$render) => {
					if (get(e)?.title) $$render(consequent_1);
				});
				reset(g);
				template_effect(($0) => {
					classes_2 = set_class(g, 0, `edge ${get(e)?.cls ?? "" ?? ""}`, "svelte-1i3pdf7", classes_2, { back: get(pe).back });
					set_attribute(path, "d", get(pe).path);
					classes_3 = set_class(path_1, 0, "head svelte-1i3pdf7", null, classes_3, { open: get(uml) });
					set_attribute(path_1, "d", $0);
				}, [() => arrow(get(pe).arrow.x, get(pe).arrow.y, get(pe).arrow.angle)]);
				append($$anchor, g);
			});
			var node_4 = sibling(node_1);
			each(node_4, 17, () => get(placed).nodes, (pn) => pn.id, ($$anchor, pn) => {
				const n = user_derived(() => get(byId).get(get(pn).id));
				var fragment = comment();
				var node_5 = first_child(fragment);
				var consequent_8 = ($$anchor) => {
					var g_1 = root_10();
					let styles;
					var g_2 = child(g_1);
					let classes_4;
					var node_6 = child(g_2);
					var consequent_2 = ($$anchor) => {
						var circle = root_3$1();
						append($$anchor, circle);
					};
					var consequent_3 = ($$anchor) => {
						var fragment_1 = root_4$1();
						var rect = first_child(fragment_1);
						var text_4 = sibling(rect);
						var text_5 = only_child(text_4, true);
						template_effect(() => {
							set_attribute(rect, "x", -get(pn).width / 2);
							set_attribute(rect, "y", -get(pn).height / 2);
							set_attribute(rect, "width", get(pn).width);
							set_attribute(rect, "height", get(pn).height);
							set_text(text_5, get(n).label);
						});
						append($$anchor, fragment_1);
					};
					var alternate = ($$anchor) => {
						var fragment_2 = root_5();
						var circle_1 = first_child(fragment_2);
						var text_6 = sibling(circle_1);
						var text_7 = only_child(text_6, true);
						template_effect(() => {
							set_attribute(circle_1, "r", get(pn).width / 2);
							set_text(text_7, get(n).label);
						});
						append($$anchor, fragment_2);
					};
					if_block(node_6, ($$render) => {
						if (get(n).kind === "initial") $$render(consequent_2);
						else if (get(uml)) $$render(consequent_3, 1);
						else $$render(alternate, -1);
					});
					var node_7 = sibling(node_6);
					var consequent_4 = ($$anchor) => {
						var text_8 = root_7();
						each(text_8, 21, () => get(n).sub.split("\n"), index, ($$anchor, line, li) => {
							var tspan = root_6();
							set_attribute(tspan, "dy", li === 0 ? 0 : 13);
							var text_9 = only_child(tspan, true);
							template_effect(() => set_text(text_9, get(line)));
							append($$anchor, tspan);
						});
						reset(text_8);
						template_effect(() => set_attribute(text_8, "y", get(pn).height / 2 + 14));
						append($$anchor, text_8);
					};
					if_block(node_7, ($$render) => {
						if (get(n).sub) $$render(consequent_4);
					});
					var node_8 = sibling(node_7);
					var consequent_5 = ($$anchor) => {
						var title_1 = root_1$2();
						var text_10 = only_child(title_1, true);
						template_effect(() => set_text(text_10, get(n).title));
						append($$anchor, title_1);
					};
					if_block(node_8, ($$render) => {
						if (get(n).title) $$render(consequent_5);
					});
					reset(g_2);
					var node_9 = sibling(g_2);
					var consequent_6 = ($$anchor) => {
						var g_3 = root_8();
						let classes_5;
						var title_2 = sibling(child(g_3), 3);
						var text_11 = only_child(title_2, true);
						reset(g_3);
						template_effect(($0, $1, $2) => {
							classes_5 = set_class(g_3, 0, "mark pin svelte-1i3pdf7", null, classes_5, { set: $0 });
							set_attribute(g_3, "aria-label", $1);
							set_attribute(g_3, "transform", `translate(${get(pn).width / 2 - 2}, ${-get(pn).height / 2 - 6})`);
							set_text(text_11, $2);
						}, [
							() => pinned().has(get(n).id),
							() => pinned().has(get(n).id) ? `unpin ${get(n).label}` : `pin ${get(n).label}, so it never fades`,
							() => pinned().has(get(n).id) ? "Unpin" : "Pin: it never fades"
						]);
						delegated("click", g_3, () => $$props.onpin?.(get(n).id));
						delegated("keydown", g_3, (ev) => ev.key === "Enter" && $$props.onpin?.(get(n).id));
						append($$anchor, g_3);
					};
					if_block(node_9, ($$render) => {
						if ($$props.onpin && get(n).kind !== "initial") $$render(consequent_6);
					});
					var node_10 = sibling(node_9);
					var consequent_7 = ($$anchor) => {
						var g_4 = root_9();
						let classes_6;
						var title_3 = sibling(child(g_4), 2);
						var text_12 = only_child(title_3, true);
						reset(g_4);
						template_effect(($0, $1, $2) => {
							classes_6 = set_class(g_4, 0, "mark star svelte-1i3pdf7", null, classes_6, { set: $0 });
							set_attribute(g_4, "aria-label", $1);
							set_attribute(g_4, "transform", `translate(${-get(pn).width / 2 + 2}, ${-get(pn).height / 2 - 6})`);
							set_text(text_12, $2);
						}, [
							() => bookmarked().has(get(n).id),
							() => bookmarked().has(get(n).id) ? `remove the bookmark of ${get(n).label}` : `bookmark ${get(n).label}`,
							() => bookmarked().has(get(n).id) ? "Remove the bookmark" : "Bookmark it"
						]);
						delegated("click", g_4, () => $$props.onbookmark?.(get(n).id));
						delegated("keydown", g_4, (ev) => ev.key === "Enter" && $$props.onbookmark?.(get(n).id));
						append($$anchor, g_4);
					};
					if_block(node_10, ($$render) => {
						if ($$props.onbookmark && get(n).kind !== "initial") $$render(consequent_7);
					});
					reset(g_1);
					template_effect(($0) => {
						styles = set_style(g_1, "", styles, { transform: `translate(${get(pn).x ?? ""}px, ${get(pn).y ?? ""}px)` });
						classes_4 = set_class(g_2, 0, `node ${get(n).cls ?? "" ?? ""}`, "svelte-1i3pdf7", classes_4, { pinned: $0 });
						set_attribute(g_2, "aria-label", get(n).title ?? get(n).label);
					}, [() => pinned().has(get(n).id)]);
					delegated("click", g_2, () => $$props.onpick?.(get(n).id));
					delegated("keydown", g_2, (ev) => ev.key === "Enter" && $$props.onpick?.(get(n).id));
					append($$anchor, g_1);
				};
				if_block(node_5, ($$render) => {
					if (get(n)) $$render(consequent_8);
				});
				append($$anchor, fragment);
			});
			reset(svg);
			reset(div_2);
			template_effect(() => {
				set_attribute(svg, "width", get(W) * get(zoom));
				set_attribute(svg, "height", get(H) * get(zoom));
				set_attribute(svg, "viewBox", `${-get(pad)} ${-get(pad)} ${get(W) ?? ""} ${get(H) ?? ""}`);
				set_attribute(svg, "aria-label", $$props.label);
			});
			bind_element_size(div_2, "clientWidth", ($$value) => set(boxW, $$value));
			bind_element_size(div_2, "clientHeight", ($$value) => set(boxH, $$value));
			append($$anchor, div_2);
		},
		$$slots: { default: true }
	});
	reset(div);
	template_effect(($0) => {
		set_attribute(div_1, "aria-label", `${$$props.label ?? ""}: layout and zoom`);
		classes = set_class(button, 1, "svelte-1i3pdf7", null, classes, { on: direction() === "horizontal" });
		classes_1 = set_class(button_1, 1, "svelte-1i3pdf7", null, classes_1, { on: direction() === "vertical" });
		set_text(text, `${$0 ?? ""}%`);
	}, [() => Math.round(get(zoom) * 100)]);
	delegated("click", button, () => direction("horizontal"));
	delegated("click", button_1, () => direction("vertical"));
	delegated("click", button_2, () => zoomBy(1 / 1.25));
	delegated("click", button_3, () => zoomBy(1.25));
	delegated("click", button_4, () => (set(byHand, true), fit()));
	append($$anchor, div);
	pop();
}
delegate(["click", "keydown"]);
// ../../../../src/plugins/verifier-mcrl2/widgets/study/Sequence.svelte
var root$1 = from_svg(`<rect class="headbox svelte-hvqg84" y="4" width="132" height="26" rx="2"></rect><text class="who svelte-hvqg84" y="21" text-anchor="middle"> </text>`, 1);
var root_1$1 = from_svg(`<line class="life svelte-hvqg84" y1="0"></line>`);
var root_2$1 = from_svg(`<title> </title>`);
var root_3 = from_svg(`<g><line class="svelte-hvqg84"></line><path class="head svelte-hvqg84"></path><text text-anchor="middle" class="svelte-hvqg84"> </text><!></g>`);
var root_4 = from_html(`<div class="sequence svelte-hvqg84"><svg class="heads svelte-hvqg84" height="34" aria-hidden="true"></svg> <div class="body svelte-hvqg84"><svg role="img" class="svelte-hvqg84"><!><!></svg></div></div>`);
var $$css$1 = {
	hash: "svelte-hvqg84",
	code: ".sequence.svelte-hvqg84 {display:flex;flex-direction:column;align-items:center;block-size:100%;min-block-size:0;overflow-x:auto;}.heads.svelte-hvqg84 {flex:none;}.body.svelte-hvqg84 {flex:1;min-block-size:0;overflow-y:auto;}svg.svelte-hvqg84 {display:block;}text.svelte-hvqg84 {font-family:var(--font-family-body);}.headbox.svelte-hvqg84 {fill:var(--color-surface-raised);stroke:var(--color-text);stroke-width:1.2;}.who.svelte-hvqg84 {font-size:var(--font-size-xs);fill:var(--color-text);}.life.svelte-hvqg84 {stroke:var(--color-text-muted);stroke-width:1;stroke-dasharray:5 4;}.msg.svelte-hvqg84 line:where(.svelte-hvqg84) {stroke:var(--color-text-muted);stroke-width:1.2;}.msg.svelte-hvqg84 .head:where(.svelte-hvqg84) {fill:var(--color-text-muted);}.msg.svelte-hvqg84 text:where(.svelte-hvqg84) {font-size:var(--font-size-2xs);fill:var(--color-text-muted);}.msg.latest.svelte-hvqg84 line:where(.svelte-hvqg84) {stroke:var(--color-accent);stroke-width:1.8;}.msg.latest.svelte-hvqg84 .head:where(.svelte-hvqg84) {fill:var(--color-accent);}.msg.latest.svelte-hvqg84 text:where(.svelte-hvqg84) {fill:var(--color-accent);}"
};
function Sequence($$anchor, $$props) {
	push($$props, true);
	append_styles($$anchor, $$css$1);
	/** How many of the last messages are drawn. */
	let last = prop($$props, "last", 3, 40);
	/** Wide enough for the messages between neighbours, whatever the number of lifelines; drawn at its own size. */
	const W = user_derived(() => Math.max(520, 180 + ($$props.lifelines.length - 1) * 220));
	const STEP = 30;
	const shown = user_derived(() => $$props.messages.slice(-last()));
	const lx = (who) => {
		const i = Math.max(0, $$props.lifelines.indexOf(who));
		return $$props.lifelines.length === 1 ? get(W) / 2 : 90 + i * (get(W) - 180) / ($$props.lifelines.length - 1);
	};
	const H = user_derived(() => 16 + get(shown).length * STEP + 30);
	let box = state(void 0);
	user_effect(() => {
		get(shown).length;
		if (get(box)) get(box).scrollTo({
			top: get(box).scrollHeight,
			behavior: "smooth"
		});
	});
	var div = root_4();
	var svg = child(div);
	each(svg, 20, () => $$props.lifelines, (l) => l, ($$anchor, l) => {
		var fragment = root$1();
		var rect = first_child(fragment);
		var text = sibling(rect);
		var text_1 = only_child(text, true);
		template_effect(($0, $1) => {
			set_attribute(rect, "x", $0);
			set_attribute(text, "x", $1);
			set_text(text_1, l);
		}, [() => lx(l) - 66, () => lx(l)]);
		append($$anchor, fragment);
	});
	reset(svg);
	var div_1 = sibling(svg, 2);
	var svg_1 = child(div_1);
	var node = child(svg_1);
	each(node, 16, () => $$props.lifelines, (l) => l, ($$anchor, l) => {
		var line = root_1$1();
		template_effect(($0, $1) => {
			set_attribute(line, "x1", $0);
			set_attribute(line, "x2", $1);
			set_attribute(line, "y2", get(H) - 8);
		}, [() => lx(l), () => lx(l)]);
		append($$anchor, line);
	});
	var node_1 = sibling(node);
	each(node_1, 17, () => get(shown), index, ($$anchor, m, i) => {
		const y = user_derived(() => 16 + i * STEP + 12);
		const x1 = user_derived(() => lx(get(m).from));
		const x2 = user_derived(() => lx(get(m).to));
		const dir = user_derived(() => Math.sign(get(x2) - get(x1)) || 1);
		var g = root_3();
		let classes;
		var line_1 = child(g);
		var path = sibling(line_1);
		var text_2 = sibling(path);
		var text_3 = only_child(text_2, true);
		var node_2 = sibling(text_2);
		var consequent = ($$anchor) => {
			var title = root_2$1();
			var text_4 = only_child(title, true);
			template_effect(() => set_text(text_4, get(m).title));
			append($$anchor, title);
		};
		if_block(node_2, ($$render) => {
			if (get(m).title) $$render(consequent);
		});
		reset(g);
		template_effect(() => {
			classes = set_class(g, 0, "msg svelte-hvqg84", null, classes, { latest: i === get(shown).length - 1 });
			set_attribute(line_1, "x1", get(x1));
			set_attribute(line_1, "x2", get(x2) - get(dir) * 1);
			set_attribute(line_1, "y1", get(y));
			set_attribute(line_1, "y2", get(y));
			set_attribute(path, "d", `M ${get(x2) ?? ""} ${get(y) ?? ""} L ${get(x2) - get(dir) * 9} ${get(y) - 4.5} L ${get(x2) - get(dir) * 9} ${get(y) + 4.5} Z`);
			set_attribute(text_2, "x", (get(x1) + get(x2)) / 2);
			set_attribute(text_2, "y", get(y) - 6);
			set_text(text_3, get(m).label);
		});
		append($$anchor, g);
	});
	reset(svg_1);
	reset(div_1);
	bind_this(div_1, ($$value) => set(box, $$value), () => get(box));
	reset(div);
	template_effect(() => {
		set_attribute(svg, "width", get(W));
		set_attribute(svg, "viewBox", `0 0 ${get(W) ?? ""} 34`);
		set_attribute(svg_1, "width", get(W));
		set_attribute(svg_1, "height", get(H));
		set_attribute(svg_1, "viewBox", `0 0 ${get(W) ?? ""} ${get(H) ?? ""}`);
		set_attribute(svg_1, "aria-label", $$props.label);
	});
	append($$anchor, div);
	pop();
}
// src/View.svelte
var root = from_html(`<div class="client svelte-1j3c3om"><div class="row svelte-1j3c3om"><strong> </strong> <button class="svelte-1j3c3om">ask</button> <button class="svelte-1j3c3om">release</button></div> <div class="machine svelte-1j3c3om"><!></div> <p class="hint svelte-1j3c3om"> </p></div>`);
var root_1 = from_html(`<p class="hint refused svelte-1j3c3om"> </p>`);
var root_2 = from_html(`<div class="study svelte-1j3c3om"><section class="clients svelte-1j3c3om"></section> <!> <p class="hint svelte-1j3c3om"><!></p> <section class="sequence svelte-1j3c3om"><!></section></div>`);
var $$css = {
	hash: "svelte-1j3c3om",
	code: ".study.svelte-1j3c3om {display:flex;flex-direction:column;gap:12px;padding:4px;font-family:var(--font-family-body);color:var(--color-text);}.clients.svelte-1j3c3om {display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;}.client.svelte-1j3c3om {display:flex;flex-direction:column;gap:6px;border:1px solid var(--color-border-strong);border-radius:12px;padding:8px;}.machine.svelte-1j3c3om {height:200px;}.sequence.svelte-1j3c3om {height:360px;overflow:auto;}.row.svelte-1j3c3om {display:flex;gap:8px;align-items:center;}.hint.svelte-1j3c3om {margin:0;font-size:13px;color:var(--color-text-muted);}.refused.svelte-1j3c3om {color:var(--color-danger);}button.svelte-1j3c3om {font:inherit;font-size:13px;padding:4px 12px;border-radius:999px;border:1px solid var(--color-border-strong);background:transparent;color:var(--color-text);cursor:pointer;}button.svelte-1j3c3om:hover:not(:disabled) {border-color:var(--color-accent);color:var(--color-accent);}button.svelte-1j3c3om:disabled {opacity:0.35;cursor:default;}"
};
function View($$anchor, $$props) {
	push($$props, true);
	append_styles($$anchor, $$css);
	let data = state(null);
	onMount(() => {
		set(data, $$props.host.data, true);
		return $$props.host.subscribe((d) => set(data, d, true));
	});
	const lock = user_derived(() => get(data)?.state ?? null);
	const memory = user_derived(() => get(data)?.memory ?? null);
	let refusal = state(null);
	const allowed = (label) => (get(data)?.allowed ?? []).some((a) => a.label === label);
	async function fire(label) {
		const r = await $$props.host.fire(label);
		set(refusal, r.ok ? null : r.why ?? "not allowed now", true);
	}
	const STATES = [
		{
			id: "IDLE",
			label: "idle"
		},
		{
			id: "WAITING",
			label: "waiting"
		},
		{
			id: "HOLDING",
			label: "holding"
		}
	];
	const EDGES = [
		{
			id: "start",
			from: "init",
			to: "IDLE"
		},
		{
			id: "ask",
			from: "IDLE",
			to: "WAITING",
			label: "ask"
		},
		{
			id: "grant",
			from: "WAITING",
			to: "HOLDING",
			label: "grant"
		},
		{
			id: "release",
			from: "HOLDING",
			to: "IDLE",
			label: "release"
		}
	];
	function machine(client) {
		const now = get(lock) ? at(get(lock).phase, client) : "IDLE";
		return [{
			id: "init",
			label: "",
			kind: "initial"
		}, ...STATES.map((s) => ({
			id: s.id,
			label: s.label,
			cls: s.id === now ? "current" : ""
		}))];
	}
	function waited(client) {
		if (!get(memory)) return "";
		const since = get(memory).askedAt[client];
		const now = since === void 0 ? "" : `waiting for ${get(memory).steps - since} steps`;
		const past = get(memory).waits[client] ?? [];
		return [now, past.length ? `waited ${past.join(", ")} before` : ""].filter(Boolean).join("; ");
	}
	const lifelines = [...CLIENTS, LOCK];
	var div = root_2();
	var section = child(div);
	each(section, 20, () => CLIENTS, (c) => c, ($$anchor, c) => {
		var div_1 = root();
		var div_2 = child(div_1);
		var strong = child(div_2);
		var text = only_child(strong, true);
		var button = sibling(strong, 2);
		var button_1 = sibling(button, 2);
		reset(div_2);
		var div_3 = sibling(div_2, 2);
		var node = child(div_3);
		{
			let $0 = user_derived(() => machine(c));
			Graph(node, {
				get label() {
					return `the state machine of client ${c ?? ""}`;
				},
				notation: "uml-state-machine",
				autofit: true,
				get nodes() {
					return get($0);
				},
				get edges() {
					return EDGES;
				}
			});
		}
		reset(div_3);
		var p = sibling(div_3, 2);
		var text_1 = only_child(p, true);
		reset(div_1);
		template_effect(($0, $1, $2, $3, $4) => {
			set_text(text, c);
			button.disabled = $0;
			set_attribute(button, "title", $1);
			button_1.disabled = $2;
			set_attribute(button_1, "title", $3);
			set_text(text_1, $4);
		}, [
			() => !allowed(`ask(${c})`),
			() => $$props.host.say(`ask(${c})`)?.text,
			() => !allowed(`release(${c})`),
			() => $$props.host.say(`release(${c})`)?.text,
			() => waited(c)
		]);
		delegated("click", button, () => fire(`ask(${c})`));
		delegated("click", button_1, () => fire(`release(${c})`));
		append($$anchor, div_1);
	});
	reset(section);
	var node_1 = sibling(section, 2);
	var consequent = ($$anchor) => {
		var p_1 = root_1();
		var text_2 = only_child(p_1, true);
		template_effect(() => set_text(text_2, get(refusal)));
		append($$anchor, p_1);
	};
	if_block(node_1, ($$render) => {
		if (get(refusal)) $$render(consequent);
	});
	var p_2 = sibling(node_1, 2);
	var node_2 = child(p_2);
	var consequent_1 = ($$anchor) => {
		var text_3 = text();
		template_effect(($0) => set_text(text_3, `${get(lock).free ? "The lock is free." : `${get(memory)?.holder ?? "A client"} holds the lock.`}
      ${$0 ?? ""}`), [() => get(lock).queue.length ? `Waiting, the longest first: ${get(lock).queue.join(", ")}.` : "Nobody waits."]);
		append($$anchor, text_3);
	};
	if_block(node_2, ($$render) => {
		if (get(lock)) $$render(consequent_1);
	});
	reset(p_2);
	var section_1 = sibling(p_2, 2);
	var node_3 = child(section_1);
	{
		let $0 = user_derived(() => get(memory)?.messages ?? []);
		Sequence(node_3, {
			label: "the clients and the lock, each step a message",
			get lifelines() {
				return lifelines;
			},
			get messages() {
				return get($0);
			}
		});
	}
	reset(section_1);
	reset(div);
	append($$anchor, div);
	pop();
}
delegate(["click"]);
// src/view.ts
function mount(target, host) {
	const app = mount$1(View, {
		target,
		props: { host }
	});
	return { destroy: () => void unmount(app) };
}
export { mount };
