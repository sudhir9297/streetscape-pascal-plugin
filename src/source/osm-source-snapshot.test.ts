import { expect, test } from "bun:test";
import { acquireOsmData, parseOsmAcquisition } from "./osm-acquisition";
import {
	createOsmSourceSnapshot,
	parseOsmSourceSnapshot,
} from "./osm-source-snapshot";
import {
	attachOsmSourceSnapshot,
	verifyStreetProjectSnapshots,
} from "./osm-snapshot-project";
import { parseStreetProject } from "../domain/street-project";
import { interpretOsmAcquisition } from "./osm-interpretation";
import { encodeOsmHostProjection } from "../host/osm-projection-encoding";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "../host/street-project-persistence";
import { SiteNode } from "@pascal-app/core/schema";
const DATE = "2026-10-08T10:00:00Z";
async function acquisition() {
	return parseOsmAcquisition(
		await Bun.file(
			new URL("../../docs/fixtures/osm-acquisition-v1.json", import.meta.url),
		).json(),
	);
}
async function project() {
	return parseStreetProject(
		(
			await Bun.file(
				new URL(
					"../../docs/fixtures/street-project-v1.examples.json",
					import.meta.url,
				),
			).json()
		).imported,
	);
}

test("retains original source values, geometry and response metadata and deeply freezes snapshots", async () => {
	const original = await acquisition();
	const snapshot = await createOsmSourceSnapshot(original);
	expect(snapshot.acquisition.responses[0]!.payload).toEqual(
		original.responses[0]!.payload,
	);
	expect(snapshot.acquiredAt).toBeNull();
	expect(snapshot.completeness.capture.status).toBe("unavailable");
	expect(snapshot.completeness.elementMetadata.missingFields.version).toBe(3);
	expect(snapshot.completeness.geometry.status).toBe("complete");
	expect(Object.isFrozen(snapshot)).toBe(true);
	expect(
		Object.isFrozen(snapshot.acquisition.responses[0]!.payload.elements),
	).toBe(true);
	expect(() => {
		(
			snapshot.acquisition.responses[0]!.payload as Record<string, unknown>
		).elements = [];
	}).toThrow();
	original.responses[0]!.payload.elements = [];
	expect(
		(snapshot.acquisition.responses[0]!.payload.elements as readonly unknown[])
			.length,
	).toBe(3);
	expect(await parseOsmSourceSnapshot(JSON.stringify(snapshot))).toEqual(
		snapshot,
	);
});
test("records capture time and headers, requests element metadata and computes complete/partial metadata coverage", async () => {
	const input = await acquisition(),
		payload = input.responses[0]!.payload;
	for (const element of payload.elements as Array<Record<string, unknown>>)
		Object.assign(element, {
			version: 1,
			timestamp: DATE,
			changeset: 7,
			uid: 8,
			user: "fixture-user",
		});
	const acquired = await acquireOsmData(input.bbox, {
		now: () => DATE,
		fetch: async (_url, init) => {
			expect(decodeURIComponent(String(init?.body))).toContain(
				"out meta geom;",
			);
			return new Response(JSON.stringify(payload), {
				headers: {
					"content-type": "application/json",
					etag: "fixture-etag",
					"last-modified": "Thu, 08 Oct 2026 10:00:00 GMT",
				},
			});
		},
	});
	const snapshot = await createOsmSourceSnapshot(acquired);
	expect(snapshot.acquiredAt).toBe(DATE);
	expect(snapshot.completeness.elementMetadata.status).toBe("complete");
	expect(snapshot.acquisition.responses[0]!.capture).toMatchObject({
		elementMetadataRequested: true,
		etag: "fixture-etag",
		httpStatus: 200,
		acquiredAt: DATE,
	});
	delete (payload.elements as Array<Record<string, unknown>>)[0]!.uid;
	acquired.responses[0]!.payload = payload;
	expect(
		(await createOsmSourceSnapshot(acquired)).completeness.elementMetadata
			.status,
	).toBe("partial");
});
test("content identity ignores object key order and capture time, integrity identity preserves the audit record", async () => {
	const a = await acquisition(),
		b = await acquisition();
	b.responses[0]!.payload = Object.fromEntries(
		Object.entries(b.responses[0]!.payload).reverse(),
	);
	const first = await createOsmSourceSnapshot(a),
		second = await createOsmSourceSnapshot(b);
	expect(first.contentIdentity).toBe(second.contentIdentity);
	b.responses[0]!.capture = {
		acquiredAt: DATE,
		query: "out meta geom;",
		elementMetadataRequested: null,
		httpStatus: 200,
		contentType: null,
		etag: null,
		lastModified: null,
	};
	const timed = await createOsmSourceSnapshot(b);
	expect(timed.contentIdentity).toBe(first.contentIdentity);
	expect(timed.integrityIdentity).not.toBe(first.integrityIdentity);
});
test("rejects changed content, capture metadata, completeness and future versions on replay", async () => {
	const snapshot = await createOsmSourceSnapshot(await acquisition());
	const edited = JSON.parse(JSON.stringify(snapshot));
	edited.acquisition.responses[0].payload.elements[0].tags.width = "9";
	await expect(parseOsmSourceSnapshot(edited)).rejects.toThrow(
		"content identity mismatch",
	);
	const metadata = JSON.parse(JSON.stringify(snapshot));
	metadata.acquiredAt = DATE;
	await expect(parseOsmSourceSnapshot(metadata)).rejects.toThrow(
		"integrity identity mismatch",
	);
	const incomplete = JSON.parse(JSON.stringify(snapshot));
	incomplete.completeness.geometry.complete = 0;
	await expect(parseOsmSourceSnapshot(incomplete)).rejects.toThrow(
		"integrity identity mismatch",
	);
	await expect(
		parseOsmSourceSnapshot({ ...snapshot, schemaVersion: 2 }),
	).rejects.toThrow("Unsupported");
});
test("interpretation keeps raw tags and host projection encoding detaches them only at serialization", async () => {
	const snapshot = await createOsmSourceSnapshot(await acquisition());
	const interpreted = interpretOsmAcquisition(
		parseOsmAcquisition(snapshot.acquisition),
	);
	expect(interpreted.ways[0]!.tags.wikipedia).toBe("en:Example");
	expect(interpreted.ways[0]!.tags.source).toBe("US:NY");
	const data = {
		edges: { edge: { osmSource: { tags: interpreted.ways[0]!.tags } } },
		osmMappedSurfaces: [{ tags: interpreted.ways[0]!.tags }],
	};
	const encoded = encodeOsmHostProjection(data);
	expect(encoded.edges.edge.osmSource.tags.wikipedia).toBe(
		"https://en.wikipedia.org/wiki/Example",
	);
	expect(encoded.osmMappedSurfaces[0]!.tags.source).toBe("US%3ANY");
	expect(data.edges.edge.osmSource.tags.wikipedia).toBe("en:Example");
	expect((await parseOsmSourceSnapshot(snapshot)).contentIdentity).toBe(
		snapshot.contentIdentity,
	);
});
test("retains and verifies snapshot evidence through the supported complete-document owner", async () => {
	const original = await project(),
		snapshot = await createOsmSourceSnapshot(await acquisition());
	const updated = await attachOsmSourceSnapshot(
		original,
		"capture-1",
		snapshot,
	);
	expect(original.sourceReferences["capture-1"]).toBeUndefined();
	const site = SiteNode.parse({ id: "site_snapshot" }),
		scene = { nodes: { [site.id]: site }, rootNodeIds: [site.id] };
	const projection = {
		baselineRevisionId: updated.activeBaselineRevisionId,
		scenarioId: updated.activeScenarioId,
		bindings: [],
	};
	const prepared = prepareStreetProjectPersistence(scene, site.id, {
		project: updated,
		projection,
		expectedRevision: null,
	});
	const reopened = readStreetProjectFromSite(
		JSON.parse(JSON.stringify({ ...site, metadata: prepared.metadata })),
	)!;
	expect(
		(await verifyStreetProjectSnapshots(reopened.project)).snapshots[
			"capture-1"
		],
	).toEqual(snapshot);
	scene.nodes[site.id] = { ...site, metadata: prepared.metadata };
	const modified = parseStreetProject(updated);
	modified.revision++;
	modified.sourceReferences["capture-1"]!.snapshot = {
		status: "unavailable",
		reason: "Dropped",
	};
	expect(() =>
		prepareStreetProjectPersistence(scene, site.id, {
			project: modified,
			projection,
			expectedRevision: updated.revision,
		}),
	).toThrow("immutable");
	await expect(
		attachOsmSourceSnapshot(updated, "capture-1", snapshot),
	).rejects.toThrow("already exists");
});
test("explicitly reports incomplete geometry without deleting the raw captured coordinates", async () => {
	const input = await acquisition();
	const elements = input.responses[0]!.payload.elements as Array<
		Record<string, unknown>
	>;
	elements[0]!.geometry = [null, { lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }];
	const snapshot = await createOsmSourceSnapshot(input);
	expect(snapshot.completeness.geometry.status).toBe("partial");
	expect(
		(snapshot.acquisition.responses[0]!.payload.elements as readonly unknown[])
			.length,
	).toBe(3);
});

test("saved snapshot fixture verifies its content and capture record", async () => {
	const value = await Bun.file(
		new URL("../../docs/fixtures/osm-source-snapshot-v1.json", import.meta.url),
	).json();
	const snapshot = await parseOsmSourceSnapshot(value);
	expect(snapshot.completeness.elementMetadata.status).toBe("complete");
	expect(snapshot.acquiredAt).toBe(DATE);
	expect(await parseOsmSourceSnapshot(JSON.stringify(snapshot))).toEqual(
		snapshot,
	);
});
