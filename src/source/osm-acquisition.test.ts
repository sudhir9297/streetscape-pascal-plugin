import { expect, test } from "bun:test";
import {
	acquireOsmData,
	parseOsmAcquisition,
	OsmAcquisitionError,
} from "./osm-acquisition";
import { interpretOsmAcquisition } from "./osm-interpretation";
import {
	prepareOsmStreetImport,
	completeOsmStreetImport,
	fetchOsmMapData,
} from "../osm-import";
const bbox = { south: -0.01, west: -0.01, north: 0.01, east: 0.01 };
const request = () => ({ url: "/recorded-osm" });
const response = (data: unknown) => new Response(JSON.stringify(data));
async function fixture() {
	return parseOsmAcquisition(
		await Bun.file(
			new URL("../../docs/fixtures/osm-acquisition-v1.json", import.meta.url),
		).json(),
	);
}

test("raw acquisition preserves source facts and interpretation is a detached offline replay", async () => {
	const captured = await fixture(),
		raw = captured.responses[0]!.payload;
	let calls = 0;
	const acquired = await acquireOsmData(bbox, {
		request,
		fetch: async () => {
			calls++;
			return response(raw);
		},
	});
	expect(calls).toBe(1);
	expect(acquired.responses[0]!.payload).toEqual(raw);
	const before = JSON.stringify(acquired);
	const interpreted = interpretOsmAcquisition(acquired);
	expect(interpreted.ways[0]!.tags.wikipedia).toBe("en:Example");
	expect(interpreted.ways[0]!.tags.source).toBe("US:NY");
	expect(JSON.stringify(acquired)).toBe(before);
	const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 300, {
		loadAcquisition: async () => acquired,
	});
	const completed = await completeOsmStreetImport(prepared);
	expect(completed.stats.edges).toBe(1);
	expect(completed.assets.some((asset) => asset.kind === "street-lamp")).toBe(
		true,
	);
	expect(completed.acquisition).toEqual(acquired);
	expect(interpretOsmAcquisition(JSON.parse(JSON.stringify(acquired)))).toEqual(
		interpreted,
	);
	expect(calls).toBe(1);
});
test("captures subdivision responses separately with diagnostics and deduplicates only during interpretation", async () => {
	const payload = (await fixture()).responses[0]!.payload;
	let calls = 0;
	const acquired = await acquireOsmData(bbox, {
		request,
		fetch: async () =>
			++calls === 1 ? new Response("", { status: 504 }) : response(payload),
	});
	expect(calls).toBe(5);
	expect(acquired.responses).toHaveLength(4);
	expect(acquired.diagnostics).toEqual([
		{ code: "subdivided", bbox, httpStatus: 504, depth: 0 },
	]);
	expect(interpretOsmAcquisition(acquired).ways).toHaveLength(1);
});
test("distinguishes malformed data, service remarks, network failures and valid empty responses", async () => {
	for (const payload of [
		{},
		null,
		{ elements: [{ type: "way", id: 1, tags: { width: 3 } }] },
		{ elements: [{ type: "node", id: 1, lat: Infinity }] },
		{ elements: [], remark: "runtime error: timeout" },
	]) {
		await expect(
			acquireOsmData(bbox, { request, fetch: async () => response(payload) }),
		).rejects.toBeInstanceOf(OsmAcquisitionError);
	}
	await expect(
		acquireOsmData(bbox, {
			request,
			fetch: async () => new Response("not JSON"),
		}),
	).rejects.toMatchObject({ code: "invalid-response" });
	await expect(
		acquireOsmData(bbox, {
			request,
			fetch: async () => {
				throw Error("offline");
			},
		}),
	).rejects.toMatchObject({ code: "network" });
	const empty = await acquireOsmData(bbox, {
		request,
		fetch: async () => response({ elements: [] }),
	});
	expect(interpretOsmAcquisition(empty).ways).toEqual([]);
	await expect(
		prepareOsmStreetImport({ lat: 0, lon: 0 }, 300, {
			loadAcquisition: async () => empty,
		}),
	).rejects.toThrow("No streets were found");
});
test("rate limits do not subdivide and retry depth stays bounded", async () => {
	let calls = 0;
	await expect(
		acquireOsmData(bbox, {
			request,
			fetch: async () => {
				calls++;
				return new Response("", { status: 429 });
			},
		}),
	).rejects.toMatchObject({ code: "rate-limit", httpStatus: 429 });
	expect(calls).toBe(1);
	calls = 0;
	await expect(
		acquireOsmData(bbox, {
			request,
			fetch: async () => {
				calls++;
				return new Response("", { status: 503 });
			},
		}),
	).rejects.toMatchObject({ code: "http", httpStatus: 503 });
	expect(calls).toBe(3);
});
test("cancellation propagates before and during transport instead of becoming empty streets", async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	await expect(
		acquireOsmData(bbox, {
			signal: controller.signal,
			request,
			fetch: async () => {
				calls++;
				return response({ elements: [] });
			},
		}),
	).rejects.toMatchObject({ name: "AbortError" });
	expect(calls).toBe(0);
	const running = new AbortController();
	await expect(
		acquireOsmData(bbox, {
			signal: running.signal,
			request,
			fetch: async (_url, init) => {
				expect(init?.signal).toBeInstanceOf(AbortSignal);
				running.abort();
				return response({ elements: [] });
			},
		}),
	).rejects.toMatchObject({ name: "AbortError" });
});
test("compatibility facade reports invalid transport responses instead of no-roads results", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = (async () =>
		response({ remark: "query failed" })) as unknown as typeof fetch;
	try {
		await expect(fetchOsmMapData(bbox)).rejects.toMatchObject({
			code: "invalid-response",
		});
	} finally {
		globalThis.fetch = original;
	}
});
test("validates acquisition versions and request bounds before making requests", async () => {
	expect(() => parseOsmAcquisition({ schemaVersion: 2 })).toThrow(
		"Unsupported OSM acquisition version",
	);
	let calls = 0;
	await expect(
		acquireOsmData(
			{ ...bbox, north: bbox.south },
			{
				request,
				fetch: async () => {
					calls++;
					return response({ elements: [] });
				},
			},
		),
	).rejects.toThrow("Invalid OSM request bounds");
	expect(calls).toBe(0);
});

test("normal import captures responses and replay reproduces the completed graph without refetching", async () => {
	const payload = (await fixture()).responses[0]!.payload;
	const original = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return response(payload);
	}) as unknown as typeof fetch;
	try {
		const prepared = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 300, {
			loadTerrain: false,
		});
		const completed = await completeOsmStreetImport(prepared);
		expect(completed.acquisition).toBeDefined();
		const replay = await prepareOsmStreetImport({ lat: 0, lon: 0 }, 300, {
			loadAcquisition: async () => completed.acquisition!,
		});
		expect((await completeOsmStreetImport(replay)).graphs).toEqual(
			completed.graphs,
		);
		expect(calls).toBe(1);
	} finally {
		globalThis.fetch = original;
	}
});

test("raw way topology and geometry count mismatch is an invalid response", async () => {
	await expect(
		acquireOsmData(bbox, {
			request,
			fetch: async () =>
				response({
					elements: [
						{
							type: "way",
							id: 1,
							nodes: [1, 2],
							geometry: [{ lat: 0, lon: 0 }],
							tags: { highway: "residential" },
						},
					],
				}),
		}),
	).rejects.toMatchObject({ code: "invalid-response" });
});
