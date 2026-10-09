import { beforeEach, expect, test } from "bun:test";
import { useScene, clearSceneHistory, type AnyNodeId } from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode } from "../schema";
import { StreetApplicationChangeSet } from "../domain/application-change-set";
import {
	captureStreetChangePreconditions,
	prepareHostStreetChangeSet,
	commitHostStreetChangeSet,
} from "./application-change-set";
import { createLegacyStreetProject } from "../street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./street-project-persistence";
const siteId = "site_changes" as AnyNodeId,
	buildingId = "building_changes" as AnyNodeId,
	levelId = "level_changes" as AnyNodeId;
const date = "2026-10-08T10:00:00Z";
function road(id = "road-network_changes") {
	return RoadNetworkNode.parse({
		id,
		parentId: levelId,
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [20, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
	});
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
beforeEach(() => {
	const site = SiteNode.parse({ id: siteId, children: [buildingId] }),
		building = BuildingNode.parse({
			id: buildingId,
			parentId: siteId,
			children: [levelId],
		}),
		level = LevelNode.parse({ id: levelId, parentId: buildingId });
	useScene.setState({
		nodes: { [siteId]: site, [buildingId]: building, [levelId]: level },
		rootNodeIds: [siteId],
		collections: {},
		materials: {},
		readOnly: false,
	});
	clearSceneHistory();
});
function createChange() {
	return StreetApplicationChangeSet.parse({
		format: "street-application-change-set",
		schemaVersion: 1,
		id: "create-road",
		reason: "Add an authored road",
		expected: captureStreetChangePreconditions(siteId),
		create: [{ node: json(road()), parentId: levelId }],
		update: [],
		delete: [],
		identityRemaps: [],
		affectedGeometry: [road().id],
	});
}
function seedDocument() {
	const state = useScene.getState(),
		project = createLegacyStreetProject({
			id: "project-changes",
			name: "Changes",
			baselineRevisionId: "b",
			acceptedAt: date,
			roads: [],
		});
	project.sourceReferences.source = {
		id: "source",
		provider: "recorded",
		acquiredAt: null,
		contentIdentity: null,
		snapshot: { status: "unavailable", reason: "Original data unavailable" },
	};
	const prepared = prepareStreetProjectPersistence(state, siteId, {
		project,
		projection: { baselineRevisionId: "b", scenarioId: null, bindings: [] },
		expectedRevision: null,
	});
	useScene
		.getState()
		.applyNodeChanges({
			update: [{ id: siteId, data: { metadata: prepared.metadata } }],
		});
	clearSceneHistory();
	return prepared.document;
}
test("valid create commits once and undo restores the whole original graph", () => {
	const before = useScene.getState().nodes,
		change = createChange(),
		prepared = prepareHostStreetChangeSet(change);
	expect(useScene.getState().nodes).toBe(before);
	expect(prepared.next.nodes[levelId]!.children).toEqual([road().id]);
	commitHostStreetChangeSet(change);
	expect(useScene.getState().nodes[road().id as AnyNodeId]).toBeDefined();
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(before);
});
test("invalid final feature leaves no nodes and no undo entry", () => {
	const before = useScene.getState().nodes,
		change = createChange(),
		last = road("road-network_invalid");
	last.edges.ab!.endNodeId = "missing";
	change.create.push({ node: json(last), parentId: levelId });
	change.affectedGeometry.push(last.id);
	expect(() => commitHostStreetChangeSet(change)).toThrow("Invalid final road");
	expect(useScene.getState().nodes).toBe(before);
	expect(useScene.temporal.getState().pastStates).toHaveLength(0);
});
test("a delayed result cannot overwrite a newer edit or document revision", async () => {
	seedDocument();
	const stale = createChange();
	await Promise.resolve();
	useScene
		.getState()
		.applyNodeChanges({
			update: [{ id: levelId, data: { name: "Newer edit" } }],
		});
	const newer = useScene.getState().nodes,
		count = useScene.temporal.getState().pastStates.length;
	expect(() => commitHostStreetChangeSet(stale)).toThrow("Scene changed");
	expect(useScene.getState().nodes).toBe(newer);
	expect(useScene.temporal.getState().pastStates.length).toBe(count);
	const revision = createChange();
	revision.expected.documentRevision = 99;
	expect(() => commitHostStreetChangeSet(revision)).toThrow(
		"document revision changed",
	);
});
test("document history, sources, owner and revision cannot be silently replaced", () => {
	const stored = seedDocument(),
		before = useScene.getState().nodes;
	const make = (project = stored.project) =>
		StreetApplicationChangeSet.parse({
			...createChange(),
			create: [],
			affectedGeometry: [],
			update: [
				{
					id: siteId,
					data: {
						metadata: {
							"pascal:streetscape-project": {
								...stored,
								project: json(project),
							},
						},
					},
				},
			],
		});
	const source = structuredClone(stored.project);
	source.revision++;
	source.sourceReferences.source!.snapshot = {
		status: "unavailable",
		reason: "Rewritten data",
	};
	expect(() => commitHostStreetChangeSet(make(source))).toThrow(
		"source reference is immutable",
	);
	const history = structuredClone(stored.project);
	history.revision++;
	history.baselineRevisions.b!.acceptedAt = "2026-10-08T11:00:00Z";
	expect(() => commitHostStreetChangeSet(make(history))).toThrow(
		"historical baseline is immutable",
	);
	const noRevision = structuredClone(stored.project);
	noRevision.name = "Changed";
	expect(() => commitHostStreetChangeSet(make(noRevision))).toThrow(
		"advance its revision",
	);
	expect(useScene.getState().nodes).toBe(before);
});
test("edge and node removals require explicit valid identity remaps", () => {
	commitHostStreetChangeSet(createChange());
	const before = useScene.getState().nodes,
		change = StreetApplicationChangeSet.parse({
			...createChange(),
			create: [],
			update: [{ id: road().id, data: { edges: {}, graphNodes: {} } }],
			affectedGeometry: [road().id],
		});
	expect(() => commitHostStreetChangeSet(change)).toThrow("explicit remap");
	expect(useScene.getState().nodes).toBe(before);
	change.identityRemaps = [
		{ from: { kind: "road-edge", networkId: road().id, id: "ab" }, to: [] },
		{ from: { kind: "road-node", networkId: road().id, id: "a" }, to: [] },
		{ from: { kind: "road-node", networkId: road().id, id: "b" }, to: [] },
	];
	commitHostStreetChangeSet(change);
	expect(
		RoadNetworkNode.parse(useScene.getState().nodes[road().id as AnyNodeId])
			.edges,
	).toEqual({});
});
test("read-only scene and omitted affected geometry reject before mutation", () => {
	const change = createChange();
	change.affectedGeometry = [];
	expect(() => commitHostStreetChangeSet(change)).toThrow("not declared");
	useScene.setState({ readOnly: true });
	expect(() => commitHostStreetChangeSet(createChange())).toThrow("read-only");
});

test("active baseline removals require explicit semantic identity remaps", () => {
	const stored = seedDocument();
	stored.project.baselineRevisions.b!.features.feature = {
		id: "feature",
		kind: "scene-asset",
		origin: "authored",
		sourceReferenceIds: [],
		sourceFeatureId: null,
		representation: "pascal-scene-node-v1",
		data: {},
	};
	useScene
		.getState()
		.applyNodeChanges({
			update: [
				{
					id: siteId,
					data: { metadata: { "pascal:streetscape-project": json(stored) } },
				},
			],
		});
	clearSceneHistory();
	const next = structuredClone(stored);
	next.project.revision++;
	next.project.baselineRevisions.next = {
		...structuredClone(next.project.baselineRevisions.b!),
		id: "next",
		parentRevisionId: "b",
		features: {},
	};
	next.project.activeBaselineRevisionId = "next";
	next.projection.baselineRevisionId = "next";
	const change = StreetApplicationChangeSet.parse({
		...createChange(),
		create: [],
		affectedGeometry: [],
		update: [
			{
				id: siteId,
				data: { metadata: { "pascal:streetscape-project": json(next) } },
			},
		],
	});
	const before = useScene.getState().nodes;
	expect(() => commitHostStreetChangeSet(change)).toThrow(
		"Removed baseline identity",
	);
	expect(useScene.getState().nodes).toBe(before);
	expect(useScene.temporal.getState().pastStates).toHaveLength(0);
	change.identityRemaps = [
		{ from: { kind: "baseline-feature", siteId, id: "feature" }, to: [] },
	];
	commitHostStreetChangeSet(change);
	expect(
		readStreetProjectFromSite(useScene.getState().nodes[siteId])!.project
			.activeBaselineRevisionId,
	).toBe("next");
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
});
