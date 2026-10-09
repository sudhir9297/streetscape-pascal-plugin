// Run in the verification scene after Streetscape Lab > Map has loaded.
(() => {
	let require;
	webpackChunk_N_E.push([
		["junction-check-" + Date.now()],
		{},
		(r) => (require = r),
	]);
	const module = (s) => {
		const id = Object.keys(require.m).find((id) => id.endsWith(s));
		if (!id) throw Error(s);
		return require(id);
	};
	const core = module("/packages/core/dist/index.js");
	const scene = core.useScene.getState();
	const road = Object.values(scene.nodes).find(
		(n) => n.type === "streetscape:road-network",
	);
	const context = module("/streetscape/src/host/road-movement-context.ts");
	const compiler = module("/streetscape/src/street-compiler.ts");
	const before = JSON.stringify(scene.nodes),
		edges = JSON.stringify(road.edges);
	const movements = context.roadMovementContext(road, (id) => scene.nodes[id]);
	const plan = compiler.compileStreet(road, null, movements),
		generation = plan.junctionMovementPlan;
	const checks = [];
	const check = (name, pass) => {
		checks.push({ name, pass: !!pass });
		if (!pass) throw Error(name);
	};
	const arrows = plan.markings.filter((m) => m.kind === "direction-arrow");
	check("accepted arrows generated", arrows.length > 0);
	check(
		"arrows reference only accepted movements",
		arrows.every(
			(m) =>
				m.movementIds.length &&
				m.movementIds.every((id) =>
					movements.links.some((l) => l.id === id && l.status === "accepted"),
				),
		),
	);
	check(
		"signal fixture proposals remain pending",
		generation.signalProposals.length > 0 &&
			generation.signalProposals.every(
				(p) => p.status === "pending" && !("phases" in p) && !("timing" in p),
			),
	);
	check(
		"crossing relationships reference legal accepted links",
		generation.crossings.length > 0 &&
			generation.crossings.every((p) =>
				p.movementIds.every((id) =>
					movements.links.some((l) => l.id === id && l.status === "accepted"),
				),
			),
	);
	const polygons = [];
	const collect = (g) => {
		if (g.kind === "polygon") polygons.push(g);
		if (g.children) g.children.forEach(collect);
	};
	collect(plan.canonicalFloorplan);
	check(
		"surface plan uses identical marking polygons",
		plan.markings.every((m) =>
			polygons.some(
				(p) =>
					JSON.stringify(p.points) ===
					JSON.stringify(m.points.map((p) => [p[0], p[2]])),
			),
		),
	);
	check(
		"generation does not add network connections",
		JSON.stringify(road.edges) === edges,
	);
	check(
		"generation is read-only",
		JSON.stringify(core.useScene.getState().nodes) === before,
	);
	const previous = sessionStorage.getItem("step44-plan");
	if (previous)
		check(
			"full reopen regenerates identical output",
			previous === JSON.stringify(plan),
		);
	sessionStorage.setItem("step44-plan", JSON.stringify(plan));
	window.__j44 = { core, road, movements, plan, before, checks };
	return {
		pass: true,
		checks,
		arrows: arrows.length,
		crossings: generation.crossings.length,
		signals: generation.signalProposals.length,
	};
})();
