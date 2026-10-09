import { z } from "zod";
import type { RoadNetworkGraph } from "../road-network-topology";
import {
	normalizeOsmRoadTags,
	parseOsmLength,
} from "../source/osm-normalization";
import { sampleRoadEdgePoints } from "../road-network-geometry";

export const StreetRegionalPolicy = z.strictObject({
	id: z.enum(["right-driving", "left-driving"]),
	version: z.literal(1),
	status: z.enum(["proposed", "confirmed"]),
	basis: z.enum(["location-evidence", "manual", "fallback"]),
	evidence: z.string().nullable(),
});
export type StreetRegionalPolicy = z.infer<typeof StreetRegionalPolicy>;
export function proposeStreetRegionalPolicy(
	tags: readonly Record<string, string>[],
): StreetRegionalPolicy {
	const sides = [
		...new Set(
			tags.flatMap((t) =>
				t.driving_side === "left" || t.driving_side === "right"
					? [t.driving_side]
					: [],
			),
		),
	];
	return {
		id:
			sides.length === 1 && sides[0] === "left"
				? "left-driving"
				: "right-driving",
		version: 1,
		status: "proposed",
		basis: sides.length === 1 ? "location-evidence" : "fallback",
		evidence:
			sides.length === 1
				? `OSM driving_side=${sides[0]}`
				: sides.length > 1
					? "Conflicting OSM driving_side claims; manual selection required"
					: null,
	};
}
export function confirmStreetRegionalPolicy(
	policy: StreetRegionalPolicy,
	id: StreetRegionalPolicy["id"],
): StreetRegionalPolicy {
	return StreetRegionalPolicy.parse({
		...policy,
		id,
		status: "confirmed",
		basis:
			id === policy.id && policy.basis === "location-evidence"
				? "location-evidence"
				: "manual",
	});
}
const Value = z.strictObject({
	value: z.json(),
	origin: z.enum(["mapped", "estimate", "derived"]),
	sourceTags: z.array(z.string()),
	reason: z.string(),
	rawClaims: z.record(z.string(), z.string()),
});
export const StreetSectionReport = z.strictObject({
	format: z.literal("street-section-report"),
	schemaVersion: z.literal(1),
	policy: StreetRegionalPolicy,
	sections: z.array(
		z.strictObject({
			id: z.string(),
			edgeId: z.string(),
			wayId: z.number().int(),
			sourceSpan: z
				.strictObject({
					start: z.number(),
					end: z.number(),
					coverage: z.enum(["exact", "conservative"]),
				})
				.nullable(),
			interval: z.strictObject({
				start: z.literal(0),
				end: z.number().positive(),
			}),
			values: z.record(z.string(), Value),
			diagnostics: z.array(z.string()),
		}),
	),
});
export type StreetSectionReport = z.infer<typeof StreetSectionReport>;

/** Whole-span section resolution. Source unknowns are separate from preview estimates. */
export function resolveInitialStreetSections(
	graphs: readonly RoadNetworkGraph[],
	policy: StreetRegionalPolicy,
): StreetSectionReport {
	const sections: StreetSectionReport["sections"] = [];
	for (const graph of graphs)
		for (const edge of Object.values(graph.edges)) {
			if (!edge.osmSource) continue;
			const tags = edge.osmSource.tags,
				style = graph.stylePresets[edge.styleId]!,
				values: StreetSectionReport["sections"][number]["values"] = {};
			const set = (
				key: string,
				value: unknown,
				origin: "mapped" | "estimate" | "derived",
				sourceTags: string[],
				reason: string,
			) => {
				values[key] = Value.parse({
					value,
					origin,
					sourceTags,
					reason,
					rawClaims: Object.fromEntries(
						sourceTags
							.filter((k) => tags[k] !== undefined)
							.map((k) => [k, tags[k]!]),
					),
				});
			};
			const dimensions = style.dimensionSources ?? {};
			for (const [key, value] of Object.entries({
				laneCount: style.laneCount,
				laneWidth: style.laneWidth,
				totalWidth:
					(
						style.laneWidths ?? Array(style.laneCount).fill(style.laneWidth)
					).reduce((a: number, b: number) => a + b, 0) +
					(style.leftSide?.bikeLaneWidth ?? 0) +
					(style.rightSide?.bikeLaneWidth ?? 0) +
					(style.leftSide?.parkingLaneWidth ?? 0) +
					(style.rightSide?.parkingLaneWidth ?? 0) +
					(style.leftSide?.busLaneWidth ?? 0) +
					(style.rightSide?.busLaneWidth ?? 0),
			})) {
				const source = dimensions[key],
					sourceTags = source?.tag
						? decodeURIComponent(source.tag).split("|")
						: [];
				const origin =
					source?.kind === "mapped"
						? "mapped"
						: source?.kind === "derived"
							? "derived"
							: "estimate";
				const claims =
					key === "laneCount"
						? ["lanes", "lanes:forward", "lanes:backward"]
						: ["width", "est_width", "width:lanes"];
				set(
					key,
					value,
					origin,
					sourceTags.length
						? sourceTags
						: claims.filter((k) => tags[k] !== undefined),
					origin === "estimate"
						? "Version 1 preview default; missing or incompatible mapped dimensions were not accepted"
						: "Resolved from compatible OSM dimensions",
				);
			}
			for (const side of ["left", "right"] as const) {
				const key = [`sidewalk:${side}`, "sidewalk:both", "sidewalk"].find(
						(k) => tags[k] !== undefined,
					),
					raw = key ? tags[key] : undefined;
				let presence: boolean | null = null;
				if (["no", "none", "separate"].includes(raw ?? "")) presence = false;
				else if (["yes", "both", side].includes(raw ?? "")) presence = true;
				else if (raw === (side === "left" ? "right" : "left")) presence = false;
				set(
					`${side}SidewalkPresence`,
					presence,
					presence === null ? "estimate" : "mapped",
					key ? [key] : [],
					presence === null
						? "Source sidewalk presence is unknown; preview availability is an estimate"
						: raw === "separate"
							? "A separate mapped sidewalk is not an inline band"
							: "Explicit mapped sidewalk presence or absence",
				);
				const width =
					side === "left"
						? style.leftSide?.sidewalkWidth
						: style.rightSide?.sidewalkWidth;
				const widthKey = [
					`sidewalk:${side}:width`,
					"sidewalk:both:width",
					"sidewalk:width",
				].find((k) => parseOsmLength(tags[k]) !== null);
				const compatible = widthKey && parseOsmLength(tags[widthKey]) === width;
				set(
					`${side}SidewalkWidth`,
					width ?? 0,
					presence === false ? "mapped" : compatible ? "mapped" : "estimate",
					presence === false && key ? [key] : widthKey ? [widthKey] : [],
					presence === false
						? "Explicit absence prevents the default band"
						: compatible
							? "Compatible mapped width"
							: "Estimated preview width; source presence remains independently reviewable",
				);
			}
			set(
				"surfaceMaterial",
				style.surfaceMaterial ?? "asphalt",
				style.surfaceSource?.kind === "mapped" ? "mapped" : "estimate",
				tags.surface ? ["surface"] : [],
				style.surfaceSource?.kind === "mapped"
					? "Mapped supported surface"
					: "Estimated catalog surface",
			);
			const points = sampleRoadEdgePoints(graph, edge, 48);
			const length = points
				.slice(1)
				.reduce(
					(sum, p, i) =>
						sum +
						Math.hypot(
							p[0] - points[i]![0],
							p[1] - points[i]![1],
							p[2] - points[i]![2],
						),
					0,
				);
			if (length <= 0) continue;
			const diagnostics = normalizeOsmRoadTags(tags).diagnostics.map(
				(d) => `${d.field}: ${d.message}`,
			);
			if (
				values.laneWidth!.origin === "estimate" &&
				(tags.width || tags.est_width)
			)
				diagnostics.push(
					"Mapped carriageway width was incompatible with the current lane/band model; preview width is estimated and the source claim is retained.",
				);
			sections.push({
				id: `section~${edge.id}~whole`,
				edgeId: edge.id,
				wayId: edge.osmSource.wayId,
				sourceSpan: edge.osmSource.span ?? null,
				interval: { start: 0, end: length },
				values,
				diagnostics,
			});
		}
	sections.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return StreetSectionReport.parse({
		format: "street-section-report",
		schemaVersion: 1,
		policy,
		sections,
	});
}
export function parseStreetSectionReport(value: unknown): StreetSectionReport {
	return StreetSectionReport.parse(
		typeof value === "string" ? JSON.parse(value) : value,
	);
}
