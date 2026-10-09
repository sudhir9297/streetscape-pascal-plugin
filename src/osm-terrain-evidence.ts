import {
	parseMappedElevation,
	parseTerrainEvidence,
	type TerrainEvidence,
	type TerrainSource,
	type TerrainCoverage,
} from "./domain/terrain-evidence";
import { localToGeo, type GeoPoint } from "./domain/site-frame";
import type { RoadNetworkGraph } from "./road-network-topology";
import type { OsmImportedPointAsset } from "./osm-point-assets";

export function buildTerrainEvidence(input: {
	center: GeoPoint;
	origin: number | null;
	referenceId: string | null;
	requested: boolean;
	source: TerrainSource | null;
	coverage: TerrainCoverage | null;
	sample: (point: GeoPoint) => number | null;
	graphs: RoadNetworkGraph[];
	assets: OsmImportedPointAsset[];
	mappedDatumId?: string;
}): TerrainEvidence {
	const evidence: TerrainEvidence = {
		format: "streetscape-terrain-evidence",
		schemaVersion: 1,
		source: input.source,
		coverage: input.coverage,
		sampling: input.requested ? "requested" : "disabled",
		sourceFrame: {
			center: { ...input.center },
			originElevationMeters: input.origin,
			relativeReferenceId: input.referenceId,
		},
		samples: [],
		roads: [],
		diagnostics: [],
	};
	const diagnostic = (
		code: TerrainEvidence["diagnostics"][number]["code"],
		message: string,
		edgeId: string | null = null,
		sampleId: string | null = null,
	) => evidence.diagnostics.push({ code, message, edgeId, sampleId });
	if (!input.requested)
		diagnostic(
			"terrain-disabled",
			"Terrain sampling was disabled; ground heights are estimates.",
		);
	else {
		if (!input.coverage)
			diagnostic(
				"coverage-unavailable",
				"Sampler did not report tile coverage.",
			);
		if (input.origin === null)
			diagnostic(
				"missing-origin",
				"Terrain is unavailable at the selected origin; absolute samples cannot establish relative heights.",
			);
		for (const tile of input.coverage?.tiles ?? [])
			if (tile.status !== "available")
				diagnostic(
					tile.reason === "invalid" ? "invalid-tile" : "tile-unavailable",
					`Terrain tile ${tile.zoom}/${tile.x}/${tile.y} has ${tile.status} coverage${tile.reason ? ` (${tile.reason})` : ""}.`,
				);
	}
	const sampleIds = new Map<string, string>();
	const sampleAt = (x: number, z: number) => {
		const key = `${x},${z}`;
		const existing = sampleIds.get(key);
		if (existing) return existing;
		const point = localToGeo([x, z], input.center),
			value = input.requested ? input.sample(point) : null,
			id = `ground-${evidence.samples.length + 1}`;
		evidence.samples.push({
			id,
			point,
			elevationMeters: value,
			appliedHeightMeters:
				value !== null && input.origin !== null ? value - input.origin : null,
		});
		sampleIds.set(key, id);
		if (input.requested && value === null)
			diagnostic(
				"sample-unavailable",
				"Ground sample unavailable; local height uses an estimated fallback.",
				null,
				id,
			);
		return id;
	};
	sampleAt(0, 0);
	for (const graph of input.graphs)
		for (const edge of Object.values(graph.edges)) {
			const points = [
				graph.graphNodes[edge.startNodeId]!.position,
				...edge.alignment,
				graph.graphNodes[edge.endNodeId]!.position,
			];
			const raw = edge.osmSource?.tags.ele,
				value = parseMappedElevation(raw);
			const compatible =
				input.source?.verticalReference.kind === "datum" &&
				input.source.verticalReference.datumId === input.mappedDatumId;
			const reason =
				raw === undefined
					? null
					: value === null
						? "invalid"
						: !input.mappedDatumId ||
								input.source?.verticalReference.kind !== "datum"
							? "reference-unknown"
							: !compatible
								? "reference-incompatible"
								: input.origin === null
									? "missing-origin"
									: null;
			if (raw !== undefined && reason)
				diagnostic(
					reason === "invalid" ? "invalid-mapped-elevation" : reason,
					`Mapped ele claim is retained without applying it (${reason}).`,
					edge.id,
				);
			const structure =
				(edge.osmVertical?.bridge || edge.osmVertical?.tunnel) &&
				edge.verticalSource?.kind !== "mapped"
					? {
							kind: edge.osmVertical?.tunnel
								? ("tunnel" as const)
								: ("bridge" as const),
							basis:
								edge.verticalSource?.clearanceMeters !== undefined
									? ("estimated-clearance-v1" as const)
									: ("endpoint-interpolation-v1" as const),
							clearanceMeters: edge.verticalSource?.clearanceMeters ?? null,
						}
					: null;
			if (structure)
				diagnostic(
					"structure-estimated",
					"Structural clearance is an estimate, separate from terrain and mapped elevation claims.",
					edge.id,
				);
			evidence.roads.push({
				edgeId: edge.id,
				wayId: edge.osmSource?.wayId ?? null,
				groundSampleIds: points.map((point) => sampleAt(point[0], point[2])),
				mappedElevation:
					raw === undefined
						? null
						: {
								raw,
								valueMeters: value,
								datumId: input.mappedDatumId ?? null,
								applied:
									reason === null && edge.verticalSource?.kind === "mapped",
								reason,
							},
				structure,
			});
		}
	for (const asset of input.assets)
		sampleAt(asset.position[0], asset.position[2]);
	return parseTerrainEvidence(evidence);
}

/** Persist only source roads relevant to this component, with their referenced samples. */
export function selectTerrainEvidence(
	evidence: TerrainEvidence,
	wayIds: ReadonlySet<number>,
): TerrainEvidence {
	const roads = evidence.roads.filter(
		(road) => road.wayId !== null && wayIds.has(road.wayId),
	);
	const edgeIds = new Set(roads.map((road) => road.edgeId)),
		sampleIds = new Set(roads.flatMap((road) => road.groundSampleIds));
	if (evidence.samples[0]) sampleIds.add(evidence.samples[0].id);
	return parseTerrainEvidence({
		...evidence,
		roads,
		samples: evidence.samples.filter((sample) => sampleIds.has(sample.id)),
		diagnostics: evidence.diagnostics.filter(
			(item) =>
				(item.edgeId === null || edgeIds.has(item.edgeId)) &&
				(item.sampleId === null || sampleIds.has(item.sampleId)),
		),
	});
}
