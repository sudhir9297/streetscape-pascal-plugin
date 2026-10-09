import { parseOsmLength } from "../source/osm-normalization";
import { z } from "zod";
const Point = z.strictObject({
	lat: z.number().min(-85).max(85),
	lon: z.number().min(-180).max(180),
});
const Bounds = z.strictObject({
	south: z.number(),
	west: z.number(),
	north: z.number(),
	east: z.number(),
});
export const TerrainSource = z.strictObject({
	provider: z.string().min(1),
	dataset: z.string().min(1),
	encoding: z.string().min(1),
	units: z.literal("metres"),
	verticalReference: z.discriminatedUnion("kind", [
		z.strictObject({ kind: z.literal("unknown") }),
		z.strictObject({ kind: z.literal("datum"), datumId: z.string().min(1) }),
	]),
});
export type TerrainSource = z.infer<typeof TerrainSource>;
export const TerrainCoverage = z.strictObject({
	requestedBounds: Bounds,
	tiles: z.array(
		z.strictObject({
			zoom: z.number().int().nonnegative(),
			x: z.number().int(),
			y: z.number().int(),
			bounds: Bounds,
			url: z.string().nullable(),
			acquiredAt: z.iso.datetime().nullable(),
			status: z.enum(["available", "partial", "unavailable"]),
			reason: z.enum(["missing", "invalid", "loader-error"]).nullable(),
		}),
	),
});
export type TerrainCoverage = z.infer<typeof TerrainCoverage>;
export const TerrainEvidence = z
	.strictObject({
		format: z.literal("streetscape-terrain-evidence"),
		schemaVersion: z.literal(1),
		source: TerrainSource.nullable(),
		coverage: TerrainCoverage.nullable(),
		sampling: z.enum(["requested", "disabled"]),
		sourceFrame: z.strictObject({
			center: Point,
			originElevationMeters: z.number().nullable(),
			relativeReferenceId: z.string().nullable(),
		}),
		samples: z.array(
			z.strictObject({
				id: z.string().min(1),
				point: Point,
				elevationMeters: z.number().nullable(),
				appliedHeightMeters: z.number().nullable(),
			}),
		),
		roads: z.array(
			z.strictObject({
				edgeId: z.string().min(1),
				wayId: z.number().int().nullable(),
				groundSampleIds: z.array(z.string()),
				mappedElevation: z
					.strictObject({
						raw: z.string(),
						valueMeters: z.number().nullable(),
						datumId: z.string().nullable(),
						applied: z.boolean(),
						reason: z
							.enum([
								"invalid",
								"reference-unknown",
								"reference-incompatible",
								"missing-origin",
							])
							.nullable(),
					})
					.nullable(),
				structure: z
					.strictObject({
						kind: z.enum(["bridge", "tunnel"]),
						basis: z.enum([
							"estimated-clearance-v1",
							"endpoint-interpolation-v1",
						]),
						clearanceMeters: z.number().positive().nullable(),
					})
					.nullable(),
			}),
		),
		diagnostics: z.array(
			z.strictObject({
				code: z.enum([
					"terrain-disabled",
					"coverage-unavailable",
					"tile-unavailable",
					"invalid-tile",
					"missing-origin",
					"sample-unavailable",
					"reference-unknown",
					"reference-incompatible",
					"invalid-mapped-elevation",
					"structure-estimated",
				]),
				edgeId: z.string().nullable(),
				sampleId: z.string().nullable(),
				message: z.string().min(1),
			}),
		),
	})
	.superRefine((value, ctx) => {
		const ids = new Set(value.samples.map((sample) => sample.id));
		for (const sample of value.samples) {
			const expected =
				sample.elevationMeters !== null &&
				value.sourceFrame.originElevationMeters !== null
					? sample.elevationMeters - value.sourceFrame.originElevationMeters
					: null;
			if (
				expected === null
					? sample.appliedHeightMeters !== null
					: sample.appliedHeightMeters === null ||
						Math.abs(sample.appliedHeightMeters - expected) > 1e-8
			)
				ctx.addIssue({
					code: "custom",
					message:
						"Ground sample relative height does not match its source reference",
				});
		}
		for (const road of value.roads) {
			const claim = road.mappedElevation;
			if (
				claim?.applied &&
				(claim.reason !== null ||
					claim.valueMeters === null ||
					value.sourceFrame.originElevationMeters === null ||
					value.source?.verticalReference.kind !== "datum" ||
					value.source.verticalReference.datumId !== claim.datumId)
			)
				ctx.addIssue({
					code: "custom",
					message:
						"Applied mapped elevation lacks compatible reference evidence",
				});
		}
		for (const diagnostic of value.diagnostics)
			if (diagnostic.sampleId !== null && !ids.has(diagnostic.sampleId))
				ctx.addIssue({
					code: "custom",
					message: "Missing diagnostic sample reference",
				});

		if (ids.size !== value.samples.length)
			ctx.addIssue({
				code: "custom",
				message: "Duplicate terrain sample identity",
			});
		for (const road of value.roads)
			for (const id of road.groundSampleIds)
				if (!ids.has(id))
					ctx.addIssue({
						code: "custom",
						message: "Missing terrain sample reference",
					});
	});
export type TerrainEvidence = z.infer<typeof TerrainEvidence>;
export function parseTerrainEvidence(input: unknown): TerrainEvidence {
	if (typeof input === "string") input = JSON.parse(input);
	if (
		input &&
		typeof input === "object" &&
		"schemaVersion" in input &&
		input.schemaVersion !== 1
	)
		throw Error(
			`Unsupported terrain evidence version: ${String(input.schemaVersion)}`,
		);
	return TerrainEvidence.parse(input);
}
/** OSM ele is metres. Unsupported unit strings remain raw, unapplied claims. */
export function parseMappedElevation(raw: string | undefined): number | null {
	return parseOsmLength(raw, true);
}
