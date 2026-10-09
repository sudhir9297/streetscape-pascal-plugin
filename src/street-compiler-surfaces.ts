import { compileStreetSectionSurfaces, type SectionSurface } from "./street-section-surfaces";
import type { CompiledStreetLayout } from "./street-compiler-layout";
import { maskMappedComponentsForProfile } from "./road-mapped-band-mask";
import {
	buildMappedSurfaceMesh,
	mappedSurfaceColor,
} from "./road-mapped-surface-plan";
import type { FloorplanGeometry, GeometryContext } from "@pascal-app/core";
import { classifyRoadJunction } from "./road-network-topology";
import { buildRoadCurbCornerHandles } from "./road-network-corner-editing";
import { buildRoadNetworkMarkings } from "./road-network-markings";
import {
	buildRoadJunctionBands,
	roadCarriagewayWidth,
	ROAD_SIDE_COMPONENT_SPECS,
} from "./road-cross-section";
import {
	buildRoadTransitionProfiles,
	type RoadTransitionSample,
} from "./road-transition-profile";
import {
	buildJunctionBoundaryGeometry,
	buildJunctionBoundarySidewalkGeometry,
	roadTerminalEnds,
	sampleRoadEdgePoints,
} from "./road-network-geometry";
import type { RoadGraphEdge, RoadNetworkNode, RoadStylePreset } from "./schema";
import { DEFAULT_ROAD_STYLE_PRESETS } from "./road-style-presets";
import {
	roadValidationIssuePoint,
	validateRoadGraph,
} from "./road-network-validation";
import {
	buildManualRoadJunctionBand,
	buildManualRoadJunctionBoundary,
} from "./road-junction-boundary-editor";
import { buildRoadsideComponentSurfacePolygons } from "./roadside-openings";

type PlanPoint = readonly [number, number];

function resolveStyle(
	node: RoadNetworkNode,
	edge: RoadGraphEdge,
): RoadStylePreset | undefined {
	const styleId = node.applyStyleToAll ? node.activeStyleId : edge.styleId;
	return (
		node.stylePresets[styleId] ??
		(DEFAULT_ROAD_STYLE_PRESETS[
			styleId as keyof typeof DEFAULT_ROAD_STYLE_PRESETS
		] as RoadStylePreset | undefined) ??
		node.stylePresets[node.activeStyleId]
	);
}

function profileOffsetPoint(
	samples: RoadTransitionSample[],
	index: number,
	offset: number,
): PlanPoint {
	const sample = samples[index]!;
	const previous = samples[Math.max(0, index - 1)]!;
	const next = samples[Math.min(samples.length - 1, index + 1)]!;
	const dx = next.point[0] - previous.point[0];
	const dy = next.point[2] - previous.point[2];
	const length = Math.max(Math.hypot(dx, dy), 1e-6);
	return [
		sample.point[0] - (dy / length) * offset,
		sample.point[2] + (dx / length) * offset,
	];
}

export function compileCanonicalRoadSurface(
	node: RoadNetworkNode,
	layout: CompiledStreetLayout,
	sectionSurfaces: SectionSurface[] = compileStreetSectionSurfaces(node, layout),
 markings = buildRoadNetworkMarkings(node),
): FloorplanGeometry {
	const selected = false;
	const stroke = "#272a2d";
	const children: FloorplanGeometry[] = sectionSurfaces.map(surface => ({
		kind: "polygon", points: surface.points.map(point => [point[0], point[2]]), fill: surface.color, stroke: surface.color, strokeWidth: 0, strokeLinejoin: "round",
	}));
	for (const { profile } of layout.edgeSurfaces) {
		if (profile.edgeIds.some(id => sectionSurfaces.some(surface => surface.edgeId === id))) continue;
		const samples = profile.samples;
		for (let index = 0; index < samples.length - 1; index++) {
			const start = samples[index]!;
			const end = samples[index + 1]!;
			children.push({
				kind: "polygon",
				points: [
					profileOffsetPoint(samples, index, start.carriagewayHalfWidth),
					profileOffsetPoint(samples, index + 1, end.carriagewayHalfWidth),
					profileOffsetPoint(samples, index + 1, -end.carriagewayHalfWidth),
					profileOffsetPoint(samples, index, -start.carriagewayHalfWidth),
				],
				fill: profile.style.surfaceColor,
				stroke,
				strokeWidth: selected ? 0.09 : 0.04,
				strokeLinejoin: "round",
			});
			children.push({
				kind: "hit-line",
				x1: start.point[0],
				y1: start.point[2],
				x2: end.point[0],
				y2: end.point[2],
				strokeWidthPx: 16,
			});
		}
		for (const side of ["left", "right"] as const) {
			for (const spec of ROAD_SIDE_COMPONENT_SPECS) {
				const shapedPolygons = buildRoadsideComponentSurfacePolygons(
					node,
					profile,
					side,
					spec.kind,
					spec.elevationOffset,
				);
				if (shapedPolygons) {
					for (const polygon of shapedPolygons) {
						children.push({
							kind: "polygon",
							points: polygon.points.map((point) => [point[0], point[2]]),
							fill: spec.color,
							stroke: spec.color,
							strokeWidth: 0,
							strokeLinejoin: "round",
						});
					}
					continue;
				}
				for (let index = 0; index < samples.length - 1; index++) {
					const start = samples[index]!;
					const end = samples[index + 1]!;
					const startBounds = start.components[side][spec.kind];
					const endBounds = end.components[side][spec.kind];
					if (startBounds.width <= 1e-4 && endBounds.width <= 1e-4) continue;
					const sign = side === "left" ? 1 : -1;
					children.push({
						kind: "polygon",
						points: [
							profileOffsetPoint(
								samples,
								index,
								sign * startBounds.outerOffset,
							),
							profileOffsetPoint(
								samples,
								index + 1,
								sign * endBounds.outerOffset,
							),
							profileOffsetPoint(
								samples,
								index + 1,
								sign * endBounds.innerOffset,
							),
							profileOffsetPoint(
								samples,
								index,
								sign * startBounds.innerOffset,
							),
						],
						fill: spec.color,
						stroke: spec.color,
						strokeWidth: 0,
						strokeLinejoin: "round",
					});
				}
			}
		}
	}
	const pushMesh = (
		positions: number[],
		indices: number[],
		center: readonly [number, number, number],
		fill: string,
	) => {
		for (let i = 0; i < indices.length; i += 3)
			children.push({
				kind: "polygon",
				points: indices
					.slice(i, i + 3)
					.map(
						(index) =>
							[
								center[0] + positions[index * 3]!,
								center[2] + positions[index * 3 + 2]!,
							] as [number, number],
					),
				fill,
				stroke: fill,
				strokeWidth: 0,
			});
	};
	for (const junction of layout.renderedJunctionSurfaces) {
		pushMesh(
			junction.solution.positions,
			junction.solution.indices,
			junction.graphNode.position,
			junction.style.surfaceColor,
		);
		for (const band of [...junction.sideBands].reverse()) {
			const mesh =
				junction.bandSurfaces?.[band.kind] ??
				(junction.manualBoundary
					? buildManualRoadJunctionBand(
							junction.manualBoundary,
							band.outerWidth,
						)
					: buildJunctionBoundarySidewalkGeometry(
							junction.solution,
							band.outerWidth,
						));
			pushMesh(
				mesh.positions,
				mesh.indices,
				junction.graphNode.position,
				band.color,
			);
		}
	}
	for (const marking of markings) {
		children.push({
			kind: "polygon",
			points: marking.points.map((point) => [point[0], point[2]]),
			fill: marking.color,
			stroke: marking.color,
			strokeWidth: 0,
			strokeLinejoin: "round",
		});
	}
	for (const surface of node.osmMappedSurfaces) {
		const mesh = buildMappedSurfaceMesh(surface),
			fill = mappedSurfaceColor(surface.kind);
		for (let i = 0; i < mesh.indices.length; i += 3) {
			children.push({
				kind: "polygon",
				points: mesh.indices
					.slice(i, i + 3)
					.map(
						(index) =>
							[mesh.positions[index * 3]!, mesh.positions[index * 3 + 2]!] as [
								number,
								number,
							],
					),
				fill,
				stroke: fill,
				strokeWidth: 0,
			});
		}
	}
	return { kind: "group", children };
}
