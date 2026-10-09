import { z } from "zod";
import { parseOsmAcquisition, type OsmAcquisition } from "./osm-acquisition";

export const OSM_SOURCE_SNAPSHOT_FORMAT = "osm-source-snapshot-v1";
const Count = z.number().int().nonnegative();
const Coverage = z.strictObject({
	total: Count,
	complete: Count,
	status: z.enum(["complete", "partial", "unavailable"]),
});
const Completeness = z.strictObject({
	capture: Coverage,
	elementMetadata: Coverage.extend({
		missingFields: z.record(z.string(), Count),
	}),
	geometry: Coverage,
});
const SnapshotEnvelope = z.strictObject({
	format: z.literal(OSM_SOURCE_SNAPSHOT_FORMAT),
	schemaVersion: z.literal(1),
	provider: z.literal("openstreetmap"),
	acquiredAt: z.iso.datetime({ offset: true }).nullable(),
	contentIdentity: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	integrityIdentity: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	acquisition: z.unknown(),
	completeness: Completeness,
});
type SnapshotData = Omit<z.infer<typeof SnapshotEnvelope>, "acquisition"> & {
	acquisition: OsmAcquisition;
};
export type Immutable<T> = T extends (infer V)[]
	? readonly Immutable<V>[]
	: T extends object
		? { readonly [K in keyof T]: Immutable<T[K]> }
		: T;
export type OsmSourceSnapshot = Immutable<SnapshotData>;

/** Canonical JSON keeps array/source order, sorting only object keys. */
export function canonicalSourceJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map(canonicalSourceJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${canonicalSourceJson((value as Record<string, unknown>)[key])}`,
		)
		.join(",")}}`;
}
async function hash(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalSourceJson(value));
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function freeze<T>(value: T): Immutable<T> {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value as Immutable<T>;
}
function coverage(total: number, complete: number) {
	return {
		total,
		complete,
		status:
			complete === total && total > 0
				? ("complete" as const)
				: complete === 0
					? ("unavailable" as const)
					: ("partial" as const),
	};
}
function completeness(acquisition: OsmAcquisition) {
	const elements = acquisition.responses.flatMap(
		(response) => response.payload.elements as Array<Record<string, unknown>>,
	);
	const fields = ["version", "timestamp", "changeset", "uid", "user"] as const;
	const missingFields = Object.fromEntries(
		fields.map((field) => [field, 0]),
	) as Record<(typeof fields)[number], number>;
	let metadataComplete = 0,
		geometryComplete = 0;
	for (const element of elements) {
		const present = fields.map((field) =>
			field === "timestamp"
				? z.iso.datetime({ offset: true }).safeParse(element[field]).success
				: field === "user"
					? typeof element[field] === "string"
					: typeof element[field] === "number" &&
						Number.isSafeInteger(element[field]) &&
						(element[field] as number) >= (field === "uid" ? 0 : 1),
		);
		fields.forEach((field, index) => {
			if (!present[index]) missingFields[field]++;
		});
		if (present.every(Boolean)) metadataComplete++;
		if (
			element.type === "node" &&
			typeof element.lat === "number" &&
			typeof element.lon === "number"
		)
			geometryComplete++;
		if (
			element.type === "way" &&
			Array.isArray(element.nodes) &&
			Array.isArray(element.geometry) &&
			element.nodes.length >= 2 &&
			element.nodes.length === element.geometry.length &&
			element.geometry.every((point) => point !== null)
		)
			geometryComplete++;
		if (
			element.type === "relation" &&
			Array.isArray(element.members) &&
			element.members.length > 0 &&
			element.members.every((member) => {
				const data = member as Record<string, unknown>;
				return data.type === "way"
					? Array.isArray(data.geometry) &&
							data.geometry.length >= 2 &&
							data.geometry.every((point) => point !== null)
					: data.type === "node"
						? typeof data.lat === "number" && typeof data.lon === "number"
						: false;
			})
		)
			geometryComplete++;
	}
	return {
		capture: coverage(
			acquisition.responses.length,
			acquisition.responses.filter((response) => response.capture).length,
		),
		elementMetadata: {
			...coverage(elements.length, metadataComplete),
			missingFields,
		},
		geometry: coverage(elements.length, geometryComplete),
	};
}
function content(acquisition: OsmAcquisition) {
	return {
		provider: "openstreetmap",
		bbox: acquisition.bbox,
		responses: acquisition.responses.map(({ bbox, payload }) => ({
			bbox,
			payload,
		})),
	};
}
function acquiredAt(acquisition: OsmAcquisition) {
	return (
		acquisition.responses
			.flatMap((response) =>
				response.capture ? [response.capture.acquiredAt] : [],
			)
			.sort((a, b) => Date.parse(a) - Date.parse(b))
			.at(-1) ?? null
	);
}
export async function createOsmSourceSnapshot(
	input: OsmAcquisition,
): Promise<OsmSourceSnapshot> {
	const acquisition = parseOsmAcquisition(input);
	const data: Omit<SnapshotData, "integrityIdentity"> = {
		format: OSM_SOURCE_SNAPSHOT_FORMAT,
		schemaVersion: 1 as const,
		provider: "openstreetmap" as const,
		acquiredAt: acquiredAt(acquisition),
		contentIdentity: await hash(content(acquisition)),
		acquisition,
		completeness: completeness(acquisition),
	};
	return freeze({ ...data, integrityIdentity: await hash(data) });
}
/** Recompute both identities and derived completeness before trusting saved evidence. */
export async function parseOsmSourceSnapshot(
	input: unknown,
): Promise<OsmSourceSnapshot> {
	const value = typeof input === "string" ? JSON.parse(input) : input;
	if (
		value &&
		typeof value === "object" &&
		"schemaVersion" in value &&
		value.schemaVersion !== 1
	)
		throw Error(
			`Unsupported OSM source snapshot version: ${String(value.schemaVersion)}`,
		);
	const parsed = SnapshotEnvelope.parse(value),
		acquisition = parseOsmAcquisition(parsed.acquisition);
	if (parsed.contentIdentity !== (await hash(content(acquisition))))
		throw Error("OSM source snapshot content identity mismatch");
	const { integrityIdentity, ...data } = { ...parsed, acquisition };
	if (integrityIdentity !== (await hash(data)))
		throw Error("OSM source snapshot integrity identity mismatch");
	if (
		canonicalSourceJson(parsed.completeness) !==
			canonicalSourceJson(completeness(acquisition)) ||
		parsed.acquiredAt !== acquiredAt(acquisition)
	)
		throw Error(
			"OSM source snapshot completeness or acquisition time is inconsistent",
		);
	return freeze({ ...data, integrityIdentity });
}
