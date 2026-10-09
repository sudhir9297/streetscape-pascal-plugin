import { expect, test } from "bun:test";
import { RoadNetworkNode } from "../schema";
import { createLegacyStreetProject } from "../street-project-compatibility";
import { parseStreetProject } from "../domain/street-project";
import { parseOsmAcquisition, type OsmAcquisition } from "./osm-acquisition";
import { createOsmSourceSnapshot } from "./osm-source-snapshot";
import {
	acquireStreetSourceRefresh,
	generateStreetSourceRefreshDiff,
} from "./street-source-refresh";
const date = "2026-10-09T10:00:00Z";
async function fixture() {
	const acquisition = parseOsmAcquisition(
		await Bun.file(
			new URL("../../docs/fixtures/osm-acquisition-v1.json", import.meta.url),
		).json(),
	);
	const snapshot = await createOsmSourceSnapshot(acquisition);
	const node = RoadNetworkNode.parse({
		id: "road-network_refresh",
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [200, 0, 0] },
		},
		edges: {
			ab: {
				id: "ab",
				startNodeId: "a",
				endNodeId: "b",
				osmSource: {
					wayId: 10,
					nodeIds: [1, 2, 3],
					span: { start: 0, end: 2, coverage: "exact" },
					tags: { highway: "residential", width: "8" },
				},
			},
		},
	});
	const project = createLegacyStreetProject({
		id: "refresh",
		name: "Refresh QA",
		baselineRevisionId: "baseline",
		acceptedAt: date,
		roads: [node],
	});
	project.sourceReferences.source = {
		id: "source",
		provider: "openstreetmap",
		acquiredAt: snapshot.acquiredAt,
		contentIdentity: snapshot.contentIdentity,
		snapshot: {
			status: "embedded",
			format: snapshot.format,
			data: JSON.parse(JSON.stringify(snapshot)),
		},
	};
	const baseline = project.baselineRevisions.baseline!;
	baseline.sourceReferenceIds = ["source"];
	baseline.roads[node.id]!.sourceReferenceIds = ["source"];
	baseline.roads[node.id]!.origin = "imported";
	baseline.features.lamp = {
		id: "lamp",
		kind: "point-asset",
		origin: "imported",
		sourceReferenceIds: ["source"],
		sourceFeatureId: "node/20",
		representation: "osm-import-v1",
		data: { height: 6 },
	};
	baseline.propertyEvidence = {
		width: {
			id: "width",
			target: {
				category: "roads",
				featureId: node.id,
				path: ["stylePresets", "local-street", "sidewalkWidth"],
			},
			units: "metres",
			claims: {
				sourceWidth: {
					id: "sourceWidth",
					value: 1.5,
					origin: {
						kind: "source",
						sourceReferenceId: "source",
						sourceFeatureId: "way/10",
					},
				},
			},
			rejectedClaims: [],
			accepted: {
				kind: "correction",
				value: 1.8,
				reason: "Survey correction",
				acceptedAt: date,
				observationIds: [],
				supersedesClaimId: "sourceWidth",
			},
		},
	};
	project.scenarios.design = {
		id: "design",
		name: "Design",
		baselineRevisionId: "baseline",
		overrides: { width: { value: 3, reason: "Design", authoredAt: date } },
		propertyLocks: {
			width: { value: 3, reason: "Pinned design", authoredAt: date },
		},
	};
	return { project: parseStreetProject(project), acquisition, snapshot };
}
const elements = (a: OsmAcquisition) =>
	a.responses[0]!.payload.elements as Array<Record<string, any>>;
test("reports additions, removals, tag changes and accepted correction targets without altering either document", async () => {
	const { project, acquisition } = await fixture(),
		before = JSON.stringify(project);
	const next = structuredClone(acquisition);
	elements(next)[0]!.tags.width = "10";
	next.responses[0]!.payload.elements = elements(next).filter(
		(f) => f.id !== 20,
	);
	elements(next).push({
		type: "node",
		id: 22,
		lat: 0,
		lon: 0.0002,
		tags: { highway: "street_lamp" },
	});
	const nextSnapshot = await createOsmSourceSnapshot(next),
		result = await generateStreetSourceRefreshDiff(
			project,
			"baseline",
			"source",
			nextSnapshot,
		);
	expect(
		result.diff.features.find((f) => f.sourceFeatureId === "osm~way~10")!
			.status,
	).toBe("changed");
	expect(
		result.diff.features.find((f) => f.sourceFeatureId === "osm~way~10")!
			.acceptedTargets,
	).toContain(JSON.stringify(["properties", "width"]));
	expect(
		result.diff.features.find((f) => f.sourceFeatureId === "osm~node~20")!
			.status,
	).toBe("removed");
	expect(
		result.diff.features.find((f) => f.sourceFeatureId === "osm~node~22")!
			.status,
	).toBe("added");
	expect(result.diff.spans[0]!.status).toBe("matched");
	expect(result.incomingSnapshot.integrityIdentity).toBe(
		nextSnapshot.integrityIdentity,
	);
	expect(JSON.stringify(project)).toBe(before);
	expect(
		project.baselineRevisions.baseline!.propertyEvidence!.width!.accepted,
	).toMatchObject({ value: 1.8 });
});
test("metadata-only changes and response ordering do not create semantic updates", async () => {
	const { project, acquisition } = await fixture(),
		next = structuredClone(acquisition);
	for (const f of elements(next)) {
		f.version = 2;
		f.timestamp = date;
		f.uid = 1;
		f.user = "test";
		f.changeset = 2;
	}
	next.responses[0]!.payload.elements = elements(next).reverse();
	const result = await generateStreetSourceRefreshDiff(
		project,
		"baseline",
		"source",
		await createOsmSourceSnapshot(next),
	);
	expect(
		result.diff.features.every(
			(f) => f.status === "unchanged" && f.metadataChanged,
		),
	).toBe(true);
	expect(result.diff.spans[0]!.status).toBe("matched");
});
test("split topology is ambiguous, unrelated nearby roads never match, and partial captures do not confirm removals", async () => {
	const { project, acquisition } = await fixture();
	const split = structuredClone(acquisition),
		old = elements(split).shift()!;
	elements(split).push(
		{ ...old, id: 11, nodes: [1, 2], geometry: old.geometry.slice(0, 2) },
		{ ...old, id: 12, nodes: [2, 3], geometry: old.geometry.slice(1) },
	);
	const result = await generateStreetSourceRefreshDiff(
		project,
		"baseline",
		"source",
		await createOsmSourceSnapshot(split),
	);
	expect(result.diff.spans[0]!.status).toBe("ambiguous");
	expect(result.diff.spans[0]!.candidateIds).toHaveLength(2);
	const nearby = structuredClone(acquisition);
	elements(nearby)[0]!.id = 99;
	elements(nearby)[0]!.nodes = [90, 91, 92];
	expect(
		(
			await generateStreetSourceRefreshDiff(
				project,
				"baseline",
				"source",
				await createOsmSourceSnapshot(nearby),
			)
		).diff.spans[0]!.status,
	).toBe("missing");
	const partial = structuredClone(acquisition);
	partial.responses[0]!.bbox = { ...partial.bbox, east: 0 };
	partial.responses[0]!.payload.elements = [];
	const uncertain = (
		await generateStreetSourceRefreshDiff(
			project,
			"baseline",
			"source",
			await createOsmSourceSnapshot(partial),
		)
	).diff;
	expect(uncertain.coverageComparable).toBe(false);
	expect(uncertain.features.every((f) => f.status === "unobserved")).toBe(true);
	expect(uncertain.spans[0]!.status).toBe("unobserved");
});
test("coordinate changes retain identity, inserted topology and conflicting source variants require review", async () => {
	const { project, acquisition } = await fixture(),
		moved = structuredClone(acquisition);
	elements(moved)[0]!.geometry[1].lon = 0.00001;
	const shifted = (
		await generateStreetSourceRefreshDiff(
			project,
			"baseline",
			"source",
			await createOsmSourceSnapshot(moved),
		)
	).diff;
	expect(
		shifted.features.find((f) => f.kind === "road")!.changedFields,
	).toContain("geometry");
	expect(shifted.spans[0]!.status).toBe("matched");
	const inserted = structuredClone(acquisition);
	elements(inserted)[0]!.nodes.splice(1, 0, 4);
	elements(inserted)[0]!.geometry.splice(1, 0, { lat: 0, lon: -0.0005 });
	expect(
		(
			await generateStreetSourceRefreshDiff(
				project,
				"baseline",
				"source",
				await createOsmSourceSnapshot(inserted),
			)
		).diff.spans[0]!.status,
	).toBe("ambiguous");
	const conflict = structuredClone(acquisition);
	elements(conflict).push({
		...elements(conflict)[0],
		tags: { highway: "primary" },
	});
	expect(
		(
			await generateStreetSourceRefreshDiff(
				project,
				"baseline",
				"source",
				await createOsmSourceSnapshot(conflict),
			)
		).diff.features.find((f) => f.kind === "road")!.status,
	).toBe("ambiguous");
});
test("explicit acquisition bypasses import cache, respects cancellation and keeps the accepted project unchanged", async () => {
	const { project, acquisition } = await fixture(),
		before = JSON.stringify(project);
	let calls = 0;
	const options = {
		request: () => ({ url: "/refresh-fixture" }),
		fetch: async () => {
			calls++;
			return new Response(JSON.stringify(acquisition.responses[0]!.payload));
		},
	};
	await acquireStreetSourceRefresh(project, "baseline", "source", options);
	await acquireStreetSourceRefresh(project, "baseline", "source", options);
	expect(calls).toBe(2);
	expect(JSON.stringify(project)).toBe(before);
	const controller = new AbortController();
	controller.abort();
	await expect(
		acquireStreetSourceRefresh(project, "baseline", "source", {
			...options,
			signal: controller.signal,
		}),
	).rejects.toMatchObject({ name: "AbortError" });
	expect(calls).toBe(2);
});
test("rejects missing baseline snapshots and tampered incoming captures rather than inventing source facts", async () => {
	const { project, snapshot } = await fixture();
	const altered = JSON.parse(JSON.stringify(snapshot));
	altered.acquisition.responses[0].payload.elements[0].tags.width = "100";
	await expect(
		generateStreetSourceRefreshDiff(project, "baseline", "source", altered),
	).rejects.toThrow();
	project.sourceReferences.source!.snapshot = {
		status: "unavailable",
		reason: "Legacy capture",
	};
	await expect(
		generateStreetSourceRefreshDiff(project, "baseline", "source", snapshot),
	).rejects.toThrow("unavailable");
});
