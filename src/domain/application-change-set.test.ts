import { expect, test } from "bun:test";
import {
	StreetApplicationChangeSet,
	prepareStreetApplicationChangeSet,
	streetSceneContent,
	type ApplicationScene,
} from "./application-change-set";
const scene: ApplicationScene = {
	nodes: {
		site: { id: "site", type: "site", parentId: null, children: ["level"] },
		level: { id: "level", type: "level", parentId: "site", children: [] },
	},
	rootNodeIds: ["site"],
};
const change = () =>
	StreetApplicationChangeSet.parse({
		format: "street-application-change-set",
		schemaVersion: 1,
		id: "operation",
		reason: "Import streets",
		expected: {
			sceneContent: streetSceneContent(scene),
			siteId: null,
			projectId: null,
			documentRevision: null,
		},
		create: [
			{ node: { id: "road", type: "road", children: [] }, parentId: "level" },
		],
		update: [],
		delete: [],
		identityRemaps: [],
		affectedGeometry: ["road"],
	});
const options = {
	readDocument: () => null,
	parseNode: (node: ApplicationScene["nodes"][string]) => node,
};
test("complete change preparation is detached and validates parent ownership", () => {
	const before = JSON.stringify(scene),
		prepared = prepareStreetApplicationChangeSet(scene, change(), options);
	expect(prepared.next.nodes.level!.children).toEqual(["road"]);
	expect(prepared.next.nodes.road!.parentId).toBe("level");
	expect(JSON.stringify(scene)).toBe(before);
	const invalid = change();
	invalid.create[0]!.parentId = "missing";
	expect(() =>
		prepareStreetApplicationChangeSet(scene, invalid, options),
	).toThrow("Missing parent");
	expect(JSON.stringify(scene)).toBe(before);
});
test("final feature failure and stale scene/document preconditions never mutate the source", () => {
	const before = JSON.stringify(scene),
		invalid = change();
	invalid.create.push({
		node: { id: "final", type: "invalid" },
		parentId: "level",
	});
	expect(() =>
		prepareStreetApplicationChangeSet(scene, invalid, {
			...options,
			parseNode: (node) => {
				if (node.type === "invalid") throw Error("Final feature failed");
				return node;
			},
		}),
	).toThrow("Final feature failed");
	expect(JSON.stringify(scene)).toBe(before);
	const updated = structuredClone(scene);
	updated.nodes.level!.name = "Newer edit";
	expect(() =>
		prepareStreetApplicationChangeSet(updated, change(), options),
	).toThrow("Scene changed");
	const stale = change();
	stale.expected.siteId = "site";
	stale.expected.projectId = "project";
	stale.expected.documentRevision = 2;
	expect(() =>
		prepareStreetApplicationChangeSet(scene, stale, {
			...options,
			readDocument: () => ({ id: "project", revision: 3 }),
		}),
	).toThrow("document revision changed");
});
test("conflicting writes, identity changes and unsupported versions are rejected", () => {
	const unpaired = change();
	unpaired.expected.siteId = "site";
	unpaired.expected.projectId = "project";
	expect(() => StreetApplicationChangeSet.parse(unpaired)).toThrow(
		"supplied together",
	);
	const invalid = change();
	invalid.update.push({ id: "road", data: {}, unset: [] });
	expect(() => StreetApplicationChangeSet.parse(invalid)).toThrow(
		"Conflicting operations",
	);
	const identity = change();
	identity.update.push({ id: "level", data: { id: "other" }, unset: [] });
	expect(() => StreetApplicationChangeSet.parse(identity)).toThrow(
		"node identity",
	);
	expect(() =>
		StreetApplicationChangeSet.parse({ ...change(), schemaVersion: 2 }),
	).toThrow();
});

test("identity remaps use qualified entities and require existing sources and final targets", () => {
	const remap = change();
	remap.identityRemaps = [
		{
			from: { kind: "host-node", id: "level" },
			to: [{ kind: "host-node", id: "road" }],
		},
	];
	const identityExists = (scene: ApplicationScene, ref: { id: string }) =>
		Object.hasOwn(scene.nodes, ref.id);
	expect(
		prepareStreetApplicationChangeSet(scene, remap, {
			...options,
			identityExists,
		}).change.identityRemaps,
	).toHaveLength(1);
	remap.identityRemaps[0]!.to[0]!.id = "missing";
	expect(() =>
		prepareStreetApplicationChangeSet(scene, remap, {
			...options,
			identityExists,
		}),
	).toThrow("remap target");
	remap.identityRemaps[0]!.from.id = "missing";
	expect(() =>
		prepareStreetApplicationChangeSet(scene, remap, {
			...options,
			identityExists,
		}),
	).toThrow("remap source");
	expect(() =>
		StreetApplicationChangeSet.parse({
			...remap,
			identityRemaps: [
				{
					from: { kind: "road-edge", networkId: "network", id: "edge" },
					to: [{ kind: "host-node", id: "road" }],
				},
			],
		}),
	).toThrow("preserve entity kind");
});
