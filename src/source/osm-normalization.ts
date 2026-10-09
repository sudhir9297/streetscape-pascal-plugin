import { decodeStoredReport } from "../report-storage";
import { z } from "zod";
import { parseOsmAcquisition, type OsmAcquisition } from "./osm-acquisition";

export const OSM_NORMALIZATION_POLICY = Object.freeze({
	id: "osm-source-normalization",
	version: 1 as const,
});
const CLASS = {
	motorway: ["highway", "highway"],
	motorway_link: ["highway", "highway"],
	trunk: ["highway", "highway"],
	trunk_link: ["highway", "highway"],
	primary: ["arterial", "arterial"],
	primary_link: ["arterial", "arterial"],
	secondary: ["arterial", "arterial"],
	secondary_link: ["arterial", "arterial"],
	tertiary: ["collector", "collector"],
	tertiary_link: ["collector", "collector"],
	unclassified: ["local", "local-street"],
	residential: ["local", "local-street"],
	living_street: ["local", "local-street"],
	service: ["service", "alley"],
} as const;
const Diagnostic = z.strictObject({
	code: z.enum([
		"invalid-number",
		"invalid-unit",
		"unsupported-value",
		"unsupported-feature",
		"geometry-incomplete",
		"geometry-invalid",
		"degenerate-geometry",
		"conflicting-tags",
		"source-conflict",
	]),
	severity: z.enum(["warning", "error"]),
	featureId: z.string(),
	field: z.string(),
	raw: z.json().nullable(),
	message: z.string(),
});
export type OsmNormalizationDiagnostic = z.infer<typeof Diagnostic>;
const RoadTags = z.strictObject({
	highway: z.string().nullable(),
	roadClass: z
		.enum(["highway", "arterial", "collector", "local", "service"])
		.nullable(),
	styleId: z.string().nullable(),
	direction: z.enum(["forward", "reverse", "both"]).nullable(),
	directionOrigin: z.enum(["source", "inferred", "unknown"]),
	layer: z.number().int().nullable(),
	bridge: z.boolean().nullable(),
	tunnel: z.boolean().nullable(),
	elevationMeters: z.number().nullable(),
	dimensions: z.record(z.string(), z.number().nullable()),
	laneCounts: z.record(z.string(), z.number().int().nonnegative().nullable()),
	laneWidths: z.record(z.string(), z.array(z.number()).nullable()),
});
export type NormalizedOsmRoadTags = z.infer<typeof RoadTags>;
const Point = z.strictObject({
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
	nodeId: z.number().int().positive().optional(),
});
const Geometry = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("point"), point: Point }),
	z.strictObject({
		kind: z.literal("way"),
		points: z.array(Point.extend({ nodeId: z.number().int().positive() })),
		closed: z.boolean(),
	}),
	z.strictObject({
		kind: z.literal("relation"),
		members: z.array(
			z.strictObject({
				type: z.enum(["node", "way", "relation"]),
				ref: z.number().int().positive(),
				role: z.string(),
				geometry: z.array(Point).nullable(),
			}),
		),
	}),
]);
export const NormalizedOsmSource = z
	.strictObject({
		format: z.literal("normalized-osm-source"),
		schemaVersion: z.literal(1),
		policy: z.strictObject({
			id: z.literal("osm-source-normalization"),
			version: z.literal(1),
		}),
		inputKind: z.enum(["acquisition", "interpreted-roads"]),
		sourceContentIdentity: z
			.string()
			.regex(/^sha256:[a-f0-9]{64}$/)
			.nullable(),
		features: z.array(
			z.strictObject({
				featureId: z.string(),
				sourceType: z.enum(["node", "way", "relation"]),
				id: z.number().int().positive(),
				kind: z.enum([
					"road",
					"mapped-surface",
					"point-asset",
					"crossing",
					"connectivity",
					"restriction",
					"support",
					"unsupported",
				]),
				disposition: z.enum(["accepted", "rejected"]),
				raw: z.record(z.string(), z.json()),
				variants: z.array(z.record(z.string(), z.json())).min(1),
				road: RoadTags.nullable(),
				measurements: RoadTags.pick({
					dimensions: true,
					laneCounts: true,
					laneWidths: true,
					elevationMeters: true,
				}).extend({ bearingDegrees: z.number().nullable() }),
				geometry: Geometry.nullable(),
				diagnostics: z.array(Diagnostic),
			}),
		),
	})
	.superRefine((report, ctx) => {
		const ids = new Set<string>();
		for (const feature of report.features) {
			if (ids.has(feature.featureId))
				ctx.addIssue({
					code: "custom",
					message: "Duplicate normalized feature identity",
				});
			ids.add(feature.featureId);
			if (
				feature.featureId !== `osm~${feature.sourceType}~${feature.id}` ||
				feature.raw.type !== feature.sourceType ||
				feature.raw.id !== feature.id
			)
				ctx.addIssue({
					code: "custom",
					message: "Normalized identity does not match the retained source",
				});
			if (
				feature.diagnostics.some((item) => item.featureId !== feature.featureId)
			)
				ctx.addIssue({
					code: "custom",
					message: "Diagnostic references a different source feature",
				});
			if (
				feature.disposition === "accepted" &&
				(feature.geometry === null ||
					feature.diagnostics.some((item) => item.severity === "error"))
			)
				ctx.addIssue({
					code: "custom",
					message: "Accepted source feature has unresolved geometry errors",
				});
			if (
				feature.kind === "road" &&
				feature.disposition === "accepted" &&
				(feature.geometry?.kind !== "way" || feature.road?.roadClass == null)
			)
				ctx.addIssue({
					code: "custom",
					message:
						"Accepted road needs complete geometry and a supported class",
				});
		}
	});
export type NormalizedOsmSource = z.infer<typeof NormalizedOsmSource>;
export type NormalizedOsmFeature = NormalizedOsmSource["features"][number];

/** Pure source units. Positive lengths; optional signed values for elevations. */
export function parseOsmLength(
	raw: string | undefined,
	allowSigned = false,
): number | null {
	const match = raw
		?.trim()
		.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(m|ft|')?$/);
	if (!match) return null;
	const value =
		Number(match[1]) * (match[2] === "ft" || match[2] === "'" ? 0.3048 : 1);
	return Number.isFinite(value) && (allowSigned || value > 0) ? value : null;
}
export function parseOsmLaneCount(
	raw: string | undefined,
	allowZero = false,
): number | null {
	if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
	const value = Number(raw.trim());
	return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1)
		? value
		: null;
}
export function parseOsmLengthList(raw: string | undefined): number[] | null {
	if (raw === undefined) return null;
	const values = raw.split("|").map((value) => parseOsmLength(value));
	return values.every((value): value is number => value !== null)
		? values
		: null;
}
const BEARINGS: Record<string, number> = {
	n: 0,
	north: 0,
	ne: 45,
	northeast: 45,
	e: 90,
	east: 90,
	se: 135,
	southeast: 135,
	s: 180,
	south: 180,
	sw: 225,
	southwest: 225,
	w: 270,
	west: 270,
	nw: 315,
	northwest: 315,
};
export function parseOsmBearing(raw: string | undefined): number | null {
	if (raw === undefined) return null;
	const text = raw.trim().toLowerCase();
	if (BEARINGS[text] !== undefined) return BEARINGS[text]!;
	if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)°?$/.test(text)) return null;
	const value = Number(text.replace(/°$/, ""));
	return Number.isFinite(value) ? ((value % 360) + 360) % 360 : null;
}
const layerValue = (raw: string | undefined) =>
	raw !== undefined &&
	/^[-+]?\d+$/.test(raw.trim()) &&
	Number.isSafeInteger(Number(raw))
		? Number(raw)
		: null;

export function normalizeOsmRoadTags(
	tags: Readonly<Record<string, string>>,
	featureId = "unidentified-road",
): { road: NormalizedOsmRoadTags; diagnostics: OsmNormalizationDiagnostic[] } {
	const diagnostics: OsmNormalizationDiagnostic[] = [];
	const warn = (
		code: OsmNormalizationDiagnostic["code"],
		field: string,
		message: string,
	) =>
		diagnostics.push({
			code,
			severity: "warning",
			featureId,
			field,
			raw: tags[field] ?? null,
			message,
		});
	const highway = tags.highway ?? null,
		entry = highway === null ? undefined : CLASS[highway as keyof typeof CLASS];
	const one = tags.oneway?.trim().toLowerCase();
	let direction: NormalizedOsmRoadTags["direction"] = null,
		directionOrigin: NormalizedOsmRoadTags["directionOrigin"] = "unknown";
	if (one !== undefined) {
		if (["yes", "true", "1"].includes(one)) direction = "forward";
		else if (["no", "false", "0"].includes(one)) direction = "both";
		else if (["-1", "reverse"].includes(one)) direction = "reverse";
		else
			warn(
				"unsupported-value",
				"oneway",
				"Unsupported oneway value; direction remains unknown.",
			);
		if (direction !== null) directionOrigin = "source";
	} else {
		direction =
			tags.junction === "roundabout" || highway === "motorway"
				? "forward"
				: "both";
		directionOrigin = "inferred";
	}
	const layer = layerValue(tags.layer);
	if (tags.layer !== undefined && layer === null)
		warn(
			"invalid-number",
			"layer",
			"Layer must be an integer ordering value; it is not an elevation.",
		);
	const structure = (key: "bridge" | "tunnel") => {
		const value = tags[key]?.trim().toLowerCase();
		if (value === undefined) return null;
		if (["no", "false", "0"].includes(value)) return false;
		const types =
			key === "bridge"
				? [
						"viaduct",
						"movable",
						"aqueduct",
						"trestle",
						"boardwalk",
						"cantilever",
						"covered",
						"suspension",
					]
				: ["building_passage", "culvert", "avalanche_protector"];
		if (["yes", "true", "1", ...types].includes(value)) return true;
		warn(
			"unsupported-value",
			key,
			`Unsupported ${key} value; structural status remains unknown.`,
		);
		return null;
	};
	const bridge = structure("bridge"),
		tunnel = structure("tunnel");
	if (bridge === true && tunnel === true)
		warn(
			"conflicting-tags",
			"bridge",
			"Bridge and tunnel claims conflict; both source claims are retained.",
		);
	const dimensions: NormalizedOsmRoadTags["dimensions"] = {},
		laneCounts: NormalizedOsmRoadTags["laneCounts"] = {},
		laneWidths: NormalizedOsmRoadTags["laneWidths"] = {};
	for (const key of Object.keys(tags).sort()) {
		if (
			key === "width" ||
			key === "est_width" ||
			key === "height" ||
			key === "maxheight" ||
			/^(?:sidewalk|cycleway|parking|busway)(?::(?:left|right|both))?:width$/.test(
				key,
			)
		) {
			dimensions[key] = parseOsmLength(tags[key]);
			if (dimensions[key] === null)
				warn(
					"invalid-unit",
					key,
					"Expected a positive length in metres or feet; source value remains unapplied.",
				);
		}
		if (/^lanes(?::(?:forward|backward|both_ways))?$/.test(key)) {
			laneCounts[key] = parseOsmLaneCount(tags[key], key !== "lanes");
			if (laneCounts[key] === null)
				warn("invalid-number", key, "Expected an integer lane count.");
			else if (laneCounts[key]! > 12)
				warn(
					"unsupported-value",
					key,
					"Lane count exceeds the current projection capability of 12; source count is retained.",
				);
		}
		if (/^width:lanes(?::(?:forward|backward|both_ways))?$/.test(key)) {
			laneWidths[key] = parseOsmLengthList(tags[key]);
			if (laneWidths[key] === null)
				warn(
					"invalid-unit",
					key,
					"Expected a pipe-separated list of positive lengths.",
				);
			else if (laneWidths[key]!.some((width) => width < 2.4 || width > 5))
				warn(
					"unsupported-value",
					key,
					"Lane widths exceed current projection limits; parsed lengths are retained.",
				);
		}
	}
	const elevationMeters = parseOsmLength(tags.ele, true);
	if (tags.ele !== undefined && elevationMeters === null)
		warn(
			"invalid-unit",
			"ele",
			"Expected a signed elevation in metres or feet; vertical reference still needs separate evidence.",
		);
	for (const [key, allowed] of Object.entries({
		sidewalk: ["yes", "no", "both", "left", "right", "separate", "none"],
		cycleway: [
			"lane",
			"opposite_lane",
			"track",
			"opposite_track",
			"shared_lane",
			"share_busway",
			"no",
			"separate",
			"shared",
			"yes",
			"none",
		],
		busway: ["lane", "opposite_lane", "shared_lane", "no", "separate"],
	})) {
		for (const field of [key, `${key}:left`, `${key}:right`, `${key}:both`])
			if (tags[field] !== undefined && !allowed.includes(tags[field]!))
				warn(
					"unsupported-value",
					field,
					"Unsupported roadside inventory value; the source claim remains available for resolution.",
				);
	}
	const total = laneCounts.lanes,
		forward = laneCounts["lanes:forward"],
		backward = laneCounts["lanes:backward"],
		both = laneCounts["lanes:both_ways"] ?? 0;
	if (
		total != null &&
		forward != null &&
		backward != null &&
		total !== forward + backward + both
	)
		warn(
			"conflicting-tags",
			"lanes",
			"Total and directional lane counts disagree.",
		);
	for (const key of Object.keys(laneWidths)) {
		const countKey = key.replace("width:", ""),
			count = laneCounts[countKey];
		if (
			count != null &&
			laneWidths[key] !== null &&
			laneWidths[key]!.length !== count
		)
			warn(
				"conflicting-tags",
				key,
				"Per-lane width list length disagrees with the lane count.",
			);
	}
	if (entry === undefined)
		warn(
			"unsupported-feature",
			"highway",
			"Road class is not supported by the current road importer.",
		);
	return {
		road: {
			highway,
			roadClass: entry?.[0] ?? null,
			styleId: entry?.[1] ?? null,
			direction,
			directionOrigin,
			layer,
			bridge,
			tunnel,
			elevationMeters,
			dimensions,
			laneCounts,
			laneWidths,
		},
		diagnostics,
	};
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
	if (value && typeof value === "object")
		return (
			"{" +
			Object.keys(value)
				.sort()
				.map(
					(key) =>
						JSON.stringify(key) +
						":" +
						canonical((value as Record<string, unknown>)[key]),
				)
				.join(",") +
			"}"
		);
	return JSON.stringify(value);
}
function classify(
	type: string,
	tags: Record<string, string>,
): NormalizedOsmFeature["kind"] {
	if (type === "way") {
		if (
			tags["area:highway"] ||
			tags.barrier === "kerb" ||
			tags.highway === "cycleway" ||
			tags.highway === "pedestrian" ||
			(tags.highway === "footway" &&
				["sidewalk", "crossing"].includes(tags.footway ?? "")) ||
			(["footway", "path"].includes(tags.highway ?? "") &&
				tags.sidewalk !== undefined)
		)
			return "mapped-surface";
		if (
			tags.highway &&
			tags.area !== "yes" &&
			CLASS[tags.highway as keyof typeof CLASS]
		)
			return "road";
	} else if (type === "node") {
		if (
			tags.highway === "crossing" ||
			tags.crossing !== undefined ||
			(tags.barrier === "kerb" &&
				["lowered", "flush", "no"].includes(tags.kerb ?? ""))
		)
			return "crossing";
		if (
			["street_lamp", "traffic_signals", "stop", "give_way"].includes(
				tags.highway ?? "",
			) ||
			tags.traffic_sign
		)
			return "point-asset";
		if (!Object.keys(tags).length) return "support";
	} else if (type === "relation") {
		if (tags.type === "connectivity") return "connectivity";
		if (tags.type?.startsWith("restriction")) return "restriction";
		if (tags["area:highway"]) return "mapped-surface";
	}
	return "unsupported";
}
function rankedSourceVariants(
	candidates: Record<string, z.infer<ReturnType<typeof z.json>>>[],
) {
	const unique = new Map(candidates.map((raw) => [canonical(raw), raw]));
	const version = (raw: Record<string, unknown>) =>
		typeof raw.version === "number" &&
		Number.isSafeInteger(raw.version) &&
		raw.version > 0
			? raw.version
			: 0;
	return [...unique.values()].sort(
		(a, b) =>
			version(b) - version(a) ||
			(canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0),
	);
}
function normalizeElements(
	elements: Record<string, z.infer<ReturnType<typeof z.json>>>[],
	inputKind: NormalizedOsmSource["inputKind"],
): NormalizedOsmSource {
	const groups = new Map<string, typeof elements>();
	for (const raw of elements) {
		const key = `${String(raw.type)}~${String(raw.id)}`;
		groups.set(key, [...(groups.get(key) ?? []), raw]);
	}
	const selected = new Map(
		[...groups].map(([key, list]) => [key, rankedSourceVariants(list)[0]!]),
	);
	const wayGeometry = (way: Record<string, unknown>) =>
		way.geometry !== undefined
			? way.geometry
			: Array.isArray(way.nodes)
				? way.nodes.map((id) => {
						const node = selected.get(`node~${id}`);
						return node &&
							typeof node.lat === "number" &&
							typeof node.lon === "number"
							? { lat: node.lat, lon: node.lon }
							: null;
					})
				: undefined;
	const features: NormalizedOsmFeature[] = [];
	for (const [key, candidates] of [...groups].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)) {
		const variants = rankedSourceVariants(candidates);
		const raw = JSON.parse(canonical(variants[0]!)),
			type = raw.type as "node" | "way" | "relation",
			id = raw.id as number,
			featureId = `osm~${key}`,
			tags = (raw.tags ?? {}) as Record<string, string>;
		const kind = classify(type, tags),
			diagnostics: OsmNormalizationDiagnostic[] = [];
		const issue = (
			code: OsmNormalizationDiagnostic["code"],
			severity: "warning" | "error",
			field: string,
			message: string,
		) =>
			diagnostics.push({
				code,
				severity,
				featureId,
				field,
				raw: raw[field] ?? null,
				message,
			});
		if (
			raw.version !== undefined &&
			!(
				typeof raw.version === "number" &&
				Number.isSafeInteger(raw.version) &&
				raw.version > 0
			)
		)
			issue(
				"invalid-number",
				"warning",
				"version",
				"Source version is not a positive integer; it is not used to rank variants.",
			);
		if (variants.length > 1)
			issue(
				"source-conflict",
				"warning",
				"version",
				"Different source variants are retained; the highest version and then canonical JSON select one deterministically.",
			);
		if (kind === "unsupported")
			issue(
				"unsupported-feature",
				"warning",
				"tags",
				"Source feature has no supported importer representation and remains inspectable.",
			);
		const values = normalizeOsmRoadTags(tags, featureId);
		const normalized =
			kind === "road" || (type === "way" && kind === "unsupported")
				? values
				: null;
		diagnostics.push(
			...values.diagnostics.filter(
				(diagnostic) =>
					diagnostic.code !== "unsupported-feature" || kind === "road",
			),
		);
		if (
			kind === "point-asset" &&
			tags.highway === "street_lamp" &&
			values.road.dimensions.height != null &&
			(values.road.dimensions.height < 2.5 ||
				values.road.dimensions.height > 30)
		)
			diagnostics.push({
				code: "unsupported-value",
				severity: "warning",
				featureId,
				field: "height",
				raw: tags.height!,
				message:
					"Lamp height exceeds the current projection range of 2.5–30 metres; the source height is retained.",
			});
		const bearingKey =
			tags["traffic_signals:direction"] !== undefined
				? "traffic_signals:direction"
				: "direction";
		const bearingDegrees = parseOsmBearing(tags[bearingKey]);
		if (
			type === "node" &&
			tags[bearingKey] !== undefined &&
			bearingDegrees === null
		)
			diagnostics.push({
				code: "unsupported-value",
				severity: "warning",
				featureId,
				field: bearingKey,
				raw: tags[bearingKey]!,
				message:
					"Direction is not an absolute bearing; the original value remains available for association.",
			});

		let geometry: NormalizedOsmFeature["geometry"] = null;
		if (type === "node") {
			const point = Point.safeParse({ lat: raw.lat, lon: raw.lon });
			if (point.success) geometry = { kind: "point", point: point.data };
			else
				issue(
					"geometry-incomplete",
					"error",
					"lat",
					"Node coordinates are missing or invalid.",
				);
		} else if (type === "way") {
			const nodes = raw.nodes as number[] | undefined,
				points = wayGeometry(raw) as
					| Array<{ lat: number; lon: number } | null>
					| undefined;
			if (
				!nodes ||
				!points ||
				nodes.length !== points.length ||
				points.some((point) => point === null)
			)
				issue(
					"geometry-incomplete",
					"error",
					"geometry",
					"Way geometry is incomplete; missing points are never joined across a gap.",
				);
			else {
				const parsed = z
					.array(Point.extend({ nodeId: z.number().int().positive() }))
					.safeParse(
						points.map((point, index) => ({ ...point, nodeId: nodes[index] })),
					);
				if (!parsed.success || parsed.data.length < 2)
					issue(
						"geometry-invalid",
						"error",
						"geometry",
						"Way needs at least two valid coordinates and node identities.",
					);
				else if (
					parsed.data.every(
						(point) =>
							point.lat === parsed.data[0]!.lat &&
							point.lon === parsed.data[0]!.lon,
					)
				)
					issue(
						"degenerate-geometry",
						"error",
						"geometry",
						"Way has no nonzero geometric span.",
					);
				else {
					if (
						(tags["area:highway"] ||
							tags.area === "yes" ||
							tags.highway === "pedestrian") &&
						(nodes[0] !== nodes.at(-1) || parsed.data.length < 4)
					)
						issue(
							"geometry-invalid",
							"error",
							"geometry",
							"Mapped polygon needs a closed ring with at least four points.",
						);
					if (
						nodes[0] === nodes.at(-1) &&
						(parsed.data[0]!.lat !== parsed.data.at(-1)!.lat ||
							parsed.data[0]!.lon !== parsed.data.at(-1)!.lon)
					)
						issue(
							"geometry-invalid",
							"error",
							"geometry",
							"A repeated node identity has conflicting endpoint coordinates.",
						);
					if (
						parsed.data.some(
							(point, index) =>
								index > 0 &&
								Math.abs(point.lon - parsed.data[index - 1]!.lon) > 180,
						)
					)
						issue(
							"geometry-invalid",
							"error",
							"geometry",
							"Way crosses the antimeridian; the current local projection cannot normalize this span safely.",
						);
					geometry = {
						kind: "way",
						points: parsed.data,
						closed: nodes[0] === nodes.at(-1),
					};
					if (
						parsed.data.some(
							(point, index) =>
								index > 0 &&
								point.lat === parsed.data[index - 1]!.lat &&
								point.lon === parsed.data[index - 1]!.lon,
						)
					)
						issue(
							"degenerate-geometry",
							"warning",
							"geometry",
							"Consecutive coincident points are retained for topology resolution.",
						);
				}
			}
		} else {
			const members = (
				Array.isArray(raw.members)
					? raw.members.map((m: Record<string, unknown>) => ({
							...m,
							geometry:
								m.geometry !== undefined
									? m.geometry
									: m.type === "way" && selected.has(`way~${m.ref}`)
										? wayGeometry(selected.get(`way~${m.ref}`)!)
										: undefined,
						}))
					: raw.members
			) as
				| Array<{
						type: "node" | "way" | "relation";
						ref?: number;
						role?: string;
						geometry?: Array<{ lat: number; lon: number } | null>;
				  }>
				| undefined;
			if (!members?.length || members.some((member) => !member.ref))
				issue(
					"geometry-incomplete",
					"error",
					"members",
					"Relation member identities are incomplete.",
				);
			else if (
				kind === "mapped-surface" &&
				members.some(
					(member) =>
						member.type !== "way" ||
						!member.geometry ||
						member.geometry.length < 2 ||
						member.geometry.some((point) => point === null) ||
						!["", "outer", "inner"].includes(member.role ?? ""),
				)
			)
				issue(
					"geometry-incomplete",
					"error",
					"members",
					"Surface relation has incomplete or unsupported members; missing member geometry is not bridged.",
				);
			else {
				if (kind === "mapped-surface") {
					const ends = new Map<string, number>();
					for (const member of members) {
						const coords = member.geometry!;
						for (const point of [coords[0]!, coords.at(-1)!]) {
							const key = `${member.role === "inner" ? "inner" : "outer"}~${point!.lat.toFixed(8)}~${point!.lon.toFixed(8)}`;
							ends.set(key, (ends.get(key) ?? 0) + 1);
						}
					}
					if ([...ends.values()].some((count) => count % 2 !== 0))
						issue(
							"geometry-incomplete",
							"error",
							"members",
							"Surface member chains do not close into rings.",
						);
				}
				if (
					kind === "connectivity" &&
					(!members.some(
						(member) => member.role === "from" && member.type === "way",
					) ||
						!members.some(
							(member) => member.role === "to" && member.type === "way",
						))
				)
					issue(
						"geometry-incomplete",
						"error",
						"members",
						"Connectivity relation needs from and to way references.",
					);
				geometry = {
					kind: "relation",
					members: members.map((member) => ({
						type: member.type,
						ref: member.ref!,
						role: member.role ?? "",
						geometry: member.geometry?.every((point) => point !== null)
							? member.geometry.map((point) => ({
									lat: point!.lat,
									lon: point!.lon,
								}))
							: null,
					})),
				};
			}
		}
		features.push({
			featureId,
			sourceType: type,
			id,
			kind,
			disposition:
				kind === "unsupported" ||
				diagnostics.some((issue) => issue.severity === "error")
					? "rejected"
					: "accepted",
			raw,
			variants: variants.map((value) => JSON.parse(canonical(value))),
			road: normalized?.road ?? null,
			measurements: {
				dimensions: values.road.dimensions,
				laneCounts: values.road.laneCounts,
				laneWidths: values.road.laneWidths,
				elevationMeters: values.road.elevationMeters,
				bearingDegrees,
			},
			geometry,
			diagnostics,
		});
	}
	return NormalizedOsmSource.parse({
		format: "normalized-osm-source",
		schemaVersion: 1,
		policy: OSM_NORMALIZATION_POLICY,
		inputKind,
		sourceContentIdentity: null,
		features,
	});
}
export function normalizeOsmAcquisition(
	input: OsmAcquisition,
): NormalizedOsmSource {
	const acquisition = parseOsmAcquisition(input);
	return normalizeElements(
		acquisition.responses.flatMap(
			(response) =>
				response.payload.elements as Record<
					string,
					z.infer<ReturnType<typeof z.json>>
				>[],
		),
		"acquisition",
	);
}
/** Compatibility input contains interpreted roads, not original provider responses. */
export function normalizeOsmWays(
	ways: Array<{
		id: number;
		tags: Record<string, string>;
		points: Array<{ lat: number; lon: number; nodeId: number }>;
	}>,
): NormalizedOsmSource {
	return normalizeElements(
		ways.map((way) => ({
			type: "way",
			id: way.id,
			tags: structuredClone(way.tags),
			nodes: way.points.map((point) => point.nodeId),
			geometry: way.points.map((point) => ({ lat: point.lat, lon: point.lon })),
		})),
		"interpreted-roads",
	);
}
export function parseNormalizedOsmSource(input: unknown): NormalizedOsmSource {
	input = decodeStoredReport(input);
	if (
		input &&
		typeof input === "object" &&
		"schemaVersion" in input &&
		input.schemaVersion !== 1
	)
		throw Error(
			`Unsupported OSM normalization version: ${String(input.schemaVersion)}`,
		);
	return NormalizedOsmSource.parse(input);
}
export class OsmNormalizationError extends Error {
	constructor(
		message: string,
		readonly normalization: NormalizedOsmSource,
	) {
		super(message);
		this.name = "OsmNormalizationError";
	}
}
