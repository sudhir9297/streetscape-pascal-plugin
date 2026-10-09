import { expect, test } from "bun:test";
import { SiteNode } from "@pascal-app/core/schema";
import { parseStreetProject } from "../domain/street-project";
import { resolveStreetProperty } from "../domain/street-resolution";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
	readStreetProjectView,
	inspectStreetProjectProjection,
	STREET_PROJECT_METADATA_KEY,
	type PersistenceScene,
	type StreetProjectProjection,
} from "./street-project-persistence";

async function fixture() {
	const project = parseStreetProject(
		await Bun.file(
			new URL(
				"../../docs/fixtures/street-project-v1.evidence.json",
				import.meta.url,
			),
		).json(),
	);
	const site = SiteNode.parse({
		id: "site_persistence",
		metadata: { foreign: { keep: true } },
	});
	const scene: PersistenceScene = {
		nodes: {
			[site.id]: site,
			road: { id: "road", type: "streetscape:road-network", parentId: site.id },
		},
		rootNodeIds: [site.id],
	};
	const projection: StreetProjectProjection = {
		baselineRevisionId: project.activeBaselineRevisionId,
		scenarioId: project.activeScenarioId,
		bindings: [
			{ category: "roads", featureId: "road-block", nodeIds: ["road"] },
		],
	};
	return { project, scene, projection, site };
}
test("view reads reuse immutable documents and invalidate when site metadata changes", async () => {
	const { project, scene, projection, site } = await fixture();
	const prepared = prepareStreetProjectPersistence(scene, site.id, { project, projection, expectedRevision: null });
	const owner = { ...site, metadata: prepared.metadata };
	const first = readStreetProjectView(owner)!;
	expect(readStreetProjectView(owner)).toBe(first);
	expect(Object.isFrozen(first.project)).toBe(true);
	expect(Object.isFrozen(first.project.baselineRevisions)).toBe(true);
	const detached = readStreetProjectFromSite(owner)!;
	detached.project.name = "Detached edit";
	expect(readStreetProjectView(owner)!.project.name).not.toBe("Detached edit");
	owner.metadata = { ...prepared.metadata, [STREET_PROJECT_METADATA_KEY]: {
		...prepared.document, project: { ...prepared.document.project, name: "Changed document" },
	} };
	expect(readStreetProjectView(owner)).not.toBe(first);
	expect(readStreetProjectView(owner)!.project.name).toBe("Changed document");
});
test("site metadata round-trips a complete project including source snapshot, evidence, geometry and scenarios", async () => {
	const { project, scene, projection, site } = await fixture();
	const before = JSON.stringify(scene);
	const result = prepareStreetProjectPersistence(scene, site.id, {
		project,
		projection,
		expectedRevision: null,
	});
	expect(JSON.stringify(scene)).toBe(before);
	expect(result.metadata.foreign).toEqual({ keep: true });
	const disk = JSON.stringify({ ...site, metadata: result.metadata });
	const reopened = readStreetProjectFromSite(SiteNode.parse(JSON.parse(disk)))!;
	expect(reopened.project).toEqual(project);
	const property = resolveStreetProperty(
		reopened.project,
		"baseline-corrected",
		"sidewalk-width",
		"walking-proposal",
	);
	expect(property.claims.osm!.value).toBe(1.5);
	expect(property.accepted.value).toBe(1.8);
	expect(property.design!.value).toBe(2.4);
	expect(result.sceneBytes).toBeGreaterThan(disk.length);
	project.name = "changed input";
	expect(reopened.project.name).not.toBe(project.name);
});
test("rejects stale revisions, a second project and nonadvancing writes", async () => {
	const { project, scene, projection, site } = await fixture();
	const first = prepareStreetProjectPersistence(scene, site.id, {
		project,
		projection,
		expectedRevision: null,
	});
	scene.nodes[site.id] = { ...site, metadata: first.metadata };
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection,
			expectedRevision: null,
		}),
	).toThrow("revision conflict");
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection,
			expectedRevision: project.revision,
		}),
	).toThrow("must advance");
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project: { ...project, id: "different", revision: project.revision + 1 },
			projection,
			expectedRevision: project.revision,
		}),
	).toThrow("different street project");
	const updated = prepareStreetProjectPersistence(scene, site.id, {
		project: { ...project, revision: project.revision + 1 },
		projection,
		expectedRevision: project.revision,
	});
	expect(updated.document.project.revision).toBe(project.revision + 1);
});
test("deletion or reparenting reports stale projection references without deleting evidence", async () => {
	const { project, scene, projection, site } = await fixture();
	const { document } = prepareStreetProjectPersistence(scene, site.id, {
		project,
		projection,
		expectedRevision: null,
	});
	delete scene.nodes.road;
	expect(
		inspectStreetProjectProjection(scene, site.id, document)[0]!.status,
	).toBe("missing");
	expect(document.project).toEqual(project);
	scene.nodes.road = {
		id: "road",
		type: "streetscape:road-network",
		parentId: "elsewhere",
	};
	expect(
		inspectStreetProjectProjection(scene, site.id, document)[0]!.status,
	).toBe("outside-owner");
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection,
			expectedRevision: null,
		}),
	).toThrow("Invalid projection reference");
});
test("rejects unsupported or malformed stored documents without treating them as absent", async () => {
	const { site } = await fixture();
	expect(readStreetProjectFromSite(site)).toBeNull();
	expect(() =>
		readStreetProjectFromSite({
			...site,
			metadata: { [STREET_PROJECT_METADATA_KEY]: { schemaVersion: 2 } },
		}),
	).toThrow("Unsupported");
	expect(() =>
		readStreetProjectFromSite({
			...site,
			metadata: { [STREET_PROJECT_METADATA_KEY]: null },
		}),
	).toThrow();
});
test("requires root-site ownership, valid active projection and bounded complete scene size", async () => {
	const { project, scene, projection, site } = await fixture();
	expect(() =>
		prepareStreetProjectPersistence({ ...scene, rootNodeIds: [] }, site.id, {
			project,
			projection,
			expectedRevision: null,
		}),
	).toThrow("root site");
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection: { ...projection, scenarioId: null },
			expectedRevision: null,
		}),
	).toThrow("active baseline and scenario");
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection,
			expectedRevision: null,
			maxSceneBytes: 100,
		}),
	).toThrow("limit 100");
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection,
			expectedRevision: null,
			maxSceneBytes: 0,
		}),
	).toThrow("positive integer");
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection: {
				...projection,
				bindings: [...projection.bindings, ...projection.bindings],
			},
			expectedRevision: null,
		}),
	).toThrow("must be unique");
});
test("external and unavailable snapshots persist explicitly without fetching or fabricating data", async () => {
	const { project, scene, projection, site } = await fixture();
	for (const snapshot of [
		{
			status: "external" as const,
			format: "overpass-json",
			uri: "https://example.com/snapshot.json",
		},
		{ status: "unavailable" as const, reason: "Legacy raw evidence missing" },
	]) {
		project.sourceReferences["osm-snapshot"]!.snapshot = snapshot;
		const result = prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection,
			expectedRevision: null,
		});
		expect(
			readStreetProjectFromSite({ ...site, metadata: result.metadata })!.project
				.sourceReferences["osm-snapshot"]!.snapshot,
		).toEqual(snapshot);
	}
});

test("rejects road bindings to containers and preserves future domain documents on read", async () => {
	const { project, scene, projection, site } = await fixture();
	const badProjection = {
		...projection,
		bindings: [
			{
				category: "roads" as const,
				featureId: "road-block",
				nodeIds: [site.id],
			},
		],
	};
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project,
			projection: badProjection,
			expectedRevision: null,
		}),
	).toThrow("wrong-kind");
	const result = prepareStreetProjectPersistence(scene, site.id, {
		project,
		projection,
		expectedRevision: null,
	});
	const metadata = {
		...result.metadata,
		[STREET_PROJECT_METADATA_KEY]: {
			...result.document,
			project: { ...project, schemaVersion: 2 },
		},
	};
	expect(() => readStreetProjectFromSite({ ...site, metadata })).toThrow(
		"Unsupported street project schema version",
	);
});

test("large embedded evidence saves losslessly within the actual host byte limit", async () => {
	const { project, scene, projection, site } = await fixture();
	project.baselineRevisions[
		project.activeBaselineRevisionId
	]!.resolutionEvidence = {
		retained: "Original source evidence. ".repeat(500000),
	};
	const result = prepareStreetProjectPersistence(scene, site.id, {
		project,
		projection,
		expectedRevision: null,
	});
	expect(result.metadata[STREET_PROJECT_METADATA_KEY]).toHaveProperty(
		"format",
		"streetscape-report-gzip",
	);
	expect(result.sceneBytes).toBeLessThan(10 * 1024 * 1024);
	const disk = JSON.parse(
		JSON.stringify({ ...site, metadata: result.metadata }),
	);
	expect(readStreetProjectFromSite(disk)!.project).toEqual(project);
	const corrupt = structuredClone(disk);
	corrupt.metadata[STREET_PROJECT_METADATA_KEY].byteLength++;
	expect(() => readStreetProjectFromSite(corrupt)).toThrow();
});
