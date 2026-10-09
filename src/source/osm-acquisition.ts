import { z } from "zod";
import type { GeoBoundingBox } from "../domain/site-frame";
import { getStreetRequest, type MapDataRequest } from "../map-data-source";

const Bbox = z
	.strictObject({
		south: z.number().min(-90).max(90),
		north: z.number().min(-90).max(90),
		west: z.number().min(-180).max(180),
		east: z.number().min(-180).max(180),
	})
	.refine(
		(value) => value.south < value.north && value.west < value.east,
		"Invalid OSM request bounds",
	);
const GeometryPoint = z.looseObject({
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
});
const Element = z.looseObject({
	type: z.enum(["node", "way", "relation"]),
	id: z.number().int().positive(),
	tags: z.record(z.string(), z.string()).optional(),
	lat: z.number().min(-90).max(90).optional(),
	lon: z.number().min(-180).max(180).optional(),
	nodes: z.array(z.number().int().positive()).optional(),
	geometry: z.array(GeometryPoint.nullable()).optional(),
	members: z
		.array(
			z.looseObject({
				type: z.enum(["node", "way", "relation"]),
				ref: z.number().int().positive().optional(),
				role: z.string().optional(),
				geometry: z.array(GeometryPoint.nullable()).optional(),
			}),
		)
		.optional(),
});
const ValidatedElement = Element.refine(
	(element) =>
		element.type !== "way" ||
		!element.nodes ||
		!element.geometry ||
		element.nodes.length === element.geometry.length,
	"OSM way node and geometry counts differ",
);
const RawResponse = z.looseObject({
	elements: z.array(ValidatedElement),
	remark: z.string().optional(),
});
export const OsmResponseCapture = z.strictObject({
	acquiredAt: z.iso.datetime({ offset: true }),
	query: z.string().min(1),
	elementMetadataRequested: z.boolean().nullable(),
	httpStatus: z.number().int(),
	contentType: z.string().nullable(),
	etag: z.string().nullable(),
	lastModified: z.string().nullable(),
});
export type OsmAcquisitionDiagnostic = {
	code: "subdivided";
	bbox: GeoBoundingBox;
	httpStatus: number;
	depth: number;
};
export type OsmAcquisition = {
	format: "osm-acquisition";
	schemaVersion: 1;
	bbox: GeoBoundingBox;
	responses: Array<{
		bbox: GeoBoundingBox;
		capture?: z.infer<typeof OsmResponseCapture>;
		payload: Record<string, z.infer<ReturnType<typeof z.json>>>;
	}>;
	diagnostics: OsmAcquisitionDiagnostic[];
};
export class OsmAcquisitionError extends Error {
	constructor(
		readonly code:
			| "timeout"
			| "http"
			| "rate-limit"
			| "network"
			| "invalid-response"
			| "service-remark",
		message: string,
		readonly bbox: GeoBoundingBox,
		readonly httpStatus: number | null = null,
	) {
		super(message);
		this.name = "OsmAcquisitionError";
	}
}

/** Validate and detach without normalizing tags or generating street geometry. */
export function validateRawOsmResponse(
	input: unknown,
	bbox: GeoBoundingBox,
): OsmAcquisition["responses"][number]["payload"] {
	const json = z.record(z.string(), z.json()).safeParse(input);
	const shape = RawResponse.safeParse(input);
	if (!json.success || !shape.success)
		throw new OsmAcquisitionError(
			"invalid-response",
			"Street data service returned an invalid OSM response.",
			bbox,
		);
	if (shape.data.remark?.trim())
		throw new OsmAcquisitionError(
			"service-remark",
			`Street data service reported: ${shape.data.remark}`,
			bbox,
		);
	return json.data;
}
export function parseOsmAcquisition(input: unknown): OsmAcquisition {
	if (
		input &&
		typeof input === "object" &&
		"schemaVersion" in input &&
		input.schemaVersion !== 1
	)
		throw new Error(
			`Unsupported OSM acquisition version: ${String(input.schemaVersion)}`,
		);
	const envelope = z
		.strictObject({
			format: z.literal("osm-acquisition"),
			schemaVersion: z.literal(1),
			bbox: Bbox,
			responses: z
				.array(
					z.strictObject({
						bbox: Bbox,
						payload: z.unknown(),
						capture: OsmResponseCapture.optional(),
					}),
				)
				.min(1),
			diagnostics: z.array(
				z.strictObject({
					code: z.literal("subdivided"),
					bbox: Bbox,
					httpStatus: z.number().int(),
					depth: z.number().int().nonnegative(),
				}),
			),
		})
		.parse(input);
	return {
		...envelope,
		responses: envelope.responses.map((response) => ({
			...response,
			payload: validateRawOsmResponse(response.payload, response.bbox),
		})),
	};
}
export type OsmAcquisitionOptions = {
	signal?: AbortSignal;
	now?: () => string;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	request?: (bbox: GeoBoundingBox, query: string) => MapDataRequest;
};
async function acquireUncoordinatedOsmData(
	input: GeoBoundingBox,
	options: OsmAcquisitionOptions & {
		onResponse?: (response: Response) => void;
	} = {},
): Promise<OsmAcquisition> {
	const bbox = Bbox.parse(input);
	const transport = options.fetch ?? globalThis.fetch;
	const request = options.request ?? getStreetRequest;
	const run = async (
		bounds: GeoBoundingBox,
		depth: number,
	): Promise<Pick<OsmAcquisition, "responses" | "diagnostics">> => {
		options.signal?.throwIfAborted();
		const query = buildOverpassQuery(bounds);
		const spec = request(bounds, query);
		let response: Response;
		try {
			response = await transport(spec.url, {
				...spec.init,
				signal: options.signal,
			});
		} catch (error) {
			options.signal?.throwIfAborted();
			if (error instanceof Error && error.name === "AbortError") throw error;
			throw new OsmAcquisitionError(
				"network",
				`Street data request failed: ${error instanceof Error ? error.message : "network error"}`,
				bounds,
			);
		}
		options.signal?.throwIfAborted();
		options.onResponse?.(response);
		if (!response.ok) {
			await response.body?.cancel();
			if ([502, 503, 504].includes(response.status) && depth < 2) {
				const parts = [];
				for (const chunk of splitOsmBoundingBox(bounds))
					parts.push(await run(chunk, depth + 1));
				options.signal?.throwIfAborted();
				return {
					responses: parts.flatMap((part) => part.responses),
					diagnostics: [
						{
							code: "subdivided",
							bbox: bounds,
							httpStatus: response.status,
							depth,
						},
						...parts.flatMap((part) => part.diagnostics),
					],
				};
			}
			throw new OsmAcquisitionError(
				response.status === 429 ? "rate-limit" : "http",
				response.status === 429
					? "The street data service is busy. Try again in a minute."
					: `Street data request failed (HTTP ${response.status}).`,
				bounds,
				response.status,
			);
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			options.signal?.throwIfAborted();
			throw new OsmAcquisitionError(
				"invalid-response",
				"Street data service returned invalid JSON.",
				bounds,
			);
		}
		options.signal?.throwIfAborted();
		return {
			responses: [
				{
					bbox: bounds,
					payload: validateRawOsmResponse(payload, bounds),
					capture: OsmResponseCapture.parse({
						acquiredAt: (options.now ?? (() => new Date().toISOString()))(),
						query: spec.query ?? query,
						elementMetadataRequested: spec.elementMetadataRequested ?? null,
						httpStatus: response.status,
						contentType: response.headers.get("content-type"),
						etag: response.headers.get("etag"),
						lastModified: response.headers.get("last-modified"),
					}),
				},
			],
			diagnostics: [],
		};
	};
	return {
		format: "osm-acquisition",
		schemaVersion: 1,
		bbox,
		...(await run(bbox, 0)),
	};
}
export const IMPORTED_HIGHWAY_PATTERN =
	"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$";

export function buildOverpassQuery(bbox: GeoBoundingBox): string {
	const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
	return `[out:json][timeout:25];(way["highway"~"${IMPORTED_HIGHWAY_PATTERN}"]["area"!="yes"](${box});way["area:highway"](${box});relation["area:highway"](${box});way["highway"="footway"]["footway"~"^(sidewalk|crossing)$"](${box});way["highway"~"^(footway|path)$"]["sidewalk"](${box});way["highway"="cycleway"](${box});way["highway"="pedestrian"](${box});way["barrier"="kerb"](${box});node["barrier"="kerb"](${box});node["highway"="street_lamp"](${box});node["highway"="traffic_signals"](${box});node["traffic_sign"](${box});node["highway"~"^(stop|give_way|crossing)$"](${box});node["crossing"](${box});relation["type"="connectivity"](${box});relation["type"~"^restriction(:.*)?$"](${box});)->.selected;(.selected;way(r.selected);node(r.selected););out meta geom;`;
}

export function splitOsmBoundingBox(bbox: GeoBoundingBox): GeoBoundingBox[] {
	const latitude = (bbox.south + bbox.north) / 2;
	const longitude = (bbox.west + bbox.east) / 2;
	return [
		{ south: bbox.south, west: bbox.west, north: latitude, east: longitude },
		{ south: bbox.south, west: longitude, north: latitude, east: bbox.east },
		{ south: latitude, west: bbox.west, north: bbox.north, east: longitude },
		{ south: latitude, west: longitude, north: bbox.north, east: bbox.east },
	];
}

export type OsmAcquisitionClientPolicy = {
	concurrency?: number;
	maxEntries?: number;
	maxBytes?: number;
	ttlMs?: number;
	timeoutMs?: number;
	clock?: () => number;
};

/** A client owns its transport, cache and queue. No persistent browser storage. */
export function createOsmAcquisitionClient(
	transportOptions: Omit<OsmAcquisitionOptions, "signal"> = {},
	policy: OsmAcquisitionClientPolicy = {},
) {
	const concurrency = policy.concurrency ?? 2;
	const maxEntries = policy.maxEntries ?? 16;
	const maxBytes = policy.maxBytes ?? 8 * 1024 * 1024;
	const ttlMs = policy.ttlMs ?? 60_000;
	const timeoutMs = policy.timeoutMs ?? 120_000;
	for (const value of [concurrency, maxEntries, maxBytes, ttlMs, timeoutMs]) {
		if (!Number.isSafeInteger(value) || value < 1)
			throw Error("Invalid OSM client policy");
	}
	const clock = policy.clock ?? Date.now;
	const cache = new Map<
		string,
		{ value: OsmAcquisition; expires: number; bytes: number }
	>();
	type Work = {
		controller: AbortController;
		consumers: number;
		promise: Promise<OsmAcquisition>;
	};
	const pending = new Map<string, Work>();
	const queue: Array<() => void> = [];
	let active = 0,
		bytes = 0,
		cooldownUntil = 0;
	const pump = () => {
		while (active < concurrency && queue.length) queue.shift()!();
	};
	const removeCache = (key: string) => {
		const entry = cache.get(key);
		if (entry) bytes -= entry.bytes;
		cache.delete(key);
	};
	return {
		clearCache() {
			cache.clear();
			bytes = 0;
		},
		async acquire(
			input: GeoBoundingBox,
			options: { signal?: AbortSignal } = {},
		): Promise<OsmAcquisition> {
			options.signal?.throwIfAborted();
			const bbox = Bbox.parse(input);
			const spec = (transportOptions.request ?? getStreetRequest)(
				bbox,
				buildOverpassQuery(bbox),
			);
			if (spec.init?.body != null && typeof spec.init.body !== "string")
				throw Error("OSM coordinated requests require a string body");
			const key = JSON.stringify([
				bbox,
				spec.url,
				spec.init?.method ?? "GET",
				spec.init?.body ?? null,
				[...new Headers(spec.init?.headers).entries()].sort(),
				spec.init?.credentials ?? null,
				spec.init?.cache ?? null,
				spec.init?.mode ?? null,
				spec.init?.redirect ?? null,
				spec.init?.integrity ?? null,
				spec.init?.referrer ?? null,
				spec.init?.referrerPolicy ?? null,
				spec.elementMetadataRequested ?? null,
			]);
			for (const [oldKey, entry] of cache)
				if (entry.expires <= clock()) removeCache(oldKey);
			const cached = cache.get(key);
			if (cached) {
				cache.delete(key);
				cache.set(key, cached);
				return structuredClone(cached.value);
			}
			let work = pending.get(key);
			if (!work) {
				if (pending.size >= 32)
					throw new OsmAcquisitionError(
						"rate-limit",
						"Street data request queue is full. Try again later.",
						bbox,
					);
				const controller = new AbortController();
				let resolve!: (value: OsmAcquisition) => void,
					reject!: (reason: unknown) => void;
				const promise = new Promise<OsmAcquisition>((yes, no) => {
					resolve = yes;
					reject = no;
				});
				work = { controller, consumers: 0, promise };
				pending.set(key, work);
				const start = () => {
					if (controller.signal.aborted) {
						reject(controller.signal.reason);
						return;
					}
					if (clock() < cooldownUntil) {
						reject(
							new OsmAcquisitionError(
								"rate-limit",
								"Street data service cooldown is active. Try again later.",
								bbox,
								429,
							),
						);
						return;
					}
					active++;
					let freshness = ["no-store", "no-cache", "reload"].includes(
						spec.init?.cache ?? "",
					)
						? 0
						: ttlMs;
					const cacheStartedAt = clock();
					const timeout = setTimeout(
						() =>
							controller.abort(
								new OsmAcquisitionError(
									"timeout",
									"Street data acquisition timed out.",
									bbox,
								),
							),
						timeoutMs,
					);
					const aborted = new Promise<never>((_, no) =>
						controller.signal.addEventListener(
							"abort",
							() => no(controller.signal.reason),
							{ once: true },
						),
					);
					const operation = acquireUncoordinatedOsmData(bbox, {
						...transportOptions,
						signal: controller.signal,
						onResponse(response) {
							const control = response.headers.get("cache-control") ?? "";
							if (/no-store|no-cache/i.test(control)) freshness = 0;
							const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(control);
							if (maxAge)
								freshness = Math.min(
									freshness,
									Math.max(
										0,
										Number(maxAge[1]) * 1000 -
											Number(response.headers.get("age") ?? 0) * 1000,
									),
								);
							if (response.status === 429) {
								const retry = response.headers.get("retry-after");
								const delay =
									retry && /^\d+$/.test(retry)
										? Number(retry) * 1000
										: retry
											? Date.parse(retry) - clock()
											: 60_000;
								cooldownUntil = Math.max(
									cooldownUntil,
									clock() +
										(Number.isFinite(delay) ? Math.max(1000, delay) : 60_000),
								);
							}
						},
					});
					Promise.race([operation, aborted])
						.then((value) => {
							const size = new TextEncoder().encode(
								JSON.stringify(value),
							).byteLength;
							if (
								freshness > 0 &&
								size <= maxBytes &&
								!controller.signal.aborted
							) {
								while (cache.size >= maxEntries || bytes + size > maxBytes)
									removeCache(cache.keys().next().value!);
								cache.set(key, {
									value,
									expires: cacheStartedAt + freshness,
									bytes: size,
								});
								bytes += size;
							}
							resolve(value);
						})
						.catch(reject)
						.finally(() => {
							clearTimeout(timeout);
							active--;
							pump();
						});
				};
				queue.push(start);
				const cancelQueued = () => {
					const index = queue.indexOf(start);
					if (index !== -1) {
						queue.splice(index, 1);
						reject(controller.signal.reason);
					}
				};
				controller.signal.addEventListener("abort", cancelQueued, {
					once: true,
				});
				void promise
					.finally(() => {
						controller.signal.removeEventListener("abort", cancelQueued);
						if (pending.get(key)?.promise === promise) pending.delete(key);
					})
					.catch(() => {});
				pump();
			}
			const current = work;
			current.consumers++;
			return new Promise<OsmAcquisition>((resolve, reject) => {
				let settled = false;
				const finish = (error: unknown, value?: OsmAcquisition) => {
					if (settled) return;
					settled = true;
					options.signal?.removeEventListener("abort", abort);
					current.consumers--;
					if (current.consumers === 0) {
						if (pending.get(key) === current) pending.delete(key);
						current.controller.abort();
					}
					if (value) resolve(structuredClone(value));
					else reject(error);
				};
				const abort = () => finish(options.signal!.reason);
				options.signal?.addEventListener("abort", abort, { once: true });
				current.promise.then(
					(value) => finish(undefined, value),
					(error) => finish(error),
				);
				if (options.signal?.aborted) abort();
			});
		},
	};
}
let defaultTransport: typeof globalThis.fetch | undefined;
let defaultClient: ReturnType<typeof createOsmAcquisitionClient> | undefined;
export function acquireOsmData(
	input: GeoBoundingBox,
	options: OsmAcquisitionOptions = {},
) {
	if (options.fetch || options.request || options.now) {
		return createOsmAcquisitionClient(options).acquire(input, options);
	}
	if (!defaultClient || defaultTransport !== globalThis.fetch) {
		defaultTransport = globalThis.fetch;
		defaultClient = createOsmAcquisitionClient({ fetch: defaultTransport });
	}
	return defaultClient.acquire(input, options);
}
