// Run in a separate verification scene with Streetscape Lab > Map open.
// Supply the checked-in osm-movement-acquisition-v1.json as window.__laneFixture.
(async () => {
	let require;
	webpackChunk_N_E.push([["lane-check-" + Date.now()], {}, (r) => (require = r)]);
	const module = (suffix) => {
		const id = Object.keys(require.m).find((id) => id.endsWith(suffix));
		if (!id) throw Error("Missing " + suffix);
		return require(id);
	};
	const core = module("/packages/core/dist/index.js");
	const persistence = module("/streetscape/src/host/street-project-persistence.ts");
	const compiler = module("/streetscape/src/lane-movement-graph.ts");
	const acquisition = structuredClone(window.__laneFixture);
	acquisition.responses[0].payload.elements.push({
		type: "relation", id: 200,
		tags: { type: "connectivity", connectivity: "1:1" },
		members: [
			{ type: "way", ref: 10, role: "from" },
			{ type: "node", ref: 2, role: "via" },
			{ type: "way", ref: 30, role: "to" },
		],
	});
	const importer = module("/streetscape/src/osm-import.ts");
	const prepared = await importer.prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
		loadAcquisition: async () => acquisition, loadTerrain: false,
	});
	const result = await importer.completeOsmStreetImport({ ...prepared,
		regionalPolicy: { id: "right-driving", version: 1, status: "confirmed", basis: "manual", evidence: null },
	});
	const level = Object.values(core.useScene.getState().nodes).find((n) => n.type === "level");
	if (!level) throw Error("No level");
	module("/streetscape/src/osm-import-placement.ts").placeOsmImport(result, level.id, undefined, { resolveBaseline: true });
	const project = () => {
		const site = Object.values(core.useScene.getState().nodes).find((n) => n.metadata?.["pascal:streetscape-project"]);
		return persistence.readStreetProjectFromSite(site).project;
	};
	const graph = () => compiler.compileProjectLaneMovements(project());
	const initial = graph();
	const lanes = new Map(initial.lanes.map((l) => [l.id, l]));
	const checks = [];
	const check = (name, pass) => {
		checks.push({ name, pass: !!pass });
		if (!pass) throw Error(name);
	};
	check("forbidden turn absent", !initial.links.some((l) => lanes.get(l.fromLaneId).wayId === 10 && lanes.get(l.toLaneId).wayId === 20));
	check("one-way has no reverse departure", !initial.lanes.some((l) => l.wayId === 10 && l.viaNodeId === 2 && l.role === "outgoing"));
	check("explicit connectivity accepted", initial.links.filter((l) => l.basis === "source-connectivity" && l.status === "accepted").length === 1);
	check("other legal links pending", initial.links.filter((l) => l.status === "pending").length === 3);
	window.__laneCheck = { core, persistence, compiler, project, graph, checks, check,
		before: JSON.stringify(core.useScene.getState().nodes),
		historyCount: core.useScene.temporal.getState().pastStates.length };
	return { checks, links: initial.links.length, revision: project().revision };
})();
