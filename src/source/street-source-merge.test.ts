import { expect, test } from "bun:test";
import { RoadNetworkNode } from "../schema";
import { createLegacyStreetProject } from "../street-project-compatibility";
import { parseStreetProject } from "../domain/street-project";
import { parseOsmAcquisition, type OsmAcquisition } from "./osm-acquisition";
import { createOsmSourceSnapshot } from "./osm-source-snapshot";
import {
	prepareStreetSourceMerge,
	resolveStreetSourceMerge,
} from "./street-source-merge";
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

async function triple() {
	const { project: current, acquisition } = await fixture();
	const original = structuredClone(current);
	original.scenarios = {};
	original.activeScenarioId = null;
	original.baselineRevisions.baseline!.propertyEvidence!.width!.accepted = {
		kind: "claim",
		claimId: "sourceWidth",
	};
	const snapshot = await createOsmSourceSnapshot(acquisition),
		incoming = structuredClone(original);
	incoming.sourceReferences = {
		next: {
			...original.sourceReferences.source!,
			id: "next",
			contentIdentity: snapshot.contentIdentity,
			snapshot: {
				status: "embedded",
				format: snapshot.format,
				data: JSON.parse(JSON.stringify(snapshot)),
			},
		},
	};
	const baseline = incoming.baselineRevisions.baseline!;
	baseline.sourceReferenceIds = ["next"];
	for (const owner of [
		...Object.values(baseline.roads),
		...Object.values(baseline.features),
	])
		owner.sourceReferenceIds = ["next"];
	baseline.propertyEvidence!.width!.claims.sourceWidth!.origin = {
		kind: "source",
		sourceReferenceId: "next",
		sourceFeatureId: "way/10",
	};
	return { current, original, incoming, acquisition };
}
test("three-way refresh preserves correction, locked scenario and history while taking independent source changes", async () => {
	const { current, original, incoming } = await triple(),
		before = JSON.stringify(current);
	const id = Object.keys(incoming.baselineRevisions.baseline!.roads)[0]!;
	(incoming.baselineRevisions.baseline!.roads[id]!.data.stylePresets as any)[
		"local-street"
	].sidewalkWidth = 2;
	incoming.baselineRevisions.baseline!.propertyEvidence!.width!.claims
		.sourceWidth!.value = 2;
	const review = await prepareStreetSourceMerge(
			current,
			original,
			incoming,
			"source",
		),
		result = await resolveStreetSourceMerge(review, {}, date);
	expect(result.unresolved).toHaveLength(0);
	expect(result.project).not.toBeNull();
	const p = result.project!,
		b = p.baselineRevisions[p.activeBaselineRevisionId]!;
	expect(b.propertyEvidence!.width!.accepted).toEqual(
		current.baselineRevisions.baseline!.propertyEvidence!.width!.accepted,
	);
	expect(
		Object.values(b.propertyEvidence!.width!.claims).map((c) => c.value),
	).toContain(2);
	expect(p.scenarios.design!.propertyLocks).toEqual(
		current.scenarios.design!.propertyLocks,
	);
	expect(p.scenarios.design!.baselineRevisionId).toBe(b.id);
	expect(p.baselineRevisions.baseline).toEqual(
		current.baselineRevisions.baseline,
	);
	expect(JSON.stringify(current)).toBe(before);
});
test("simultaneous edits require a choice and preparation/cancellation cannot mutate inputs", async () => {
	const { current, original, incoming } = await triple();
	current.baselineRevisions.baseline!.features.lamp!.data.height = 7;
	incoming.baselineRevisions.baseline!.features.lamp!.data.height = 8;
	const before = JSON.stringify(current),
		review = await prepareStreetSourceMerge(
			current,
			original,
			incoming,
			"source",
		);
	const first = await resolveStreetSourceMerge(review);
	expect(first.project).toBeNull();
	expect(first.unresolved).toHaveLength(1);
	const conflict = first.unresolved[0]!;
	const kept = await resolveStreetSourceMerge(
		review,
		{ [conflict.id]: "keep-current" },
		date,
	);
	expect(
		kept.project!.baselineRevisions[kept.project!.activeBaselineRevisionId]!
			.features.lamp!.data.height,
	).toBe(7);
	const taken = await resolveStreetSourceMerge(
		review,
		{ [conflict.id]: "use-incoming" },
		date,
	);
	expect(
		taken.project!.baselineRevisions[taken.project!.activeBaselineRevisionId]!
			.features.lamp!.data.height,
	).toBe(8);
	expect(JSON.stringify(current)).toBe(before);
});
test("removed locked roads can only retain accepted work, with no proximity remap", async () => {
	const { current, original, incoming, acquisition } = await triple();
	const next = structuredClone(acquisition);
	next.responses[0]!.payload.elements = [];
	const snapshot = await createOsmSourceSnapshot(next);
	incoming.sourceReferences.next!.contentIdentity = snapshot.contentIdentity;
	incoming.sourceReferences.next!.snapshot = {
		status: "embedded",
		format: snapshot.format,
		data: JSON.parse(JSON.stringify(snapshot)),
	};
	incoming.baselineRevisions.baseline!.roads = {};
	incoming.baselineRevisions.baseline!.features = {};
	incoming.baselineRevisions.baseline!.propertyEvidence = {};
	const review = await prepareStreetSourceMerge(
			current,
			original,
			incoming,
			"source",
		),
		first = await resolveStreetSourceMerge(review);
	expect(first.project).toBeNull();
	const road = first.conflicts.find((c) => c.path[0] === "roads")!;
	expect(road.choices).toEqual(["keep-current"]);
	await expect(
		resolveStreetSourceMerge(review, { [road.id]: "use-incoming" }),
	).rejects.toThrow("protected");
	const choices = Object.fromEntries(
		first.conflicts.map((c) => [c.id, "keep-current" as const]),
	);
	const result = await resolveStreetSourceMerge(review, choices, date);
	expect(result.project!.scenarios.design!.propertyLocks!.width!.value).toBe(3);
});
test("intentional accepted deletions are not resurrected by refreshed resolution", async () => {
	const { current, original, incoming } = await triple();
	delete current.baselineRevisions.baseline!.features.lamp;
	const result = await resolveStreetSourceMerge(
		await prepareStreetSourceMerge(current, original, incoming, "source"),
		{},
		date,
	);
	expect(
		result.project!.baselineRevisions[result.project!.activeBaselineRevisionId]!
			.features.lamp,
	).toBeUndefined();
});
test("replay rejects altered review inputs and wrong original evidence", async () => {
	const { current, original, incoming } = await triple(),
		review = await prepareStreetSourceMerge(
			current,
			original,
			incoming,
			"source",
		);
	review.incoming.name = "altered";
	await expect(resolveStreetSourceMerge(review)).rejects.toThrow("altered");
	original.sourceReferences.source!.snapshot = {
		status: "unavailable",
		reason: "missing",
	};
	await expect(
		prepareStreetSourceMerge(current, original, incoming, "source"),
	).rejects.toThrow("retained");
});

test("split source topology requires explicit choices and never transfers locks to a new component", async () => {
	const { current, original, incoming, acquisition } = await triple(),
		next = structuredClone(acquisition);
	const way = elements(next).find((e) => e.type === "way")!;
	next.responses[0]!.payload.elements = elements(next).filter((e) => e !== way);
	elements(next).push(
		{ ...way, id: 11, nodes: [1, 2], geometry: way.geometry.slice(0, 2) },
		{ ...way, id: 12, nodes: [2, 3], geometry: way.geometry.slice(1) },
	);
	const snapshot = await createOsmSourceSnapshot(next);
	incoming.sourceReferences.next!.contentIdentity = snapshot.contentIdentity;
	incoming.sourceReferences.next!.snapshot = {
		status: "embedded",
		format: snapshot.format,
		data: JSON.parse(JSON.stringify(snapshot)),
	};
	const b = incoming.baselineRevisions.baseline!,
		id = Object.keys(b.roads)[0]!,
		road = b.roads[id]!;
	const replacement = { ...structuredClone(road), id: "replacement" };
	delete b.roads[id];
	b.roads.replacement = replacement;
	b.propertyEvidence = {};
	const review = await prepareStreetSourceMerge(
			current,
			original,
			incoming,
			"source",
		),
		first = await resolveStreetSourceMerge(review);
	expect(first.project).toBeNull();
	expect(first.conflicts.some((c) => c.path[1] === "replacement")).toBe(true);
	const result = await resolveStreetSourceMerge(
			review,
			Object.fromEntries(
				first.conflicts.map((c) => [c.id, "keep-current" as const]),
			),
			date,
		),
		p = result.project!;
	expect(
		p.baselineRevisions[p.activeBaselineRevisionId]!.roads.replacement,
	).toBeUndefined();
	expect(p.scenarios.design!.propertyLocks!.width!.value).toBe(3);
});
test("intentional scenario feature suppression survives a source removal", async () => {
	const { current, original, incoming } = await triple();
	current.scenarios.design!.inventorySuppressions = {
		'["features","lamp"]': {
			target: { category: "features", featureId: "lamp" },
			reason: "Intentional proposal removal",
			authoredAt: date,
		},
	};
	delete incoming.baselineRevisions.baseline!.features.lamp;
	const review = await prepareStreetSourceMerge(
			current,
			original,
			incoming,
			"source",
		),
		first = await resolveStreetSourceMerge(review),
		conflict = first.conflicts.find((c) => c.path[1] === "lamp")!;
	expect(conflict.choices).toEqual(["keep-current"]);
	const result = await resolveStreetSourceMerge(
		review,
		{ [conflict.id]: "keep-current" },
		date,
	);
	expect(result.project!.scenarios.design!.inventorySuppressions).toEqual(
		current.scenarios.design!.inventorySuppressions,
	);
});

test("ambiguous newly observed source assets cannot be accepted without a choice", async () => {
	const { current, original, incoming, acquisition } = await triple(),
		next = structuredClone(acquisition);
	elements(next).push(
		{
			type: "node",
			id: 999,
			lat: 0,
			lon: 0,
			tags: { highway: "street_lamp", height: "7" },
		},
		{
			type: "node",
			id: 999,
			lat: 0,
			lon: 0,
			tags: { highway: "street_lamp", height: "9" },
		},
	);
	const snapshot = await createOsmSourceSnapshot(next);
	incoming.sourceReferences.next!.contentIdentity = snapshot.contentIdentity;
	incoming.sourceReferences.next!.snapshot = {
		status: "embedded",
		format: snapshot.format,
		data: JSON.parse(JSON.stringify(snapshot)),
	};
	incoming.baselineRevisions.baseline!.features.newLamp = {
		id: "newLamp",
		kind: "point-asset",
		origin: "imported",
		sourceReferenceIds: ["next"],
		sourceFeatureId: "node/999",
		representation: "osm-import-v1",
		data: { height: 7 },
	};
	const result = await resolveStreetSourceMerge(
		await prepareStreetSourceMerge(current, original, incoming, "source"),
	);
	expect(result.project).toBeNull();
	expect(result.unresolved[0]!.reason).toContain("ambiguous");
});

test("new observed fixture requires explicit duplicate evidence review and remembers source linkage", async () => {
	const { current, original, incoming } = await triple();
	const { GeneratedItemAcceptance } = await import(
		"../domain/generated-item-history"
	);
	const roadId = Object.keys(current.baselineRevisions.baseline!.roads)[0]!;
	const record = GeneratedItemAcceptance.parse({
		format: "street-generated-item-acceptance",
		schemaVersion: 1,
		id: "generated-fixture",
		edgeId: "ab",
		kind: "streetscape:street-light",
		assetNodeId: "street-light_accepted",
		status: "accepted",
		position: [10, 0, 5],
		events: [
			{ kind: "accepted", at: date, data: { origin: "procedural-proposal" } },
		],
	});
	current.baselineRevisions.baseline!.roads[roadId]!.data.generatedItemHistory =
		{ [record.id]: JSON.parse(JSON.stringify(record)) };
	current.baselineRevisions.baseline!.features.acceptedLamp = {
		id: "acceptedLamp",
		kind: "point-asset",
		origin: "authored",
		sourceReferenceIds: [],
		sourceFeatureId: null,
		representation: "pascal-scene-node-v1",
		data: {
			id: "street-light_accepted",
			type: "streetscape:street-light",
			position: [10, 0, 5],
			height: 9,
		},
	};
	incoming.baselineRevisions.baseline!.features.observed = {
		id: "observed",
		kind: "point-asset",
		origin: "imported",
		sourceReferenceIds: ["next"],
		sourceFeatureId: "node/999",
		representation: "osm-import-v1",
		data: { kind: "street-lamp", position: [10.5, 0, 5], height: 6 },
	};
	const before = JSON.stringify(current);
	const review = await prepareStreetSourceMerge(
		current,
		original,
		incoming,
		"source",
	);
	const pending = await resolveStreetSourceMerge(review, {}, date);
	const conflict = pending.conflicts.find(
		(c) => c.path[0] === "generated-source-duplicate",
	)!;
	expect(conflict).toBeDefined();
	expect(pending.project).toBeNull();
	const link = conflict.choices.find((c) => c.startsWith("link-existing~"))!;
	const linked = await resolveStreetSourceMerge(
		review,
		{ [conflict.id]: link },
		date,
	);
	expect(linked.unresolved).toHaveLength(0);
	const baseline =
		linked.project!.baselineRevisions[
			linked.project!.activeBaselineRevisionId
		]!;
	expect(baseline.features.observed).toBeUndefined();
	expect(baseline.features.acceptedLamp!.data.height).toBe(9);
	const history = baseline.roads[roadId]!.data.generatedItemHistory as any;
	expect(history[record.id].sourceDecisions["node/999"].decision).toBe(
		"linked",
	);
	expect(
		history[record.id].sourceDecisions["node/999"].evidence.identityMatch,
	).toBe(false);
	expect(JSON.stringify(current)).toBe(before);
	const distinct = await resolveStreetSourceMerge(
		review,
		{ [conflict.id]: "keep-distinct" },
		date,
	);
	expect(
		distinct.project!.baselineRevisions[
			distinct.project!.activeBaselineRevisionId
		]!.features.observed,
	).toBeDefined();
	const repeated = await prepareStreetSourceMerge(
		linked.project!,
		original,
		incoming,
		"source",
	);
	const repeat = await resolveStreetSourceMerge(repeated, {}, date);
	expect(repeat.unresolved).toHaveLength(0);
	expect(
		repeat.project!.baselineRevisions[repeat.project!.activeBaselineRevisionId]!
			.features.observed,
	).toBeUndefined();
});
