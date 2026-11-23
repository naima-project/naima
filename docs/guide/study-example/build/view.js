import { A as delegate, B as proxy, C as set_text, D as from_html, E as comment, F as user_effect, G as pop, H as state, I as child, J as reset, K as push, L as first_child, M as get, N as untrack, O as from_svg, P as template_effect, R as only_child, S as mount$1, T as append, U as user_derived, V as set, W as getContext, X as noop, Y as fallback, Z as to_array, _ as component, a as prop, b as index, c as bind_this, d as attribute_effect, f as set_attribute, g as element, h as append_styles, i as onMount, j as delegated, k as text, l as bind_element_size, m as set_class, n as LOCK, o as rest_props, p as set_style, q as next, r as at, s as spread_props, t as CLIENTS, u as CLASS, v as snippet, w as unmount, x as if_block, y as each, z as sibling } from "./shared.js";
// node_modules/.deno/svelte@5.57.3/node_modules/svelte/src/internal/disclose-version.js
if (typeof window !== "undefined") ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add("5");
// ../../../../src/plugins/verifier-mcrl2/widgets/study/route.ts
/** The SVG path through a start and cubic segments (three points each). */
function pathOf(p) {
	if (p.length === 0) return "";
	let d = `M ${p[0][0]},${p[0][1]}`;
	for (let i = 1; i + 2 < p.length; i += 3) d += ` C ${p[i][0]},${p[i][1]} ${p[i + 1][0]},${p[i + 1][1]} ${p[i + 2][0]},${p[i + 2][1]}`;
	return d;
}
/** The arrowhead at a path's end, along its last segment's tangent. */
function arrowOf(p) {
	const e = p[p.length - 1];
	let k = p.length - 2;
	while (k > 0 && Math.hypot(p[k][0] - e[0], p[k][1] - e[1]) < 1e-6) k--;
	const b = p[k] ?? e;
	return {
		x: e[0],
		y: e[1],
		angle: Math.atan2(e[1] - b[1], e[0] - b[0]) * 180 / Math.PI
	};
}
var bez = (a, b, c, d, t) => {
	const u = 1 - t;
	return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
};
/** A smooth curve through anchors whose tangents follow the flow: horizontal handles for a horizontal flow. */
function flowCurve(anchors, dir) {
	const out = [anchors[0]];
	for (let i = 0; i + 1 < anchors.length; i++) {
		const a = anchors[i];
		const b = anchors[i + 1];
		if (dir === "horizontal") {
			const h = Math.max(12, Math.abs(b[0] - a[0]) / 2);
			const s = Math.sign(b[0] - a[0]) || 1;
			out.push([a[0] + s * h, a[1]], [b[0] - s * h, b[1]], b);
		} else {
			const h = Math.max(12, Math.abs(b[1] - a[1]) / 2);
			const s = Math.sign(b[1] - a[1]) || 1;
			out.push([a[0], a[1] + s * h], [b[0], b[1] - s * h], b);
		}
	}
	return out;
}
/** Where an edge leaves a node, or enters it, on the flow's side. */
var exit = (n, dir) => dir === "horizontal" ? [n.x + n.width / 2, n.y] : [n.x, n.y + n.height / 2];
var entry = (n, dir) => dir === "horizontal" ? [n.x - n.width / 2, n.y] : [n.x, n.y - n.height / 2];
function route(l, dir, opts = {}) {
	const margin = opts.margin ?? 20;
	const nodes = l.nodes.map((n) => ({ ...n }));
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const fan = new Set(opts.fan ?? []);
	const from = opts.fanFrom ? byId.get(opts.fanFrom) : void 0;
	if (from && fan.size > 0) {
		const ids = (opts.fan ?? []).filter((id) => byId.has(id));
		const ROW = 28;
		ids.forEach((id, i) => {
			const n = byId.get(id);
			if (dir === "horizontal") {
				n.x = from.x + from.width / 2 + 110;
				n.y = from.y + (i - (ids.length - 1) / 2) * ROW;
			} else {
				n.x = from.x + 40;
				n.y = from.y + from.height / 2 + 54 + i * ROW;
			}
		});
	}
	const moved = /* @__PURE__ */ new Set();
	if (from && fan.size > 0) {
		const fanNodes = [...fan].map((id) => byId.get(id)).filter((n) => !!n);
		if (fanNodes.length > 0) {
			const top = Math.min(...fanNodes.map((n) => n.y - n.height / 2)) - 16;
			const bottom = Math.max(...fanNodes.map((n) => n.y + n.height / 2)) + 28;
			const left = Math.min(...fanNodes.map((n) => n.x - n.width / 2)) - 24;
			const right = Math.max(...fanNodes.map((n) => n.x + n.width / 2 + 12 + (opts.fanWidth?.(n.id) ?? 0))) + 24;
			for (const id of opts.avoid ?? []) {
				const n = byId.get(id);
				if (!n || fan.has(id)) continue;
				const inX = dir === "horizontal" ? n.x + n.width / 2 >= left : n.x + n.width / 2 >= left && n.x - n.width / 2 <= right;
				const inY = n.y + n.height / 2 >= top && n.y - n.height / 2 <= bottom;
				if (inX && (inY || n.y > top)) {
					const by = bottom - (n.y - n.height / 2) + 12;
					if (by > 0) {
						n.y += by;
						moved.add(id);
					}
				}
			}
		}
	}
	const edges = l.edges.map((e) => {
		if (e.self && moved.has(e.from)) {
			const n = byId.get(e.from);
			const o = l.nodes.find((x) => x.id === e.from);
			const dy = n.y - o.y;
			const points = e.points.map((p) => [p[0], p[1] + dy]);
			return {
				...e,
				points,
				path: pathOf(points),
				arrow: arrowOf(points),
				label: {
					x: e.label.x,
					y: e.label.y + dy
				}
			};
		}
		if (e.back || e.self) return e;
		const a = byId.get(e.from);
		const b = byId.get(e.to);
		if (!a || !b) return e;
		const fanned = fan.has(e.to);
		const bends = [];
		if (!fanned && !moved.has(e.from) && !moved.has(e.to)) for (let i = 3; i < e.points.length - 1; i += 3) bends.push(e.points[i]);
		const start = exit(a, dir);
		const end = fanned && dir === "vertical" ? [b.x - b.width / 2, b.y] : entry(b, dir);
		const points = fanned && dir === "vertical" ? [
			start,
			[start[0], (start[1] + end[1]) / 2],
			[start[0], end[1]],
			end
		] : flowCurve([
			start,
			...bends,
			end
		], dir);
		const k = Math.max(0, Math.floor((points.length - 1) / 3 / 2)) * 3;
		const m = points.length >= 4 ? bez(points[k], points[k + 1], points[k + 2], points[k + 3], .5) : start;
		const w = opts.labelWidth?.(e.id) ?? 0;
		const label = dir === "horizontal" ? {
			x: m[0],
			y: m[1] - 8
		} : {
			x: m[0] - 10 - w / 2,
			y: m[1] + 4
		};
		return {
			...e,
			points,
			path: pathOf(points),
			arrow: arrowOf(points),
			label
		};
	});
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	const take = (x, y) => {
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	};
	for (const n of nodes) {
		take(n.x - n.width / 2, n.y - n.height / 2);
		take(n.x + n.width / 2 + (fan.has(n.id) ? 12 + (opts.fanWidth?.(n.id) ?? 0) : 0), n.y + n.height / 2);
	}
	for (const e of edges) {
		for (const p of e.points) take(p[0], p[1]);
		const w = opts.labelWidth?.(e.id) ?? 0;
		take(e.label.x - w / 2, e.label.y - 12);
		take(e.label.x + w / 2, e.label.y + 4);
	}
	if (!Number.isFinite(x0)) return l;
	const dx = margin - x0;
	const dy = margin - y0;
	const shift = (p) => [p[0] + dx, p[1] + dy];
	return {
		width: x1 - x0 + 2 * margin,
		height: y1 - y0 + 2 * margin,
		nodes: nodes.map((n) => ({
			...n,
			x: n.x + dx,
			y: n.y + dy
		})),
		edges: edges.map((e) => {
			const points = e.points.map(shift);
			return {
				...e,
				points,
				path: pathOf(points),
				arrow: arrowOf(points),
				label: {
					x: e.label.x + dx,
					y: e.label.y + dy
				}
			};
		})
	};
}
// ../../../../src/plugins/verifier-mcrl2/widgets/Pannable.svelte
var rest_excludes$15 = /* @__PURE__ */ new Set([
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
var root$5 = from_html(`<div><!></div>`);
var $$css$4 = {
	hash: "svelte-ompztj",
	code: ".pannable.svelte-ompztj {overflow-x:auto;min-width:0;max-width:100%;cursor:grab;user-select:none;-webkit-user-select:none;}.pannable.panning.svelte-ompztj {cursor:grabbing;}"
};
function Pannable($$anchor, $$props) {
	push($$props, true);
	append_styles($$anchor, $$css$4);
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
	let box = prop($$props, "box", 15), width = prop($$props, "width", 15, 0), cls = prop($$props, "class", 3, ""), rest = rest_props($$props, rest_excludes$15);
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
	var div = root$5();
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
	}), void 0, void 0, void 0, "svelte-ompztj");
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
// ../../../../src/plugins/verifier-mcrl2/widgets/Icon.svelte
var root$4 = from_html(`<span class="icon svelte-13a9429" role="img"><!></span>`);
var root_1$3 = from_html(`<span class="icon svelte-13a9429" aria-hidden="true"><!></span>`);
var $$css$3 = {
	hash: "svelte-13a9429",
	code: ".icon.svelte-13a9429 {display:inline-flex;width:var(--size-icon);height:var(--size-icon);color:currentColor;flex:none;}.icon.svelte-13a9429 svg {width:100%;height:100%;}"
};
function Icon$1($$anchor, $$props) {
	append_styles($$anchor, $$css$3);
	var fragment = comment();
	var node = first_child(fragment);
	var consequent = ($$anchor) => {
		var span = root$4();
		var node_1 = child(span);
		snippet(node_1, () => $$props.children);
		reset(span);
		template_effect(() => set_attribute(span, "aria-label", $$props.label));
		append($$anchor, span);
	};
	var alternate = ($$anchor) => {
		var span_1 = root_1$3();
		var node_2 = child(span_1);
		snippet(node_2, () => $$props.children);
		reset(span_1);
		append($$anchor, span_1);
	};
	if_block(node, ($$render) => {
		if ($$props.label) $$render(consequent);
		else $$render(alternate, -1);
	});
	append($$anchor, fragment);
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/utils/defaultAttributes.js
/**
* @file
* @license @lucide/svelte v1.60.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var defaultAttributes = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": 2,
	"stroke-linecap": "round",
	"stroke-linejoin": "round"
};
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/utils/mergeClasses.js
/**
* @file
* @license @lucide/svelte v1.60.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
/**
* Merges classes into a single string
*
* @param {array} classes
* @returns {string} A string of classes
*/
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
	return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/utils/buildLucideIconNode.js
/**
* @file
* @license @lucide/svelte v1.60.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
function isDefined(value) {
	return value !== null && value !== void 0;
}
/**
* Creates a Lucide icon node (an svgson-like format) from a Lucide icon object.
*
* @param icon The icon to build.
* @param params Additional build parameters.
*/
function buildLucideIconNode(icon, params = {}) {
	const attributeNames = params.attributeNames ?? {};
	const getAttributeName = (attributeName) => attributeNames[attributeName] ?? attributeName;
	const viewBoxWidth = icon.size ?? icon.width ?? defaultAttributes["width"];
	const viewBoxHeight = icon.size ?? icon.height ?? defaultAttributes["height"];
	const aliasClassNames = icon.aliases?.filter((alias) => typeof alias === "string" && alias.trim() !== "").map((alias) => `lucide-${alias}`) ?? [];
	const iconClassNames = [...icon.name ? [`lucide-${icon.name}`] : [], ...aliasClassNames];
	const classNamesFromClassName = params.className?.split(" ").filter(Boolean) ?? [];
	const className = params.includeDefaultClasses === false ? mergeClasses(...classNamesFromClassName) : mergeClasses("lucide", ...iconClassNames, ...classNamesFromClassName);
	const calculatedStrokeWidth = params.absoluteStrokeWidth ? Number(params.strokeWidth ?? defaultAttributes["stroke-width"]) * Number(icon.size ?? icon.width ?? defaultAttributes["width"]) / Number(params.size ?? params.width ?? defaultAttributes["width"]) : params.strokeWidth ?? defaultAttributes["stroke-width"];
	return [
		"svg",
		{
			...Object.entries(defaultAttributes).reduce((attrs, [attrName, value]) => {
				attrs[getAttributeName(attrName)] = value;
				return attrs;
			}, {}),
			..."color" in params && params.color && { [getAttributeName("stroke")]: params.color },
			..."size" in params && isDefined(params.size) && {
				[getAttributeName("width")]: params.size,
				[getAttributeName("height")]: params.size
			},
			..."width" in params && isDefined(params.width) && { [getAttributeName("width")]: params.width },
			..."height" in params && isDefined(params.height) && { [getAttributeName("height")]: params.height },
			[getAttributeName("stroke-width")]: calculatedStrokeWidth,
			...className && { [getAttributeName("class")]: className },
			[getAttributeName("viewBox")]: `0 0 ${viewBoxWidth} ${viewBoxHeight}`,
			...params.hasA11yProp === false ? { [getAttributeName("aria-hidden")]: "true" } : {},
			..."attributes" in params && params.attributes
		},
		icon.node.map((child) => {
			const [name, attrs, children] = child;
			const nextAttrs = params.nonScalingStroke ? {
				[getAttributeName("vector-effect")]: "non-scaling-stroke",
				...attrs
			} : attrs;
			return children ? [
				name,
				nextAttrs,
				children
			] : [name, nextAttrs];
		})
	];
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/utils/hasA11yProp.js
/**
* @file
* @license @lucide/svelte v1.60.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
/**
* Check if a component has an accessibility prop
*
* @param {object} props
* @returns {boolean} Whether the component has an accessibility prop
*/
var hasA11yProp = (props) => {
	for (const prop in props) if (prop.startsWith("aria-") || prop === "role" || prop === "title") return true;
	return false;
};
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/context.js
/**
* @file
* @license @lucide/svelte v1.60.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var LucideContext = Symbol("lucide-context");
var getLucideContext = () => getContext(LucideContext);
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/Icon.svelte
var rest_excludes$14 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy",
	"color",
	"size",
	"width",
	"height",
	"strokeWidth",
	"absoluteStrokeWidth",
	"nonScalingStroke",
	"iconNode",
	"icon",
	"class",
	"children"
]);
var root$3 = from_svg(`<svg><!><!></svg>`);
function Icon($$anchor, $$props) {
	push($$props, true);
	const globalProps = getLucideContext() ?? {};
	const color = prop($$props, "color", 19, () => globalProps.color ?? "currentColor"), size = prop($$props, "size", 19, () => globalProps.size ?? 24), width = prop($$props, "width", 19, size), height = prop($$props, "height", 19, size), strokeWidth = prop($$props, "strokeWidth", 19, () => globalProps.strokeWidth ?? 2), absoluteStrokeWidth = prop($$props, "absoluteStrokeWidth", 19, () => globalProps.absoluteStrokeWidth ?? false), nonScalingStroke = prop($$props, "nonScalingStroke", 19, () => globalProps.nonScalingStroke ?? false), iconNode = prop($$props, "iconNode", 19, () => []), icon = prop($$props, "icon", 19, () => ({
		node: iconNode(),
		aliases: [],
		size: 24
	})), props = rest_props($$props, rest_excludes$14);
	const hasAccessibleProp = user_derived(() => Boolean($$props.children) || hasA11yProp(props));
	const $$d = user_derived(() => buildLucideIconNode(icon(), {
		color: color(),
		width: width(),
		height: height(),
		strokeWidth: strokeWidth(),
		absoluteStrokeWidth: absoluteStrokeWidth(),
		nonScalingStroke: nonScalingStroke(),
		className: mergeClasses("lucide-icon", globalProps.class),
		hasA11yProp: get(hasAccessibleProp),
		attributes: props
	})), $$array = user_derived(() => to_array(get($$d), 3)), svgAttributes = user_derived(() => get($$array)[1]), builtIconNode = user_derived(() => fallback(get($$array)[2], () => [], true));
	const iconAttributes = user_derived(() => ({
		...get(svgAttributes),
		class: [...get(svgAttributes).class.split(" "), $$props.class]
	}));
	var svg = root$3();
	attribute_effect(svg, () => ({ ...get(iconAttributes) }));
	var node = child(svg);
	each(node, 17, () => get(builtIconNode), index, ($$anchor, $$item) => {
		var $$array_1 = user_derived(() => to_array(get($$item), 2));
		let tag = () => get($$array_1)[0];
		let attrs = () => get($$array_1)[1];
		var fragment = comment();
		var node_1 = first_child(fragment);
		element(node_1, tag, true, ($$element, $$anchor) => {
			attribute_effect($$element, () => ({ ...attrs() }));
		});
		append($$anchor, fragment);
	});
	var node_2 = sibling(node);
	snippet(node_2, () => $$props.children ?? noop);
	reset(svg);
	append($$anchor, svg);
	pop();
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/arrow-right.svelte
var __iconData$13 = {
	"name": "arrow-right",
	"size": 24,
	"node": [["path", { "d": "M5 12h14" }], ["path", { "d": "m12 5 7 7-7 7" }]]
};
__iconData$13.node;
var rest_excludes$13 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Arrow_right($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$13);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$13;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/arrow-down.svelte
var __iconData$12 = {
	"name": "arrow-down",
	"size": 24,
	"node": [["path", { "d": "M12 5v14" }], ["path", { "d": "m19 12-7 7-7-7" }]]
};
__iconData$12.node;
var rest_excludes$12 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Arrow_down($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$12);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$12;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/arrow-left.svelte
var __iconData$11 = {
	"name": "arrow-left",
	"size": 24,
	"node": [["path", { "d": "m12 19-7-7 7-7" }], ["path", { "d": "M19 12H5" }]]
};
__iconData$11.node;
var rest_excludes$11 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Arrow_left($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$11);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$11;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/arrow-up.svelte
var __iconData$10 = {
	"name": "arrow-up",
	"size": 24,
	"node": [["path", { "d": "m5 12 7-7 7 7" }], ["path", { "d": "M12 19V5" }]]
};
__iconData$10.node;
var rest_excludes$10 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Arrow_up($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$10);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$10;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/wand-sparkles.svelte
var __iconData$9 = {
	"name": "wand-sparkles",
	"size": 24,
	"node": [
		["path", { "d": "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" }],
		["path", { "d": "m14 7 3 3" }],
		["path", { "d": "M5 6v4" }],
		["path", { "d": "M19 14v4" }],
		["path", { "d": "M10 2v2" }],
		["path", { "d": "M7 8H3" }],
		["path", { "d": "M21 16h-4" }],
		["path", { "d": "M11 3H9" }]
	],
	"aliases": ["wand-2"]
};
__iconData$9.node;
var rest_excludes$9 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Wand_sparkles($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$9);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$9;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/fold-horizontal.svelte
var __iconData$8 = {
	"name": "fold-horizontal",
	"size": 24,
	"node": [
		["path", { "d": "M2 12h6" }],
		["path", { "d": "M22 12h-6" }],
		["path", { "d": "M12 2v2" }],
		["path", { "d": "M12 8v2" }],
		["path", { "d": "M12 14v2" }],
		["path", { "d": "M12 20v2" }],
		["path", { "d": "m19 9-3 3 3 3" }],
		["path", { "d": "m5 15 3-3-3-3" }]
	]
};
__iconData$8.node;
var rest_excludes$8 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Fold_horizontal($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$8);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$8;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/unfold-horizontal.svelte
var __iconData$7 = {
	"name": "unfold-horizontal",
	"size": 24,
	"node": [
		["path", { "d": "M16 12h6" }],
		["path", { "d": "M8 12H2" }],
		["path", { "d": "M12 2v2" }],
		["path", { "d": "M12 8v2" }],
		["path", { "d": "M12 14v2" }],
		["path", { "d": "M12 20v2" }],
		["path", { "d": "m19 15 3-3-3-3" }],
		["path", { "d": "m5 9-3 3 3 3" }]
	]
};
__iconData$7.node;
var rest_excludes$7 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Unfold_horizontal($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$7);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$7;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/zoom-in.svelte
var __iconData$6 = {
	"name": "zoom-in",
	"size": 24,
	"node": [
		["circle", {
			"cx": "11",
			"cy": "11",
			"r": "8"
		}],
		["line", {
			"x1": "21",
			"x2": "16.65",
			"y1": "21",
			"y2": "16.65"
		}],
		["line", {
			"x1": "11",
			"x2": "11",
			"y1": "8",
			"y2": "14"
		}],
		["line", {
			"x1": "8",
			"x2": "14",
			"y1": "11",
			"y2": "11"
		}]
	]
};
__iconData$6.node;
var rest_excludes$6 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Zoom_in($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$6);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$6;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/zoom-out.svelte
var __iconData$5 = {
	"name": "zoom-out",
	"size": 24,
	"node": [
		["circle", {
			"cx": "11",
			"cy": "11",
			"r": "8"
		}],
		["line", {
			"x1": "21",
			"x2": "16.65",
			"y1": "21",
			"y2": "16.65"
		}],
		["line", {
			"x1": "8",
			"x2": "14",
			"y1": "11",
			"y2": "11"
		}]
	]
};
__iconData$5.node;
var rest_excludes$5 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Zoom_out($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$5);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$5;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/scan.svelte
var __iconData$4 = {
	"name": "scan",
	"size": 24,
	"node": [
		["path", { "d": "M3 7V5a2 2 0 0 1 2-2h2" }],
		["path", { "d": "M17 3h2a2 2 0 0 1 2 2v2" }],
		["path", { "d": "M21 17v2a2 2 0 0 1-2 2h-2" }],
		["path", { "d": "M7 21H5a2 2 0 0 1-2-2v-2" }]
	]
};
__iconData$4.node;
var rest_excludes$4 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Scan($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$4);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$4;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/network.svelte
var __iconData$3 = {
	"name": "network",
	"size": 24,
	"node": [
		["rect", {
			"x": "16",
			"y": "16",
			"width": "6",
			"height": "6",
			"rx": "1"
		}],
		["rect", {
			"x": "2",
			"y": "16",
			"width": "6",
			"height": "6",
			"rx": "1"
		}],
		["rect", {
			"x": "9",
			"y": "2",
			"width": "6",
			"height": "6",
			"rx": "1"
		}],
		["path", { "d": "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" }],
		["path", { "d": "M12 12V8" }]
	]
};
__iconData$3.node;
var rest_excludes$3 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Network($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$3);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$3;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/orbit.svelte
var __iconData$2 = {
	"name": "orbit",
	"size": 24,
	"node": [
		["path", { "d": "M20.341 6.484A10 10 0 0 1 10.266 21.85" }],
		["path", { "d": "M3.659 17.516A10 10 0 0 1 13.74 2.152" }],
		["circle", {
			"cx": "12",
			"cy": "12",
			"r": "3"
		}],
		["circle", {
			"cx": "19",
			"cy": "5",
			"r": "2"
		}],
		["circle", {
			"cx": "5",
			"cy": "19",
			"r": "2"
		}]
	]
};
__iconData$2.node;
var rest_excludes$2 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Orbit($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$2);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$2;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/atom.svelte
var __iconData$1 = {
	"name": "atom",
	"size": 24,
	"node": [
		["circle", {
			"cx": "12",
			"cy": "12",
			"r": "1"
		}],
		["path", { "d": "M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" }],
		["path", { "d": "M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" }]
	]
};
__iconData$1.node;
var rest_excludes$1 = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Atom($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes$1);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData$1;
	} }));
}
// node_modules/.deno/@lucide+svelte@1.60.0/node_modules/@lucide/svelte/dist/icons/grid-3x3.svelte
var __iconData = {
	"name": "grid-3x3",
	"size": 24,
	"node": [
		["rect", {
			"width": "18",
			"height": "18",
			"x": "3",
			"y": "3",
			"rx": "2"
		}],
		["path", { "d": "M3 9h18" }],
		["path", { "d": "M3 15h18" }],
		["path", { "d": "M9 3v18" }],
		["path", { "d": "M15 3v18" }]
	],
	"aliases": ["grid", "grid-3-x-3"]
};
__iconData.node;
var rest_excludes = /* @__PURE__ */ new Set([
	"$$slots",
	"$$events",
	"$$legacy"
]);
function Grid_3x3($$anchor, $$props) {
	let props = rest_props($$props, rest_excludes);
	Icon($$anchor, spread_props(() => props, { get icon() {
		return __iconData;
	} }));
}
// ../../../../src/plugins/verifier-mcrl2/widgets/study/algorithms.ts
/** The graph again, drawn by another algorithm from its layered layout. */
function redraw(l, algorithm, opts = {}) {
	const gap = opts.gap ?? 90;
	const margin = opts.margin ?? 24;
	const nodes = l.nodes.map((n) => ({ ...n }));
	if (nodes.length === 0) return l;
	if (algorithm === "radial") radial(nodes, gap);
	else if (algorithm === "grid") grid(nodes, gap);
	else force(nodes, l.edges, gap);
	return bounded(nodes, edgesFor(nodes, l.edges), margin);
}
/** Layers on rings around the first layer's centre, each node at its place in its layer's order. */
function radial(nodes, gap) {
	const layers = /* @__PURE__ */ new Map();
	for (const n of nodes) layers.set(n.layer, [...layers.get(n.layer) ?? [], n]);
	[...layers.entries()].sort((a, b) => a[0] - b[0]).forEach(([, ns], ring) => {
		ns.sort((a, b) => a.x + a.y - (b.x + b.y));
		const r = ring === 0 && ns.length === 1 ? 0 : (ring + 1) * gap;
		ns.forEach((n, i) => {
			const a = -Math.PI / 2 + 2 * Math.PI * i / ns.length + ring * .35;
			n.x = r * Math.cos(a);
			n.y = r * Math.sin(a);
		});
	});
}
/** In rows, in reading order, as many columns as make the drawing about square. */
function grid(nodes, gap) {
	const order = [...nodes].sort((a, b) => a.layer - b.layer || a.x + a.y - (b.x + b.y));
	const cols = Math.max(1, Math.ceil(Math.sqrt(order.length)));
	order.forEach((n, i) => {
		n.x = i % cols * gap * 1.4;
		n.y = Math.floor(i / cols) * gap;
	});
}
/** Springs: linked nodes pull together, every pair pushes apart; a fixed number of cooling steps from the layered start. */
function force(nodes, edges, gap) {
	const idx = new Map(nodes.map((n, i) => [n.id, i]));
	const links = edges.filter((e) => !e.self).map((e) => [idx.get(e.from), idx.get(e.to)]).filter(([a, b]) => a !== void 0 && b !== void 0);
	const k = gap;
	let t = gap;
	for (let step = 0; step < 300; step++) {
		const d = nodes.map(() => [0, 0]);
		for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
			let dx = nodes[i].x - nodes[j].x;
			let dy = nodes[i].y - nodes[j].y;
			if (dx === 0 && dy === 0) {
				dx = .01 * (i - j);
				dy = .01;
			}
			const dist = Math.max(1, Math.hypot(dx, dy));
			const f = k * k / dist;
			d[i][0] += dx / dist * f;
			d[i][1] += dy / dist * f;
			d[j][0] -= dx / dist * f;
			d[j][1] -= dy / dist * f;
		}
		for (const [a, b] of links) {
			const dx = nodes[a].x - nodes[b].x;
			const dy = nodes[a].y - nodes[b].y;
			const dist = Math.max(1, Math.hypot(dx, dy));
			const f = dist * dist / k;
			d[a][0] -= dx / dist * f;
			d[a][1] -= dy / dist * f;
			d[b][0] += dx / dist * f;
			d[b][1] += dy / dist * f;
		}
		nodes.forEach((n, i) => {
			const [dx, dy] = d[i];
			const len = Math.max(1e-9, Math.hypot(dx, dy));
			n.x += dx / len * Math.min(len, t);
			n.y += dy / len * Math.min(len, t);
		});
		t = Math.max(.5, t * .97);
	}
}
/** Edges as gentle arcs from border to border; a loop above its node. */
function edgesFor(nodes, edges) {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	return edges.map((e) => {
		const a = byId.get(e.from);
		const b = byId.get(e.to);
		if (!a || !b) return e;
		if (e.self || a === b) {
			const r = a.height / 2;
			const p = [
				[a.x - 6, a.y - r],
				[a.x - 26, a.y - r - 34],
				[a.x + 26, a.y - r - 34],
				[a.x + 6, a.y - r]
			];
			return {
				...e,
				points: p,
				path: pathOf(p),
				arrow: arrowOf(p),
				label: {
					x: a.x,
					y: a.y - r - 34
				}
			};
		}
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dist = Math.max(1, Math.hypot(dx, dy));
		const ux = dx / dist;
		const uy = dy / dist;
		const ra = Math.min(a.width, a.height) / 2;
		const rb = Math.min(b.width, b.height) / 2;
		const s = [a.x + ux * ra, a.y + uy * ra];
		const t = [b.x - ux * rb, b.y - uy * rb];
		const bend = dist / 7;
		const nx = -uy * bend;
		const ny = ux * bend;
		const p = [
			s,
			[s[0] + dx / 3 + nx, s[1] + dy / 3 + ny],
			[t[0] - dx / 3 + nx, t[1] - dy / 3 + ny],
			t
		];
		return {
			...e,
			points: p,
			path: pathOf(p),
			arrow: arrowOf(p),
			label: {
				x: (s[0] + t[0]) / 2 + nx,
				y: (s[1] + t[1]) / 2 + ny - 6
			}
		};
	});
}
/** Shifted to start at the margin, its width and height covering every node and curve. */
function bounded(nodes, edges, margin) {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	const take = (x, y) => {
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	};
	for (const n of nodes) {
		take(n.x - n.width / 2, n.y - n.height / 2);
		take(n.x + n.width / 2, n.y + n.height / 2);
	}
	for (const e of edges) for (const p of e.points) take(p[0], p[1]);
	const dx = margin - x0;
	const dy = margin - y0;
	const shift = (p) => [p[0] + dx, p[1] + dy];
	return {
		width: x1 - x0 + 2 * margin,
		height: y1 - y0 + 2 * margin,
		nodes: nodes.map((n) => ({
			...n,
			x: n.x + dx,
			y: n.y + dy
		})),
		edges: edges.map((e) => {
			const points = e.points.map(shift);
			return {
				...e,
				points,
				path: pathOf(points),
				arrow: arrowOf(points),
				label: {
					x: e.label.x + dx,
					y: e.label.y + dy
				}
			};
		})
	};
}
// ../../../../src/plugins/verifier-mcrl2/widgets/study/Graph.svelte
var lerp = (a, b, t) => a + (b - a) * t;
function between(a, b, t) {
	const na = new Map(a.nodes.map((n) => [n.id, n]));
	const ea = new Map(a.edges.map((e) => [e.id, e]));
	return {
		width: lerp(a.width, b.width, t),
		height: lerp(a.height, b.height, t),
		nodes: b.nodes.map((n) => {
			const o = na.get(n.id);
			return o ? {
				...n,
				x: lerp(o.x, n.x, t),
				y: lerp(o.y, n.y, t)
			} : n;
		}),
		edges: b.edges.map((e) => {
			const o = ea.get(e.id);
			if (!o || o.points.length !== e.points.length) return e;
			const points = e.points.map((q, i) => [lerp(o.points[i][0], q[0], t), lerp(o.points[i][1], q[1], t)]);
			return {
				...e,
				points,
				path: pathOf(points),
				arrow: arrowOf(points),
				label: {
					x: lerp(o.label.x, e.label.x, t),
					y: lerp(o.label.y, e.label.y, t)
				}
			};
		})
	};
}
/** How long a move takes: the motion token's, none when the person asked for less motion. */
function motionMs() {
	if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
	const v = getComputedStyle(document.documentElement).getPropertyValue("--motion-duration-normal").trim();
	const n = parseFloat(v);
	return Number.isFinite(n) ? v.endsWith("ms") ? n : n * 1e3 : 0;
}
var root$2 = from_html(`<button><!></button>`);
var root_1$2 = from_html(`<!> <span class="gap svelte-15basb6"></span>`, 1);
var root_2$2 = from_html(`<button class="ico word svelte-15basb6" aria-label="Fit" title="Fit the whole drawing in the card"><!><span>Fit</span></button>`);
var root_3$1 = from_svg(`<path></path>`);
var root_4$1 = from_svg(`<text text-anchor="middle"> </text>`);
var root_5 = from_svg(`<title> </title>`);
var root_6 = from_svg(`<g><path class="line svelte-15basb6"></path><!><!><!></g>`);
var root_7 = from_svg(`<circle class="initial svelte-15basb6" r="8"></circle>`);
var root_8 = from_svg(`<rect class="shape svelte-15basb6" rx="12"></rect><text class="nlabel svelte-15basb6" y="4" text-anchor="middle"> </text>`, 1);
var root_9 = from_svg(`<circle class="halo svelte-15basb6" r="17"></circle><circle class="disc svelte-15basb6" r="11"></circle>`, 1);
var root_10 = from_svg(`<tspan class="aarg svelte-15basb6" dx="6"> </tspan>`);
var root_11 = from_svg(`<circle class="maybe svelte-15basb6" r="6"></circle><text class="aword svelte-15basb6" y="4"> <!></text>`, 1);
var root_12 = from_svg(`<circle class="dot svelte-15basb6" r="7"></circle>`);
var root_13 = from_svg(`<text class="pname svelte-15basb6" y="4" text-anchor="start"> </text>`);
var root_14 = from_svg(`<text class="pname svelte-15basb6" text-anchor="middle"> </text>`);
var root_15 = from_svg(`<!><!>`, 1);
var root_16 = from_svg(`<circle class="shape svelte-15basb6"></circle><text class="nlabel svelte-15basb6" y="4" text-anchor="middle"> </text>`, 1);
var root_17 = from_svg(`<tspan> </tspan>`);
var root_18 = from_svg(`<text class="nsub svelte-15basb6" text-anchor="start"></text>`);
var root_19 = from_svg(`<tspan x="0"> </tspan>`);
var root_20 = from_svg(`<text class="nsub svelte-15basb6" text-anchor="middle"></text>`);
var root_21 = from_svg(`<g role="button" tabindex="0"><circle class="hit svelte-15basb6" r="9"></circle><circle class="pinhead svelte-15basb6" cy="-2" r="3.6"></circle><line class="pinneedle svelte-15basb6" x1="0" y1="1.5" x2="0" y2="7"></line><title> </title></g>`);
var root_22 = from_svg(`<g role="button" tabindex="0"><circle class="hit svelte-15basb6" r="9"></circle><path class="starshape svelte-15basb6" d="M0,-5 L1.5,-1.6 L5,-1.6 L2.2,0.7 L3.2,4.4 L0,2.2 L-3.2,4.4 L-2.2,0.7 L-5,-1.6 L-1.5,-1.6 Z"></path><title> </title></g>`);
var root_23 = from_svg(`<g class="place svelte-15basb6"><g role="button" tabindex="0"><rect class="pad svelte-15basb6"></rect><!><!><!></g><!><!></g>`);
var root_24 = from_html(`<div><svg role="group"><!><!></svg></div>`);
var root_25 = from_html(`<div class="graph svelte-15basb6"><div class="controls svelte-15basb6" role="toolbar"><!> <!> <span class="gap svelte-15basb6"></span> <button class="ico svelte-15basb6" aria-label="Closer together" title="Closer together"><!></button> <button class="ico svelte-15basb6" aria-label="Further apart" title="Further apart"><!></button> <span class="sep svelte-15basb6"></span> <button class="ico svelte-15basb6" aria-label="Zoom out" title="Zoom out"><!></button> <span role="status"> </span> <button class="ico svelte-15basb6" aria-label="Zoom in" title="Zoom in"><!></button> <!></div> <div><!></div></div>`);
var $$css$2 = {
	hash: "svelte-15basb6",
	code: ".graph.svelte-15basb6 {position:relative;display:flex;flex-direction:column;block-size:100%;min-block-size:0;}\n  /* The view tools float over the drawing's top corner, out of the way until the pointer or the focus comes to the\n     graph; where nothing hovers, or more contrast is asked for, they always show. */.controls.svelte-15basb6 {position:absolute;z-index:4;inset-block-start:var(--space-none);inset-inline-end:var(--space-none);display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:var(--space-none);max-inline-size:100%;padding:var(--space-none) var(--space-xs);font-size:var(--font-size-2xs);color:var(--color-text-muted);background:var(--color-surface-raised);border-radius:var(--radius-md);opacity:0;transition:opacity var(--motion-duration-fast) var(--motion-easing-standard);}.graph.svelte-15basb6:focus-within .controls:where(.svelte-15basb6) {opacity:1;}\n  @media (hover: hover) {.graph.svelte-15basb6:hover .controls:where(.svelte-15basb6) {opacity:1;}\n  }\n  @media (hover: none), (prefers-contrast: more) {.controls.svelte-15basb6 {opacity:1;}\n  }.controls.svelte-15basb6 button:where(.svelte-15basb6) {font:inherit;min-block-size:var(--size-target);min-inline-size:var(--size-target);padding:var(--space-none) var(--space-sm);color:var(--color-text-muted);background:none;border:var(--border-width-thin) solid transparent;border-radius:var(--radius-full);cursor:pointer;}.controls.svelte-15basb6 button:where(.svelte-15basb6):hover {color:var(--color-accent);}.controls.svelte-15basb6 button:where(.svelte-15basb6):focus-visible,\n  .node.svelte-15basb6:focus-visible,\n  .mark.svelte-15basb6:focus-visible {outline:var(--border-width-focus) solid var(--color-focus);}.controls.svelte-15basb6 .ico:where(.svelte-15basb6) {display:inline-flex;align-items:center;justify-content:center;padding:var(--space-none);}.controls.svelte-15basb6 button:where(.svelte-15basb6):disabled {opacity:0.35;cursor:default;}.gap.svelte-15basb6 {inline-size:var(--space-sm);}.controls.svelte-15basb6 button.on:where(.svelte-15basb6) {color:var(--color-accent);}.controls.svelte-15basb6 .word:where(.svelte-15basb6) {gap:var(--space-xs);padding-inline:var(--space-xs);}.sep.svelte-15basb6 {flex:1;}.pct.svelte-15basb6 {min-inline-size:var(--size-target);text-align:center;cursor:default;user-select:none;}.pct.quiet.svelte-15basb6 {font-style:italic;color:var(--color-text-muted);}\n  /* The window takes the height the card gives; with `grow`, a card that gives none has a least of one. */.window.svelte-15basb6 {position:relative;flex:1;min-block-size:0;}.window.grow.svelte-15basb6 {min-block-size:var(--size-w-16);}.graph.svelte-15basb6 .pan {position:absolute;inset:0;overflow:auto;}.measure.fitting.svelte-15basb6 {inline-size:100%;block-size:100%;}.measure.svelte-15basb6 {min-inline-size:100%;min-block-size:100%;display:grid;place-items:center;}svg.svelte-15basb6 {display:block;}svg.fit.svelte-15basb6 {inline-size:100%;block-size:100%;}text.svelte-15basb6 {font-family:var(--font-family-body);}\n\n\n  /* ---- edges: the road solid, the roads left dashed and faint, what may come dotted */.line.svelte-15basb6 {fill:none;stroke:var(--color-text-muted);stroke-width:1.3;}.head.svelte-15basb6 {fill:var(--color-text-muted);stroke:var(--color-text-muted);stroke-width:1.3;stroke-linejoin:round;}.edge.road.svelte-15basb6 .line:where(.svelte-15basb6),\n  .edge.road.svelte-15basb6 .head:where(.svelte-15basb6) {stroke:var(--color-text);}.edge.road.svelte-15basb6 .head:where(.svelte-15basb6) {fill:var(--color-text);}\n  /* UML: a transition's arrowhead is open. */.edge.svelte-15basb6 .head.open:where(.svelte-15basb6) {fill:none;}.edge.faded.svelte-15basb6 {opacity:0.38;}.edge.faded.svelte-15basb6 .line:where(.svelte-15basb6) {stroke-dasharray:5 4;}.edge.ahead.svelte-15basb6 .line:where(.svelte-15basb6) {stroke-dasharray:1.5 4;stroke-linecap:round;}.edge.ahead.svelte-15basb6 {opacity:0.55;}.elabel.svelte-15basb6 {font-size:var(--font-size-2xs);fill:var(--color-text-muted);paint-order:stroke;stroke:var(--color-surface-raised);stroke-width:4;stroke-linejoin:round;}.edge.road.svelte-15basb6 .elabel:where(.svelte-15basb6) {fill:var(--color-text);}\n\n  /* ---- nodes */.node.svelte-15basb6 {cursor:pointer;border:var(--border-width-thin) solid transparent;}\n  /* The padding that brings a node to a finger's size, drawn in nothing, only where the pointer is a finger. */.pad.svelte-15basb6 {display:none;fill:transparent;}\n  @media (pointer: coarse) {.pad.svelte-15basb6 {display:inline;}.controls.svelte-15basb6 button:where(.svelte-15basb6) {min-block-size:var(--size-control);min-inline-size:var(--size-control);}\n  }.shape.svelte-15basb6 {fill:var(--color-surface-raised);stroke:var(--color-text);stroke-width:1.4;}.initial.svelte-15basb6 {fill:var(--color-text);}.nlabel.svelte-15basb6 {font-size:var(--font-size-xs);fill:var(--color-text);}.nsub.svelte-15basb6 {font-size:var(--font-size-2xs);fill:var(--color-text-muted);}.node.svelte-15basb6:hover .shape:where(.svelte-15basb6),\n  .node.svelte-15basb6:focus .shape:where(.svelte-15basb6) {stroke:var(--color-accent);}.node.current.svelte-15basb6 .shape:where(.svelte-15basb6) {fill:var(--color-accent);stroke:var(--color-accent);}.node.current.svelte-15basb6 .nlabel:where(.svelte-15basb6) {fill:var(--color-on-accent);}.node.faded.svelte-15basb6 {opacity:0.38;}.node.faded.pinned.svelte-15basb6 {opacity:1;}.node.ahead.svelte-15basb6 .shape:where(.svelte-15basb6) {fill:none;stroke:var(--color-text-muted);stroke-dasharray:2 3;}.node.ahead.svelte-15basb6 .nlabel:where(.svelte-15basb6) {fill:var(--color-text-muted);}.node.run.svelte-15basb6 .shape:where(.svelte-15basb6) {fill:var(--color-accent);stroke:var(--color-accent);}.node.run.svelte-15basb6 .nlabel:where(.svelte-15basb6),\n  .node.done.svelte-15basb6 .nlabel:where(.svelte-15basb6),\n  .node.queue.svelte-15basb6 .nlabel:where(.svelte-15basb6) {fill:var(--color-surface-raised);}.node.ask.svelte-15basb6 .shape:where(.svelte-15basb6) {stroke:var(--color-accent);stroke-width:2.6;}.node.queue.svelte-15basb6 .shape:where(.svelte-15basb6) {fill:var(--color-text-muted);stroke:var(--color-text-muted);}.node.done.svelte-15basb6 .shape:where(.svelte-15basb6) {fill:var(--color-text);}.node.held.svelte-15basb6 .shape:where(.svelte-15basb6) {stroke-dasharray:2 3;}.node.fail.svelte-15basb6 .shape:where(.svelte-15basb6) {stroke:var(--color-danger);}.node.picked.svelte-15basb6 .shape:where(.svelte-15basb6) {stroke:var(--color-accent);stroke-width:3;}.node.goal.svelte-15basb6 .shape:where(.svelte-15basb6) {stroke-width:3;}\n\n  /* ---- a path: the timeline's drawing */.dot.svelte-15basb6 {fill:var(--color-surface-raised);stroke:var(--color-text);stroke-width:1.4;}.disc.svelte-15basb6 {fill:var(--color-accent);}.halo.svelte-15basb6 {fill:none;stroke:var(--color-accent);stroke-width:1;opacity:0.45;}.maybe.svelte-15basb6 {fill:none;stroke:var(--color-text-muted);stroke-width:1.2;}.aword.svelte-15basb6 {font-size:var(--font-size-sm);fill:var(--color-text-muted);}.aarg.svelte-15basb6 {font-family:var(--font-family-mono);font-size:var(--font-size-2xs);}.node.svelte-15basb6:hover .maybe:where(.svelte-15basb6),\n  .node.svelte-15basb6:focus .maybe:where(.svelte-15basb6) {stroke:var(--color-accent);fill:var(--color-accent-soft);}.node.svelte-15basb6:hover .aword:where(.svelte-15basb6),\n  .node.svelte-15basb6:focus .aword:where(.svelte-15basb6) {fill:var(--color-accent);}.node.svelte-15basb6:hover .dot:where(.svelte-15basb6),\n  .node.svelte-15basb6:focus .dot:where(.svelte-15basb6) {stroke:var(--color-accent);}.pname.svelte-15basb6 {font-family:var(--font-family-mono);font-size:var(--font-size-2xs);fill:var(--color-text-muted);}.elabel.big.svelte-15basb6 {font-size:var(--font-size-sm);}.node.ahead.svelte-15basb6 {opacity:1;}\n\n  /* ---- the marks: pin and bookmark, shown on hover and focus, always when set */\n  /* A mark nobody can see takes no clicks: a hidden mark of one state would otherwise sit over its neighbour. */.mark.svelte-15basb6 {cursor:pointer;border:var(--border-width-thin) solid transparent;opacity:0;pointer-events:none;transition:opacity var(--motion-duration-fast) var(--motion-easing-standard);}.place.svelte-15basb6:focus-within .mark:where(.svelte-15basb6),\n  .mark.set.svelte-15basb6 {opacity:1;pointer-events:auto;}\n  @media (hover: hover) {.place.svelte-15basb6:hover .mark:where(.svelte-15basb6) {opacity:1;pointer-events:auto;}\n  }\n  /* Where nothing hovers (a finger) the marks are always there, faint, and as large as a finger needs. */\n  @media (hover: none) {.mark.svelte-15basb6:not(.set) {opacity:0.55;pointer-events:auto;}.mark.svelte-15basb6 .hit {r:calc(var(--size-control) / 2);}\n  }\n  /* On the current state the marks are always there, faint, so that a person finds them. */.place.svelte-15basb6:has(.node.current:where(.svelte-15basb6)) .mark:where(.svelte-15basb6):not(.set) {opacity:0.55;pointer-events:auto;}.hit.svelte-15basb6 {fill:transparent;}.pinhead.svelte-15basb6 {fill:none;stroke:var(--color-text-muted);stroke-width:1.4;}.pinneedle.svelte-15basb6 {stroke:var(--color-text-muted);stroke-width:1.4;}.pin.set.svelte-15basb6 .pinhead:where(.svelte-15basb6) {fill:var(--color-accent);stroke:var(--color-accent);}.pin.set.svelte-15basb6 .pinneedle:where(.svelte-15basb6) {stroke:var(--color-accent);}.starshape.svelte-15basb6 {fill:none;stroke:var(--color-text-muted);stroke-width:1.2;stroke-linejoin:round;}.star.set.svelte-15basb6 .starshape:where(.svelte-15basb6) {fill:var(--color-accent);stroke:var(--color-accent);}.mark.svelte-15basb6:hover .pinhead:where(.svelte-15basb6),\n  .mark.svelte-15basb6:hover .pinneedle:where(.svelte-15basb6),\n  .mark.svelte-15basb6:hover .starshape:where(.svelte-15basb6) {stroke:var(--color-accent);}"
};
function Graph($$anchor, $$props) {
	push($$props, true);
	append_styles($$anchor, $$css$2);
	/** uml-state-machine and directed-graph are named notations (named.ts); path is the timeline's own drawing, a
	* path of states on a line with the steps possible now fanning out, which is no standard and is never called one. */
	/** Nodes of the same layer drawn first come first: the road before the roads left. */
	/** Follow this node: scroll it into view when it changes. */
	/** Zoom to fit while the drawing is larger than its box and nobody has zoomed by hand. */
	/** Where the flow goes at first: auto lets the card's shape decide (horizontal in a wide card, vertical in a tall one). */
	/** Place each node once and never move it as the graph grows (a path explored), at the price of more crossings. */
	/** The card gives the graph no height of its own (its height is its contents'): the window has a least of its own. */
	let notation = prop($$props, "notation", 3, "directed-graph"), direction = prop($$props, "direction", 3, "horizontal"), pinned = prop($$props, "pinned", 19, () => /* @__PURE__ */ new Set()), bookmarked = prop($$props, "bookmarked", 19, () => /* @__PURE__ */ new Set()), follow = prop($$props, "follow", 3, null), autofit = prop($$props, "autofit", 3, false), stable = prop($$props, "stable", 3, false), grow = prop($$props, "grow", 3, false);
	const uml = user_derived(() => notation() === "uml-state-machine");
	const path = user_derived(() => notation() === "path");
	const isAhead = (n) => (n.cls ?? "").split(" ").includes("ahead");
	const isCurrent = (n) => (n.cls ?? "").split(" ").includes("current");
	/** In a path, the widest label on a step: the layers are that far apart, so no label covers another. */
	const edgeWidth = user_derived(() => Math.max(0, ...$$props.edges.filter((e) => !(e.cls ?? "").includes("ahead")).map((e) => e.label ? e.label.length * 6.6 : 0)));
	/** The widest caption, in the drawing's units. */
	const subWidth = user_derived(() => Math.max(0, ...$$props.nodes.map((n) => n.sub ? Math.max(...n.sub.split("\n").map((l) => l.length)) * 6.2 : 0)));
	const size = (n) => n.kind === "initial" ? {
		width: 18,
		height: 18
	} : get(uml) ? {
		width: Math.max(64, 18 + n.label.length * 8),
		height: 36
	} : get(path) ? isCurrent(n) ? {
		width: 26,
		height: 26
	} : {
		width: 16,
		height: 16
	} : {
		width: 34,
		height: 34
	};
	/** The card's box, which "auto" reads to choose where the flow goes, and fit reads to zoom. */
	let boxW = state(0);
	let boxH = state(0);
	let orient = state(proxy(untrack(() => $$props.orient ?? (direction() === "vertical" ? "down" : "right"))));
	let spacing = state(1);
	const flow = user_derived(() => get(orient) === "auto" ? get(boxH) > get(boxW) * 1.15 ? "down" : "right" : get(orient));
	const dir = user_derived(() => get(flow) === "down" || get(flow) === "up" ? "vertical" : "horizontal");
	const laid = user_derived(() => layout($$props.nodes.map((n) => ({
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
		direction: get(dir),
		incremental: stable(),
		layerGap: get(spacing) * (get(uml) ? 96 : get(path) ? get(dir) === "horizontal" ? Math.max(90, Math.min(150, get(edgeWidth) + 24)) : 64 : get(dir) === "horizontal" ? Math.max(84, get(subWidth) + 30) : 76),
		nodeGap: get(spacing) * (get(uml) ? 34 : get(path) ? get(dir) === "horizontal" ? 22 : 60 : get(subWidth) > 0 ? get(dir) === "horizontal" ? 58 : get(subWidth) + 24 : 40),
		...$$props.order ? { order: $$props.order } : {},
		...$$props.nodes.some((n) => n.rank !== void 0) ? { rank: Object.fromEntries($$props.nodes.filter((n) => n.rank !== void 0).map((n) => [n.id, n.rank])) } : {}
	}));
	/** The layout turned to flow right to left, or bottom to top: mirrored, arrows turned with it. */
	const mirror = (l, fx, fy) => {
		if (!fx && !fy) return l;
		const X = (x) => fx ? l.width - x : x;
		const Y = (y) => fy ? l.height - y : y;
		const pt = ([x, y]) => [X(x), Y(y)];
		return {
			...l,
			nodes: l.nodes.map((n) => ({
				...n,
				x: X(n.x),
				y: Y(n.y)
			})),
			edges: l.edges.map((e) => {
				const points = e.points.map(pt);
				return {
					...e,
					points,
					path: pathOf(points),
					arrow: arrowOf(points),
					label: {
						x: X(e.label.x),
						y: Y(e.label.y)
					}
				};
			})
		};
	};
	/** Edge labels' and fanned words' widths, in the drawing's units. */
	const labelW = (id) => {
		const e = $$props.edges.find((x) => x.id === id);
		return e?.label ? e.label.length * (get(path) ? 6.6 : 6) : 0;
	};
	const fanW = (id) => {
		const n = get(byId).get(id);
		return n ? (n.label.length + (n.sub?.length ?? 0)) * 6.6 + 12 : 0;
	};
	const routed = user_derived(() => route(get(laid), get(dir), {
		...get(path) ? {
			fan: $$props.nodes.filter(isAhead).map((n) => n.id),
			fanFrom: $$props.nodes.find(isCurrent)?.id ?? null,
			avoid: $$props.nodes.filter((n) => (n.cls ?? "").split(" ").includes("faded")).map((n) => n.id)
		} : {},
		fanWidth: fanW,
		labelWidth: labelW
	}));
	/** How the graph is drawn: in layers (with its flow), or around a centre, as springs, in rows. */
	let algorithm = state("layered");
	const placed = user_derived(() => get(algorithm) === "layered" ? mirror(get(routed), get(flow) === "left", get(flow) === "up") : redraw(get(laid), get(algorithm), { gap: 90 * get(spacing) }));
	let shown = state({
		nodes: [],
		edges: [],
		width: 0,
		height: 0
	});
	let frame = 0;
	user_effect(() => {
		const to = get(placed);
		const from = untrack(() => get(shown));
		cancelAnimationFrame(frame);
		const ms = motionMs();
		if (ms <= 0 || from.nodes.length === 0) {
			set(shown, to);
			return;
		}
		const t0 = performance.now();
		const step = (now) => {
			const t = Math.min(1, (now - t0) / ms);
			set(shown, between(from, to, 1 - (1 - t) * (1 - t)));
			if (t < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	});
	const byId = user_derived(() => new Map($$props.nodes.map((n) => [n.id, n])));
	/** Several loops on one node: their labels are stacked, one line each, never on top of each other. */
	const loopLine = user_derived(() => {
		const seen = /* @__PURE__ */ new Map();
		const out = /* @__PURE__ */ new Map();
		for (const e of $$props.edges) {
			if (e.from !== e.to) continue;
			const k = seen.get(e.from) ?? 0;
			out.set(e.id, k);
			seen.set(e.from, k + 1);
		}
		return out;
	});
	const edgeById = user_derived(() => new Map($$props.edges.map((e) => [e.id, e])));
	const finger = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
	let zoom = state(proxy(untrack(() => autofit() && !finger ? null : 1)));
	let box = state(void 0);
	const fit = () => set(zoom, null);
	const zoomBy = (f) => set(zoom, Math.max(.2, Math.min(4, (get(zoom) ?? 1) * f)), true);
	/** Room around the drawing for the captions under the nodes, which may be wider than the nodes. */
	const pad = user_derived(() => get(uml) ? 8 : get(path) ? 20 : Math.max(8, get(subWidth) / 2 - 10));
	const W = user_derived(() => get(placed).width + 2 * get(pad));
	const H = user_derived(() => get(placed).height + 2 * get(pad));
	let drawing = state(void 0);
	let followed = null;
	user_effect(() => {
		const id = follow();
		if (!id || id === followed || get(zoom) === null || !get(drawing)) return;
		followed = id;
		const d = get(drawing);
		setTimeout(() => {
			const el = [...d.querySelectorAll("g.node")].find((g) => g.dataset["id"] === id);
			const pan = d.closest(".pan");
			if (!el || !pan) return;
			const a = el.getBoundingClientRect();
			const b = pan.getBoundingClientRect();
			pan.scrollTo({
				left: pan.scrollLeft + a.left + a.width / 2 - b.left - b.width / 2,
				top: pan.scrollTop + a.top + a.height / 2 - b.top - b.height / 2,
				behavior: "smooth"
			});
		}, motionMs());
	});
	const arrow = (x, y, a) => {
		const r = a * Math.PI / 180;
		const back = (d, side) => {
			const t = r + Math.PI + side * .42;
			return `${x + Math.cos(t) * d},${y + Math.sin(t) * d}`;
		};
		return get(uml) ? `M ${back(9, -1)} L ${x},${y} L ${back(9, 1)}` : `M ${back(9, -1)} L ${x},${y} L ${back(9, 1)} Z`;
	};
	var div = root_25();
	var div_1 = child(div);
	var node = child(div_1);
	var consequent = ($$anchor) => {
		var fragment = root_1$2();
		var node_1 = first_child(fragment);
		each(node_1, 17, () => [
			[
				"layered",
				"In layers, along the flow",
				Network
			],
			[
				"radial",
				"Around a centre",
				Orbit
			],
			[
				"force",
				"As springs: linked nodes together",
				Atom
			],
			[
				"grid",
				"In rows",
				Grid_3x3
			]
		], ([a, says, I]) => a, ($$anchor, $$item) => {
			var $$array = user_derived(() => to_array(get($$item), 3));
			let a = () => get($$array)[0];
			let says = () => get($$array)[1];
			let I = () => get($$array)[2];
			var button = root$2();
			let classes;
			Icon$1(child(button), {
				children: ($$anchor, $$slotProps) => {
					var fragment_1 = comment();
					var node_3 = first_child(fragment_1);
					component(node_3, I, ($$anchor, I_1) => {
						I_1($$anchor, {});
					});
					append($$anchor, fragment_1);
				},
				$$slots: { default: true }
			});
			reset(button);
			template_effect(() => {
				classes = set_class(button, 1, "ico svelte-15basb6", null, classes, { on: get(algorithm) === a() });
				set_attribute(button, "aria-label", says());
				set_attribute(button, "title", says());
				set_attribute(button, "aria-pressed", get(algorithm) === a());
			});
			delegated("click", button, () => set(algorithm, a(), true));
			append($$anchor, button);
		});
		next(2);
		append($$anchor, fragment);
	};
	if_block(node, ($$render) => {
		if (!get(path)) $$render(consequent);
	});
	var node_4 = sibling(node, 2);
	var consequent_1 = ($$anchor) => {
		var fragment_2 = comment();
		var node_5 = first_child(fragment_2);
		each(node_5, 17, () => [
			[
				"right",
				"Flow left to right",
				Arrow_right
			],
			[
				"down",
				"Flow top to bottom",
				Arrow_down
			],
			[
				"left",
				"Flow right to left",
				Arrow_left
			],
			[
				"up",
				"Flow bottom to top",
				Arrow_up
			],
			[
				"auto",
				"Flow as the card's shape suits",
				Wand_sparkles
			]
		], ([o, says, I]) => o, ($$anchor, $$item) => {
			var $$array_1 = user_derived(() => to_array(get($$item), 3));
			let o = () => get($$array_1)[0];
			let says = () => get($$array_1)[1];
			let I = () => get($$array_1)[2];
			var button_1 = root$2();
			let classes_1;
			Icon$1(child(button_1), {
				children: ($$anchor, $$slotProps) => {
					var fragment_3 = comment();
					var node_7 = first_child(fragment_3);
					component(node_7, I, ($$anchor, I_2) => {
						I_2($$anchor, {});
					});
					append($$anchor, fragment_3);
				},
				$$slots: { default: true }
			});
			reset(button_1);
			template_effect(() => {
				classes_1 = set_class(button_1, 1, "ico svelte-15basb6", null, classes_1, { on: get(orient) === o() });
				set_attribute(button_1, "aria-label", says());
				set_attribute(button_1, "title", says());
				set_attribute(button_1, "aria-pressed", get(orient) === o());
			});
			delegated("click", button_1, () => set(orient, o(), true));
			append($$anchor, button_1);
		});
		append($$anchor, fragment_2);
	};
	if_block(node_4, ($$render) => {
		if (get(algorithm) === "layered") $$render(consequent_1);
	});
	var button_2 = sibling(node_4, 4);
	Icon$1(child(button_2), {
		children: ($$anchor, $$slotProps) => {
			Fold_horizontal($$anchor, {});
		},
		$$slots: { default: true }
	});
	reset(button_2);
	var button_3 = sibling(button_2, 2);
	Icon$1(child(button_3), {
		children: ($$anchor, $$slotProps) => {
			Unfold_horizontal($$anchor, {});
		},
		$$slots: { default: true }
	});
	reset(button_3);
	var button_4 = sibling(button_3, 4);
	Icon$1(child(button_4), {
		children: ($$anchor, $$slotProps) => {
			Zoom_out($$anchor, {});
		},
		$$slots: { default: true }
	});
	reset(button_4);
	var span = sibling(button_4, 2);
	let classes_2;
	var text = only_child(span, true);
	var button_5 = sibling(span, 2);
	Icon$1(child(button_5), {
		children: ($$anchor, $$slotProps) => {
			Zoom_in($$anchor, {});
		},
		$$slots: { default: true }
	});
	reset(button_5);
	var node_12 = sibling(button_5, 2);
	var consequent_2 = ($$anchor) => {
		var button_6 = root_2$2();
		Icon$1(child(button_6), {
			children: ($$anchor, $$slotProps) => {
				Scan($$anchor, {});
			},
			$$slots: { default: true }
		});
		next();
		reset(button_6);
		delegated("click", button_6, fit);
		append($$anchor, button_6);
	};
	if_block(node_12, ($$render) => {
		if (get(zoom) !== null) $$render(consequent_2);
	});
	reset(div_1);
	var div_2 = sibling(div_1, 2);
	let classes_3;
	Pannable(child(div_2), {
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
			var div_3 = root_24();
			let classes_4;
			var svg = child(div_3);
			let classes_5;
			var node_15 = child(svg);
			each(node_15, 17, () => get(shown).edges, (pe) => pe.id, ($$anchor, pe) => {
				const e = user_derived(() => get(edgeById).get(get(pe).id));
				var g_1 = root_6();
				let classes_6;
				var path_1 = child(g_1);
				var node_16 = sibling(path_1);
				var consequent_3 = ($$anchor) => {
					var path_2 = root_3$1();
					let classes_7;
					template_effect(($0) => {
						classes_7 = set_class(path_2, 0, "head svelte-15basb6", null, classes_7, { open: get(uml) });
						set_attribute(path_2, "d", $0);
					}, [() => arrow(get(pe).arrow.x, get(pe).arrow.y, get(pe).arrow.angle)]);
					append($$anchor, path_2);
				};
				if_block(node_16, ($$render) => {
					if (!get(path) || get(pe).back || get(pe).self) $$render(consequent_3);
				});
				var node_17 = sibling(node_16);
				var consequent_4 = ($$anchor) => {
					var text_1 = root_4$1();
					let classes_8;
					var text_2 = only_child(text_1, true);
					template_effect(($0) => {
						classes_8 = set_class(text_1, 0, "elabel svelte-15basb6", null, classes_8, { big: get(path) });
						set_attribute(text_1, "x", get(pe).label.x);
						set_attribute(text_1, "y", $0);
						set_text(text_2, get(e).label);
					}, [() => get(pe).label.y - (get(loopLine).get(get(pe).id) ?? 0) * 15]);
					append($$anchor, text_1);
				};
				if_block(node_17, ($$render) => {
					if (get(e)?.label) $$render(consequent_4);
				});
				var node_18 = sibling(node_17);
				var consequent_5 = ($$anchor) => {
					var title = root_5();
					var text_3 = only_child(title, true);
					template_effect(() => set_text(text_3, get(e).title));
					append($$anchor, title);
				};
				if_block(node_18, ($$render) => {
					if (get(e)?.title) $$render(consequent_5);
				});
				reset(g_1);
				template_effect(() => {
					classes_6 = set_class(g_1, 0, `edge ${get(e)?.cls ?? "" ?? ""}`, "svelte-15basb6", classes_6, { back: get(pe).back });
					set_attribute(path_1, "d", get(pe).path);
				});
				append($$anchor, g_1);
			});
			var node_19 = sibling(node_15);
			each(node_19, 17, () => get(shown).nodes, (pn) => pn.id, ($$anchor, pn) => {
				const n = user_derived(() => get(byId).get(get(pn).id));
				var fragment_9 = comment();
				var node_20 = first_child(fragment_9);
				var consequent_19 = ($$anchor) => {
					var g_2 = root_23();
					let styles;
					var g_3 = child(g_2);
					let classes_9;
					var rect = child(g_3);
					var node_21 = sibling(rect);
					var consequent_6 = ($$anchor) => {
						var circle = root_7();
						append($$anchor, circle);
					};
					var consequent_7 = ($$anchor) => {
						var fragment_10 = root_8();
						var rect_1 = first_child(fragment_10);
						var text_4 = sibling(rect_1);
						var text_5 = only_child(text_4, true);
						template_effect(() => {
							set_attribute(rect_1, "x", -get(pn).width / 2);
							set_attribute(rect_1, "y", -get(pn).height / 2);
							set_attribute(rect_1, "width", get(pn).width);
							set_attribute(rect_1, "height", get(pn).height);
							set_text(text_5, get(n).label);
						});
						append($$anchor, fragment_10);
					};
					var consequent_13 = ($$anchor) => {
						var fragment_11 = root_15();
						var node_22 = first_child(fragment_11);
						var consequent_8 = ($$anchor) => {
							var fragment_12 = root_9();
							next();
							append($$anchor, fragment_12);
						};
						var d_1 = user_derived(() => isCurrent(get(n)));
						var consequent_10 = ($$anchor) => {
							var fragment_13 = root_11();
							var text_6 = sibling(first_child(fragment_13));
							var text_7 = child(text_6, true);
							var node_23 = sibling(text_7);
							var consequent_9 = ($$anchor) => {
								var tspan = root_10();
								var text_8 = only_child(tspan, true);
								template_effect(() => set_text(text_8, get(n).sub));
								append($$anchor, tspan);
							};
							if_block(node_23, ($$render) => {
								if (get(n).sub) $$render(consequent_9);
							});
							reset(text_6);
							template_effect(() => {
								set_attribute(text_6, "x", get(flow) === "left" ? -14 : 14);
								set_attribute(text_6, "text-anchor", get(flow) === "left" ? "end" : "start");
								set_text(text_7, get(n).label);
							});
							append($$anchor, fragment_13);
						};
						var d_2 = user_derived(() => isAhead(get(n)));
						var alternate = ($$anchor) => {
							var circle_1 = root_12();
							append($$anchor, circle_1);
						};
						if_block(node_22, ($$render) => {
							if (get(d_1)) $$render(consequent_8);
							else if (get(d_2)) $$render(consequent_10, 1);
							else $$render(alternate, -1);
						});
						var node_24 = sibling(node_22);
						var consequent_12 = ($$anchor) => {
							var fragment_14 = comment();
							var node_25 = first_child(fragment_14);
							var consequent_11 = ($$anchor) => {
								var text_9 = root_13();
								var text_10 = only_child(text_9, true);
								template_effect(($0) => {
									set_attribute(text_9, "x", $0);
									set_text(text_10, get(n).label);
								}, [() => isCurrent(get(n)) ? 22 : 13]);
								append($$anchor, text_9);
							};
							var alternate_1 = ($$anchor) => {
								var text_11 = root_14();
								var text_12 = only_child(text_11, true);
								template_effect(($0) => {
									set_attribute(text_11, "y", $0);
									set_text(text_12, get(n).label);
								}, [() => isCurrent(get(n)) ? 32 : 22]);
								append($$anchor, text_11);
							};
							if_block(node_25, ($$render) => {
								if (get(dir) === "vertical") $$render(consequent_11);
								else $$render(alternate_1, -1);
							});
							append($$anchor, fragment_14);
						};
						var d_3 = user_derived(() => !isAhead(get(n)) && get(n).label);
						if_block(node_24, ($$render) => {
							if (get(d_3)) $$render(consequent_12);
						});
						append($$anchor, fragment_11);
					};
					var alternate_2 = ($$anchor) => {
						var fragment_15 = root_16();
						var circle_2 = first_child(fragment_15);
						var text_13 = sibling(circle_2);
						var text_14 = only_child(text_13, true);
						template_effect(() => {
							set_attribute(circle_2, "r", get(pn).width / 2);
							set_text(text_14, get(n).label);
						});
						append($$anchor, fragment_15);
					};
					if_block(node_21, ($$render) => {
						if (get(n).kind === "initial") $$render(consequent_6);
						else if (get(uml)) $$render(consequent_7, 1);
						else if (get(path)) $$render(consequent_13, 2);
						else $$render(alternate_2, -1);
					});
					var node_26 = sibling(node_21);
					var consequent_15 = ($$anchor) => {
						var fragment_16 = comment();
						var node_27 = first_child(fragment_16);
						var consequent_14 = ($$anchor) => {
							var text_15 = root_18();
							each(text_15, 21, () => get(n).sub.split("\n"), index, ($$anchor, line, li) => {
								var tspan_1 = root_17();
								set_attribute(tspan_1, "dy", li === 0 ? 0 : 13);
								var text_16 = only_child(tspan_1, true);
								template_effect(() => {
									set_attribute(tspan_1, "x", get(pn).width / 2 + 8);
									set_text(text_16, get(line));
								});
								append($$anchor, tspan_1);
							});
							reset(text_15);
							template_effect(($0) => {
								set_attribute(text_15, "x", get(pn).width / 2 + 8);
								set_attribute(text_15, "y", $0);
							}, [() => get(n).sub.includes("\n") ? -3 : 4]);
							append($$anchor, text_15);
						};
						var alternate_3 = ($$anchor) => {
							var text_17 = root_20();
							each(text_17, 21, () => get(n).sub.split("\n"), index, ($$anchor, line, li) => {
								var tspan_2 = root_19();
								set_attribute(tspan_2, "dy", li === 0 ? 0 : 13);
								var text_18 = only_child(tspan_2, true);
								template_effect(() => set_text(text_18, get(line)));
								append($$anchor, tspan_2);
							});
							reset(text_17);
							template_effect(() => set_attribute(text_17, "y", get(pn).height / 2 + 14));
							append($$anchor, text_17);
						};
						if_block(node_27, ($$render) => {
							if (get(dir) === "vertical" && get(algorithm) === "layered") $$render(consequent_14);
							else $$render(alternate_3, -1);
						});
						append($$anchor, fragment_16);
					};
					if_block(node_26, ($$render) => {
						if (get(n).sub && !get(path)) $$render(consequent_15);
					});
					var node_28 = sibling(node_26);
					var consequent_16 = ($$anchor) => {
						var title_1 = root_5();
						var text_19 = only_child(title_1, true);
						template_effect(() => set_text(text_19, get(n).title));
						append($$anchor, title_1);
					};
					if_block(node_28, ($$render) => {
						if (get(n).title) $$render(consequent_16);
					});
					reset(g_3);
					var node_29 = sibling(g_3);
					var consequent_17 = ($$anchor) => {
						var g_4 = root_21();
						let classes_10;
						var title_2 = sibling(child(g_4), 3);
						var text_20 = only_child(title_2, true);
						reset(g_4);
						template_effect(($0, $1, $2) => {
							classes_10 = set_class(g_4, 0, "mark pin svelte-15basb6", null, classes_10, { set: $0 });
							set_attribute(g_4, "aria-label", $1);
							set_attribute(g_4, "transform", `translate(${get(pn).width / 2 - 2}, ${-get(pn).height / 2 - 6})`);
							set_text(text_20, $2);
						}, [
							() => pinned().has(get(n).id),
							() => pinned().has(get(n).id) ? `unpin ${get(n).label}` : `pin ${get(n).label}, so it never fades`,
							() => pinned().has(get(n).id) ? "Unpin" : "Pin: it never fades"
						]);
						delegated("click", g_4, () => $$props.onpin?.(get(n).id));
						delegated("keydown", g_4, (ev) => ev.key === "Enter" && $$props.onpin?.(get(n).id));
						append($$anchor, g_4);
					};
					if_block(node_29, ($$render) => {
						if ($$props.onpin && get(n).kind !== "initial") $$render(consequent_17);
					});
					var node_30 = sibling(node_29);
					var consequent_18 = ($$anchor) => {
						var g_5 = root_22();
						let classes_11;
						var title_3 = sibling(child(g_5), 2);
						var text_21 = only_child(title_3, true);
						reset(g_5);
						template_effect(($0, $1, $2) => {
							classes_11 = set_class(g_5, 0, "mark star svelte-15basb6", null, classes_11, { set: $0 });
							set_attribute(g_5, "aria-label", $1);
							set_attribute(g_5, "transform", `translate(${-get(pn).width / 2 + 2}, ${-get(pn).height / 2 - 6})`);
							set_text(text_21, $2);
						}, [
							() => bookmarked().has(get(n).id),
							() => bookmarked().has(get(n).id) ? `remove the bookmark of ${get(n).label}` : `bookmark ${get(n).label}`,
							() => bookmarked().has(get(n).id) ? "Remove the bookmark" : "Bookmark it"
						]);
						delegated("click", g_5, () => $$props.onbookmark?.(get(n).id));
						delegated("keydown", g_5, (ev) => ev.key === "Enter" && $$props.onbookmark?.(get(n).id));
						append($$anchor, g_5);
					};
					if_block(node_30, ($$render) => {
						if ($$props.onbookmark && get(n).kind !== "initial") $$render(consequent_18);
					});
					reset(g_2);
					template_effect(($0, $1, $2, $3, $4) => {
						styles = set_style(g_2, "", styles, { transform: `translate(${get(pn).x ?? ""}px, ${get(pn).y ?? ""}px)` });
						set_attribute(g_3, "data-id", get(n).id);
						classes_9 = set_class(g_3, 0, `node ${get(n).cls ?? "" ?? ""}`, "svelte-15basb6", classes_9, { pinned: $0 });
						set_attribute(g_3, "aria-label", get(n).title ?? get(n).label);
						set_attribute(rect, "x", $1);
						set_attribute(rect, "y", $2);
						set_attribute(rect, "width", $3);
						set_attribute(rect, "height", $4);
					}, [
						() => pinned().has(get(n).id),
						() => -Math.max(get(pn).width, 48) / 2,
						() => -Math.max(get(pn).height, 48) / 2,
						() => Math.max(get(pn).width, 48),
						() => Math.max(get(pn).height, 48)
					]);
					delegated("click", g_3, () => $$props.onpick?.(get(n).id));
					delegated("keydown", g_3, (ev) => ev.key === "Enter" && $$props.onpick?.(get(n).id));
					append($$anchor, g_2);
				};
				if_block(node_20, ($$render) => {
					if (get(n)) $$render(consequent_19);
				});
				append($$anchor, fragment_9);
			});
			reset(svg);
			bind_this(svg, ($$value) => set(drawing, $$value), () => get(drawing));
			reset(div_3);
			template_effect(() => {
				classes_4 = set_class(div_3, 1, "measure svelte-15basb6", null, classes_4, { fitting: get(zoom) === null });
				set_attribute(svg, "width", get(zoom) === null ? void 0 : get(W) * get(zoom));
				set_attribute(svg, "height", get(zoom) === null ? void 0 : get(H) * get(zoom));
				set_attribute(svg, "viewBox", `${-get(pad)} ${-get(pad)} ${get(W) ?? ""} ${get(H) ?? ""}`);
				set_attribute(svg, "aria-label", $$props.label);
				classes_5 = set_class(svg, 0, "svelte-15basb6", null, classes_5, { fit: get(zoom) === null });
			});
			append($$anchor, div_3);
		},
		$$slots: { default: true }
	});
	reset(div_2);
	reset(div);
	template_effect(($0) => {
		set_attribute(div_1, "aria-label", `${$$props.label ?? ""}: layout and zoom`);
		button_2.disabled = get(spacing) <= .6;
		button_3.disabled = get(spacing) >= 2;
		classes_2 = set_class(span, 1, "pct svelte-15basb6", null, classes_2, { quiet: get(zoom) === null });
		set_attribute(span, "title", get(zoom) === null ? "The whole drawing fits the card" : "How large the drawing is drawn");
		set_text(text, $0);
		classes_3 = set_class(div_2, 1, "window svelte-15basb6", null, classes_3, { grow: grow() });
	}, [() => get(zoom) === null ? "all in view" : `${Math.round(get(zoom) * 100)}%`]);
	delegated("click", button_2, () => set(spacing, Math.max(.6, get(spacing) / 1.25), true));
	delegated("click", button_3, () => set(spacing, Math.min(2, get(spacing) * 1.25), true));
	delegated("click", button_4, () => zoomBy(1 / 1.25));
	delegated("click", button_5, () => zoomBy(1.25));
	bind_element_size(div_2, "clientWidth", ($$value) => set(boxW, $$value));
	bind_element_size(div_2, "clientHeight", ($$value) => set(boxH, $$value));
	append($$anchor, div);
	pop();
}
delegate(["click", "keydown"]);
// ../../../../src/plugins/verifier-mcrl2/widgets/study/Sequence.svelte
var root$1 = from_svg(`<rect class="headbox svelte-1568mk7" y="4" width="132" height="26" rx="2"></rect><text class="who svelte-1568mk7" y="21" text-anchor="middle"> </text>`, 1);
var root_1$1 = from_svg(`<line class="life svelte-1568mk7" y1="0"></line>`);
var root_2$1 = from_svg(`<title> </title>`);
var root_3 = from_svg(`<g><line class="svelte-1568mk7"></line><path class="head svelte-1568mk7"></path><text text-anchor="middle" class="svelte-1568mk7"> </text><!></g>`);
var root_4 = from_html(`<div class="sequence svelte-1568mk7"><svg class="heads svelte-1568mk7" aria-hidden="true"></svg> <div class="body svelte-1568mk7"><svg role="img" class="svelte-1568mk7"><!><!></svg></div></div>`);
var $$css$1 = {
	hash: "svelte-1568mk7",
	code: ".sequence.svelte-1568mk7 {display:flex;flex-direction:column;align-items:center;block-size:100%;min-block-size:0;}.heads.svelte-1568mk7 {flex:none;}.body.svelte-1568mk7 {flex:1;inline-size:100%;min-block-size:0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;}svg.svelte-1568mk7 {display:block;inline-size:100%;block-size:auto;flex:none;}text.svelte-1568mk7 {font-family:var(--font-family-body);}.headbox.svelte-1568mk7 {fill:var(--color-surface-raised);stroke:var(--color-text);stroke-width:1.2;}.who.svelte-1568mk7 {font-size:var(--font-size-xs);fill:var(--color-text);}.life.svelte-1568mk7 {stroke:var(--color-text-muted);stroke-width:1;stroke-dasharray:5 4;}.msg.svelte-1568mk7 line:where(.svelte-1568mk7) {stroke:var(--color-text-muted);stroke-width:1.2;}.msg.svelte-1568mk7 .head:where(.svelte-1568mk7) {fill:var(--color-text-muted);}.msg.svelte-1568mk7 text:where(.svelte-1568mk7) {font-size:var(--font-size-2xs);fill:var(--color-text-muted);}.msg.latest.svelte-1568mk7 line:where(.svelte-1568mk7) {stroke:var(--color-accent);stroke-width:1.8;}.msg.latest.svelte-1568mk7 .head:where(.svelte-1568mk7) {fill:var(--color-accent);}.msg.latest.svelte-1568mk7 text:where(.svelte-1568mk7) {fill:var(--color-accent);}"
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
	let styles;
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
	let styles_1;
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
			classes = set_class(g, 0, "msg svelte-1568mk7", null, classes, { latest: i === get(shown).length - 1 });
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
		set_attribute(svg, "viewBox", `0 0 ${get(W) ?? ""} 34`);
		styles = set_style(svg, "", styles, { "max-inline-size": `${get(W) ?? ""}px` });
		set_attribute(svg_1, "viewBox", `0 0 ${get(W) ?? ""} ${get(H) ?? ""}`);
		set_attribute(svg_1, "aria-label", $$props.label);
		styles_1 = set_style(svg_1, "", styles_1, { "max-inline-size": `${get(W) ?? ""}px` });
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
