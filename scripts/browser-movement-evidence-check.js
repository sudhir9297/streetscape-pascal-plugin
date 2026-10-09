// Run in the loaded development editor with Streetscape Lab > Map open.
(async () => {
	let require;
	webpackChunk_N_E.push([
		["movement-check-" + Date.now()],
		{},
		(r) => (require = r),
	]);
	const module = (s) => {
		const id = Object.keys(require.m).find((id) => id.endsWith(s));
		if (!id) throw Error("Missing " + s);
		return require(id);
	};
	const core = module("/packages/core/dist/index.js"),
		importer = module("/streetscape/src/osm-import.ts"),
		movement = module("/streetscape/src/source/osm-movement-evidence.ts"),
		placement = module("/streetscape/src/osm-import-placement.ts"),
		storage = module("/streetscape/src/report-storage.ts");
	const state = core.useScene.getState(),
		original = {
			nodes: state.nodes,
			rootNodeIds: state.rootNodeIds,
			collections: state.collections,
			materials: state.materials,
			installedPlugins: state.installedPlugins,
		};
	const h = core.useScene.temporal.getState(),
		history = {
			pastStates: [...h.pastStates],
			futureStates: [...h.futureStates],
		};
	const checks = [];
	const check = (name, pass) => {
		checks.push({ name, pass: !!pass });
		if (!pass) throw Error(name);
	};
	try {
		const acquisition = {
			format: "osm-acquisition",
			schemaVersion: 1,
			bbox: { south: -0.01, west: -0.01, north: 0.01, east: 0.01 },
			responses: [
				{
					bbox: { south: -0.01, west: -0.01, north: 0.01, east: 0.01 },
					payload: {
						elements: [
							{
								type: "way",
								id: 10,
								nodes: [1, 2],
								geometry: [
									{ lat: 0, lon: -0.0005 },
									{ lat: 0, lon: 0 },
								],
								tags: { highway: "residential", lanes: "2", oneway: "yes" },
							},
							{
								type: "way",
								id: 20,
								nodes: [2, 3],
								geometry: [
									{ lat: 0, lon: 0 },
									{ lat: 0.0005, lon: 0 },
								],
								tags: { highway: "residential", lanes: "2", oneway: "yes" },
							},
							{
								type: "way",
								id: 30,
								nodes: [2, 4],
								geometry: [
									{ lat: 0, lon: 0 },
									{ lat: 0, lon: 0.0005 },
								],
								tags: { highway: "residential", lanes: "2", oneway: "yes" },
							},
							{
								type: "relation",
								id: 100,
								tags: { type: "restriction", restriction: "no_right_turn" },
								members: [
									{ type: "way", ref: 10, role: "from" },
									{ type: "node", ref: 2, role: "via" },
									{ type: "way", ref: 20, role: "to" },
								],
							},
						],
					},
				},
			],
			diagnostics: [],
		};
		const p = await importer.prepareOsmStreetImport({ lat: 0, lon: 0 }, 100, {
			loadAcquisition: async () => acquisition,
			loadTerrain: false,
		});
		const result = await importer.completeOsmStreetImport({
			...p,
			regionalPolicy: {
				id: "right-driving",
				version: 1,
				status: "confirmed",
				basis: "manual",
				evidence: null,
			},
		});
		const m = {
			fromWayId: 10,
			toWayId: 20,
			viaNodeId: 2,
			fromDirection: "forward",
			toDirection: "forward",
		};
		check(
			"supported restriction excludes forbidden turn",
			!movement.isSupportedOsmMovementAllowed(result.movementEvidence, m),
		);
		check(
			"other outgoing turn remains available",
			movement.isSupportedOsmMovementAllowed(result.movementEvidence, {
				...m,
				toWayId: 30,
			}),
		);
		const rawTags = result.normalization.features.find((f) => f.id === 100).raw
				.tags,
			originalTags = acquisition.responses[0].payload.elements[3].tags;
		check(
			"raw relation retained",
			Object.keys(rawTags).length === Object.keys(originalTags).length &&
				Object.entries(originalTags).every(
					([key, value]) => rawTags[key] === value,
				),
		);
		const activeLevelId = module(
			"/packages/viewer/dist/store/use-viewer.js",
		).default.getState().selection.levelId;
		const level =
			state.nodes[activeLevelId] ??
			Object.values(state.nodes).find((n) => n.type === "level");
		if (!level) throw Error("No active level");
		const minimalNodes = {};
		let ancestor = level;
		while (ancestor) {
			const clone = structuredClone(ancestor);
			if (clone.children) clone.children = [];
			if (clone.metadata) delete clone.metadata["pascal:streetscape-project"];
			minimalNodes[clone.id] = clone;
			ancestor = state.nodes[clone.parentId];
		}
		for (const node of Object.values(minimalNodes))
			if (node.parentId && minimalNodes[node.parentId]?.children)
				minimalNodes[node.parentId].children.push(node.id);
		core.useScene.getState().setScene(
			minimalNodes,
			state.rootNodeIds.filter((id) => minimalNodes[id]),
			{
				collections: {},
				materials: state.materials,
				installedPlugins: state.installedPlugins,
			},
		);
		const ids = placement.placeOsmImport(result, level.id, undefined, {
			resolveBaseline: true,
		});
		await new Promise((r) => setTimeout(r, 1000));
		const diagnosticSection = document.querySelector(
			'[aria-label="Baseline diagnostic report"]',
		);
		if (diagnosticSection)
			diagnosticSection
				.querySelectorAll("details")
				.forEach((d) => (d.open = true));
		check(
			"movement report visible",
			!!diagnosticSection && diagnosticSection.innerText.includes("movement"),
		);
		const current = core.useScene.getState(),
			graph = {
				nodes: current.nodes,
				rootNodeIds: current.rootNodeIds,
				collections: current.collections,
				materials: current.materials,
				installedPlugins: current.installedPlugins,
			};
		const saved = await fetch("/api/scenes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Step 42 movement evidence verification",
				graph,
			}),
		});
		const data = await saved.json();
		check("server save", saved.status === 201);
		const read = await fetch("/api/scenes/" + data.id, { cache: "no-store" }),
			loaded = await read.json();
		check("durable read", read.ok);
		const owner = Object.values(loaded.graph.nodes).find(
			(n) => n.metadata?.["pascal:streetscape-project"],
		);
		const persistence = module(
			"/streetscape/src/host/street-project-persistence.ts",
		);
		const project = persistence.readStreetProjectFromSite(owner).project;
		const baseline =
			project.baselineRevisions[project.activeBaselineRevisionId];
		const ownerEvidence =
			baseline.resolutionEvidence.movements ??
			baseline.resolutionEvidence.imports.at(-1).movements;
		check(
			"complete document retains movement constraints",
			ownerEvidence.constraints[0].featureId === "osm~relation~100" &&
				!movement.isSupportedOsmMovementAllowed(ownerEvidence, m),
		);
		check(
			"complete document retains raw source",
			Object.values(project.sourceReferences).some(
				(ref) =>
					ref.snapshot.status === "embedded" &&
					ref.snapshot.data.acquisition.responses.some((response) =>
						response.payload.elements.some(
							(e) =>
								e.type === "relation" &&
								e.id === 100 &&
								e.tags.restriction === "no_right_turn",
						),
					),
			),
		);
		const retained = storage.decodeStoredReport(
			loaded.graph.nodes[ids[0]].metadata.osmMovementEvidence,
		);
		check(
			"legal evidence survives server reopening",
			JSON.stringify(retained) === JSON.stringify(result.movementEvidence),
		);
		core.useScene
			.getState()
			.setScene(
				core.materializeRegisteredNodeDefaults(loaded.graph.nodes),
				loaded.graph.rootNodeIds,
				{
					collections: loaded.graph.collections,
					materials: loaded.graph.materials,
					installedPlugins: loaded.graph.installedPlugins,
				},
			);
		const before = JSON.stringify(core.useScene.getState().nodes);
		await new Promise((r) => setTimeout(r, 1200));
		check(
			"regeneration is read-only",
			before === JSON.stringify(core.useScene.getState().nodes),
		);
		return { pass: true, sceneId: data.id, nodeId: ids[0], checks };
	} catch (e) {
		return { pass: false, error: e.message, checks };
	} finally {
		core.useScene
			.getState()
			.setScene(original.nodes, original.rootNodeIds, {
				collections: original.collections,
				materials: original.materials,
				installedPlugins: original.installedPlugins,
			});
		core.useScene.temporal.setState(history);
	}
})();
