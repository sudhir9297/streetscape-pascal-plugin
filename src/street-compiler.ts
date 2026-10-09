import { compileStreetSectionSurfaces } from "./street-section-surfaces";
import { compileJunctionMovementPlan } from "./street-junction-movement-plan";
import { compileSectionMarkings } from "./street-section-markings";
import { compileLaneMovements } from "./lane-movement-graph";
import type { LaneMovementGraph } from "./domain/lane-movement";
import { decodeStoredReport } from "./report-storage";
import type { OsmMovementEvidence } from "./source/osm-movement-evidence";
import { buildRoadBridgeSpans } from "./road-network-bridge";
import { buildRoadEarthworkStrips } from "./road-network-earthworks";
import type { TerrainField } from "./terrain-field-compat";
import { compileStreetLayout } from "./street-compiler-layout";
import type { FloorplanGeometry } from "@pascal-app/core";
import { RoadNetworkNode } from "./schema";
import { compileCanonicalRoadSurface } from "./street-compiler-surfaces";
import {
	buildRoadRenderPaths,
	sampleRoadEdgePoints,
} from "./road-network-geometry";
import {
	buildRoadTransitionProfiles,
	buildRoadTransitionProfilesIncremental,
	createRoadTransitionProfileCache,
	type RoadTransitionProfile,
} from "./road-transition-profile";
import { maskMappedComponentsForProfile } from "./road-mapped-band-mask";
import { buildRoadNetworkMarkings } from "./road-network-markings";
import { buildRoadsideDecorationPreviews } from "./roadside-decoration-rules";
import { validateRoadGraph } from "./road-network-validation";
import { compileStreetJunctions } from "./street-compiler-junctions";
import { buildMappedSurfaceMesh } from "./road-mapped-surface-plan";

/** Explicit effective model is the entire input; no host/editor/view state is consulted. */
export function compileStreet(
	input: RoadNetworkNode,
	terrain: TerrainField | null = null,
	movements?: LaneMovementGraph,
) {
	const node = RoadNetworkNode.parse(input);
	return compileEffectiveStreet(
		node,
		buildRoadTransitionProfiles(node),
		terrain,
		movements,
	);
}

function compileEffectiveStreet(
	node: RoadNetworkNode,
	transitionProfiles: RoadTransitionProfile[],
	terrain: TerrainField | null = null,
	movements?: LaneMovementGraph,
) {
	const referencePaths = Object.values(node.edges).map((edge) => ({
		edgeId: edge.id,
		points: sampleRoadEdgePoints(node, edge),
	}));
	const renderPaths = buildRoadRenderPaths(node);
	const profiles = transitionProfiles.map((profile) =>
		maskMappedComponentsForProfile(node, profile),
	);
	const layout = compileStreetLayout(node, transitionProfiles);
	const junctions = layout.renderedJunctionSurfaces;
	const evidence = decodeStoredReport(node.metadata?.osmMovementEvidence) as
		| OsmMovementEvidence
		| undefined;
	const laneMovements =
		movements ??
		compileLaneMovements(
			[{ roadId: node.id, network: node }],
			evidence?.format === "osm-movement-evidence" ? evidence : undefined,
		);
	const junctionMovementPlan = compileJunctionMovementPlan(
		node,
		layout,
		laneMovements,
	);
	const sectionSurfaces = compileStreetSectionSurfaces(node, layout);
	const sectionEdges = new Set(sectionSurfaces.map((s) => s.edgeId));
	const markings = [
		...buildRoadNetworkMarkings(node).filter(
			(m) => !m.junctionId && !sectionEdges.has(m.edgeId),
		),
		...compileSectionMarkings(node, sectionSurfaces),
		...junctionMovementPlan.markings,
	];
	const placements = buildRoadsideDecorationPreviews(node);
	const diagnostics = validateRoadGraph(node);
	diagnostics.push(...junctionMovementPlan.diagnostics);
	for (const path of referencePaths) {
		const section = node.edges[path.edgeId]?.sectionLayout;
		if (!section) continue;
		const length = path.points
			.slice(1)
			.reduce(
				(sum, point, i) =>
					sum +
					Math.hypot(
						point[0] - path.points[i]![0],
						point[2] - path.points[i]![2],
					),
				0,
			);
		if (Math.abs(length - section.length) > 0.05)
			diagnostics.push({
				code: "section-span-changed",
				severity: "warning",
				edgeId: path.edgeId,
				message:
					"Section span changed; review layout stations. Showing the whole-span fallback.",
			});
	}
	const canonicalFloorplan = compileCanonicalRoadSurface(
		node,
		layout,
		sectionSurfaces,
		markings,
	);
	const polygons: Array<Extract<FloorplanGeometry, { kind: "polygon" }>> = [];
	const collect = (geometry: FloorplanGeometry) => {
		if (geometry.kind === "polygon") polygons.push(geometry);
		if (geometry.kind === "group")
			for (const child of geometry.children) collect(child);
	};
	collect(canonicalFloorplan);
	let bounds: { min: [number, number]; max: [number, number] } | null = null;
	for (const polygon of polygons)
		for (const [x, z] of polygon.points) {
			if (!bounds) bounds = { min: [x, z], max: [x, z] };
			else {
				bounds.min[0] = Math.min(bounds.min[0], x);
				bounds.min[1] = Math.min(bounds.min[1], z);
				bounds.max[0] = Math.max(bounds.max[0], x);
				bounds.max[1] = Math.max(bounds.max[1], z);
			}
		}

	return {
		format: "compiled-street" as const,
		version: 1 as const,
		networkId: node.id,
		bridgeSpans: buildRoadBridgeSpans(node),
		earthworkStrips: buildRoadEarthworkStrips(node, terrain),
		referencePaths,
		layout,
		renderPaths,
		profiles,
		surfacePolygons: polygons,
		sectionSurfaces,
		junctions,
		markings,
		junctionMovementPlan,
		placements,
		mappedSurfaces: node.osmMappedSurfaces.map((surface) => ({
			id: surface.id,
			mesh: buildMappedSurfaceMesh(surface),
		})),
		bounds,
		diagnostics,
		canonicalFloorplan,
	};
}
export type CompiledStreetPlan = ReturnType<typeof compileStreet>;

/** View-owned cache; pure compileStreet remains the reference implementation. */
export function createCachedStreetCompiler() {
	const cache = createRoadTransitionProfileCache();
	return {
		compile(
			input: RoadNetworkNode,
			terrain: TerrainField | null = null,
			movements?: LaneMovementGraph,
		) {
			const node = RoadNetworkNode.parse(input);
			return compileEffectiveStreet(
				node,
				buildRoadTransitionProfilesIncremental(node, cache),
				terrain,
				movements,
			);
		},
		get stats() {
			return { ...cache.stats };
		},
	};
}
