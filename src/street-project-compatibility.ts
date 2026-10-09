import { resolveScenarioMovementEvidence } from "./domain/scenario-movement-evidence";
import { decodeStoredReport, encodeStoredReport } from "./report-storage";
import type { OsmMovementEvidence } from "./source/osm-movement-evidence";
import { ResolvedStreetRoadData } from "./domain/resolved-street-road";
import type { StreetSectionReport } from "./domain/street-sections";
import type { StreetValueOrigin } from "./domain/street-evidence";
import type { StreetBaselineRevision } from "./domain/street-project";
import { sampleRoadEdgePoints } from "./road-network-geometry";
import { canonicalSourceJson } from "./source/osm-source-snapshot";
import { encodeOsmHostProjection } from "./host/osm-projection-encoding";
import { resolveStreetFeatureData } from "./domain/street-resolution";
import { z } from "zod";
import { RoadNetworkNode } from "./schema";
import { validateRoadGraph } from "./road-network-validation";
import {
	parseStreetProject,
	StreetRoad,
	type StreetProject,
} from "./domain/street-project";

/** Current host schemas remain at this adapter boundary, outside the domain. */
export function adaptCurrentRoad(input: {
	id: string;
	network: RoadNetworkNode;
	origin: StreetRoad["origin"];
	sourceReferenceIds?: string[];
}): StreetRoad {
	const network = RoadNetworkNode.parse(input.network);
	const errors = validateRoadGraph(network).filter(
		(issue) => issue.severity === "error",
	);
	if (errors.length)
		throw new Error(`Cannot adapt an invalid road: ${errors[0]!.message}`);
	// Host schemas have optional undefined fields. JSON is the persistence boundary.
	const data = z
		.record(z.string(), z.json())
		.parse(JSON.parse(JSON.stringify(network)));
	return StreetRoad.parse({
		id: input.id,
		origin: input.origin,
		sourceReferenceIds: input.sourceReferenceIds ?? [],
		representation: "pascal-road-network-v1",
		data,
	});
}

/** Explicit legacy conversion: preserve effective values, never invent source evidence. */
export function createLegacyStreetProject(input: {
	id: string;
	name: string;
	baselineRevisionId: string;
	acceptedAt: string;
	roads: readonly RoadNetworkNode[];
}): StreetProject {
	const roads: Record<string, StreetRoad> = {};
	for (const network of input.roads) {
		if (roads[network.id])
			throw new Error(`Duplicate legacy road ID: ${network.id}`);
		roads[network.id] = adaptCurrentRoad({
			id: network.id,
			network,
			origin: "legacy-authored",
		});
	}
	return parseStreetProject({
		format: "streetscape-project",
		schemaVersion: 1,
		id: input.id,
		name: input.name,
		revision: 0,
		siteFrameId: null,
		sourceReferences: {},
		baselineRevisions: {
			[input.baselineRevisionId]: {
				id: input.baselineRevisionId,
				parentRevisionId: null,
				acceptedAt: input.acceptedAt,
				sourceReferenceIds: [],
				roads,
				features: {},
			},
		},
		activeBaselineRevisionId: input.baselineRevisionId,
		scenarios: {},
		activeScenarioId: null,
	});
}

/** Validate compatibility payloads when materializing them for the existing engine. */
export function readCurrentRoad(road: StreetRoad): RoadNetworkNode {
	const parsed = StreetRoad.parse(road);
	const network =
		parsed.representation === "resolved-street-v1"
			? materializeResolvedRoad(parsed)
			: RoadNetworkNode.parse(parsed.data);
	const errors = validateRoadGraph(network).filter(
		(issue) => issue.severity === "error",
	);
	if (errors.length)
		throw new Error(
			`Street road contains invalid topology: ${errors[0]!.message}`,
		);
	return network;
}

/** Apply explicit baseline/scenario semantics before validating the host payload. */
export function readResolvedCurrentRoad(
	project: StreetProject,
	baselineId: string,
	roadId: string,
	scenarioId: string | null = null,
): RoadNetworkNode {
	const road = project.baselineRevisions[baselineId]?.roads[roadId];
	if (!road) throw new Error(`Unknown baseline road: ${roadId}`);
	const projected = encodeOsmHostProjection(
		readCurrentRoad({
			...road,
			data: resolveStreetFeatureData(
				project,
				baselineId,
				"roads",
				roadId,
				scenarioId,
			),
		}),
	);
 if(scenarioId !== null) {
  const evidence=decodeStoredReport(projected.metadata.osmMovementEvidence) as OsmMovementEvidence|undefined;
  if(evidence?.format === "osm-movement-evidence") projected.metadata={...projected.metadata,osmMovementEvidence:JSON.parse(encodeStoredReport(resolveScenarioMovementEvidence(evidence,project.scenarios[scenarioId])))};
 }
 return projected;
}

/** Opt-in semantic conversion. No source claim is invented for existing roads. */
export function adaptResolvedCurrentRoad(
	input: Parameters<typeof adaptCurrentRoad>[0] & {
		sectionReport?: StreetSectionReport;
		coordinateFrameId?: string | null;
	},
): StreetRoad {
	const legacy = adaptCurrentRoad(input);
	const network = readCurrentRoad(legacy);
	const {
		graphNodes,
		edges,
		attachments,
		junctions,
		stylePresets,
		activeStyleId,
		osmMappedSurfaces,
		osmCrossings,
		osmLaneConnectivity,
		...node
	} = network;
	const sections: ResolvedStreetRoadData["sections"] = {};
	for (const edge of Object.values(edges)) {
		const reported = input.sectionReport?.sections.find(
			(section) => section.edgeId === edge.id,
		);
		const id = `section:${edge.id}`;
		const points = sampleRoadEdgePoints(network, edge);
		const length = points
			.slice(1)
			.reduce(
				(total, p, i) =>
					total + Math.hypot(p[0] - points[i]![0], p[2] - points[i]![2]),
				0,
			);
		sections[id] = {
			id,
			edgeId: edge.id,
			interval: { start: 0, end: reported?.interval.end ?? length },
			style: jsonObject(stylePresets[edge.styleId]),
			values: jsonObject(reported?.values ?? {}),
			...(edge.sectionLayout ? { layout: edge.sectionLayout } : {}),
		};
	}
	const data = jsonObject({
		coordinateFrameId: input.coordinateFrameId ?? null,
		referenceNodes: graphNodes,
		referenceLines: Object.fromEntries(Object.entries(edges).map(([id, edge]) => {
			const { sectionLayout, ...reference } = edge;
			return [id, reference];
		})),
		sections,
		attachments,
		junctions,
		inventory: {
			surfaces: osmMappedSurfaces,
			crossings: osmCrossings,
			laneConnectivity: osmLaneConnectivity,
		},
		compatibility: {
			node: jsonObject(node),
			unusedStyles: stylePresets,
			activeStyleId,
		},
	});
	return StreetRoad.parse({
		...legacy,
		representation: "resolved-street-v1",
		data,
	});
}

function jsonObject(value: unknown) {
	return z
		.record(z.string(), z.json())
		.parse(JSON.parse(JSON.stringify(value)));
}

/** Explicit migration preserves all authored styles, geometry, assets and display settings. */
export function convertStreetProjectRoads(input: StreetProject): StreetProject {
	const project = parseStreetProject(input);
	let changed = false;
	for (const baseline of Object.values(project.baselineRevisions)) {
		const evidence = { ...(baseline.propertyEvidence ?? {}) };
		const migrations = new Map<string, string[]>();
		for (const [id, road] of Object.entries(baseline.roads)) {
			if (road.representation === "resolved-street-v1") continue;
			const network = readCurrentRoad(road);
			const converted = adaptResolvedCurrentRoad({
				id,
				network,
				origin: road.origin,
				sourceReferenceIds: road.sourceReferenceIds,
			});
			baseline.roads[id] = converted;
			changed = true;
			baseline.propertyEvidence ??= {};
			const owned = Object.values(evidence).filter(
				(p) => p.target.category === "roads" && p.target.featureId === id,
			);
			if (owned.length === 0) addSectionEvidence(baseline, converted, null);
			for (const property of owned) {
				const [root, ...tail] = property.target.path;
				let paths: Array<Array<string | number>>;
				if (root === "stylePresets") {
					const [styleId, ...propertyTail] = tail;
					if (typeof styleId !== "string")
						throw Error(
							"A whole style-map claim requires an explicit migration",
						);
					const sections = Object.values(network.edges).filter(
						(edge) => edge.styleId === styleId,
					);
					paths = sections.length
						? sections.map((edge) => [
								"sections",
								`section:${edge.id}`,
								"style",
								...propertyTail,
							])
						: [["compatibility", "unusedStyles", ...tail]];
				} else {
					const roots: Record<string, string[]> = {
						graphNodes: ["referenceNodes"],
						edges: ["referenceLines"],
						attachments: ["attachments"],
						junctions: ["junctions"],
						osmMappedSurfaces: ["inventory", "surfaces"],
						osmCrossings: ["inventory", "crossings"],
						osmLaneConnectivity: ["inventory", "laneConnectivity"],
						activeStyleId: ["compatibility", "activeStyleId"],
					};
					paths = [
						[
							...(roots[String(root)] ?? [
								"compatibility",
								"node",
								String(root),
							]),
							...tail,
						],
					];
				}
				delete baseline.propertyEvidence[property.id];
				const ids = paths.map((path, index) => {
					const nextId =
						paths.length === 1
							? property.id
							: JSON.stringify([property.id, "section", index]);
					if (Object.hasOwn(baseline.propertyEvidence!, nextId))
						throw Error("Property migration identity collision");
					baseline.propertyEvidence![nextId] = {
						...property,
						id: nextId,
						target: { ...property.target, path },
					};
					return nextId;
				});
				migrations.set(property.id, ids);
			}
		}
		for (const scenario of Object.values(project.scenarios)) {
			if (scenario.baselineRevisionId !== baseline.id) continue;
			for (const [oldId, nextIds] of migrations) {
				for(const field of ["overrides","propertyLocks"] as const) {
 if (!Object.hasOwn(scenario[field] ?? {}, oldId)) continue;
 const override = scenario[field]![oldId]!;
 delete scenario[field]![oldId];
 for(const nextId of nextIds) scenario[field]![nextId] = structuredClone(override);
 }
			}
		}
	}
	if (changed) project.revision++;
	return parseStreetProject(project);
}

/** Convert authoritative reference lines and sections into current renderer inputs. */
function materializeResolvedRoad(road: StreetRoad): RoadNetworkNode {
	const data = ResolvedStreetRoadData.parse(road.data);
	const stylePresets = structuredClone(data.compatibility.unusedStyles);
	const edges = structuredClone(data.referenceLines);
	for (const section of Object.values(data.sections)) {
		const edge = edges[section.edgeId]!;
		if (section.layout) edge.sectionLayout = section.layout;
		const original = stylePresets[edge.styleId];
		if (canonicalSourceJson(original) !== canonicalSourceJson(section.style)) {
			let id = `baseline-section~${encodeURIComponent(section.id)}`,
				suffix = 1;
			while (Object.hasOwn(stylePresets, id))
				id = `baseline-section~${encodeURIComponent(section.id)}~${suffix++}`;
			stylePresets[id] = { ...section.style, id };
			edge.styleId = id;
		}
	}
	return RoadNetworkNode.parse({
		...data.compatibility.node,
		graphNodes: data.referenceNodes,
		edges,
		attachments: data.attachments,
		junctions: data.junctions,
		stylePresets,
		activeStyleId: data.compatibility.activeStyleId,
		osmMappedSurfaces: data.inventory.surfaces,
		osmCrossings: data.inventory.crossings,
		osmLaneConnectivity: data.inventory.laneConnectivity,
	});
}

export function addSectionEvidence(
	baseline: StreetBaselineRevision,
	road: StreetRoad,
	sourceReferenceId: string | null,
) {
	const data = ResolvedStreetRoadData.parse(road.data);
	baseline.propertyEvidence ??= {};
	for (const section of Object.values(data.sections)) {
		const line = data.referenceLines[section.edgeId]!;
		const source = line.osmSource as { wayId: number } | undefined;
		// Whole-span effective style fields are the current renderer's resolution inputs.
		const fields = Object.entries(section.style).flatMap(([key, value]) => {
			if (
				(key === "leftSide" || key === "rightSide") &&
				value &&
				typeof value === "object" &&
				!Array.isArray(value)
			) {
				return Object.entries(value).map(([component, dimension]) => ({
					key:
						component === "sidewalkWidth"
							? key === "leftSide"
								? "leftSidewalkWidth"
								: "rightSidewalkWidth"
							: component,
					value: dimension,
					path: [key, component],
				}));
			}
			return [{ key, value, path: [key] }];
		});
		for (const { key, value, path } of fields) {
			if (["id", "name", "dimensionSources", "surfaceSource"].includes(key))
				continue;
			const resolved = section.values[key] as
				| {
						origin?: string;
						sourceTags?: string[];
						reason?: string;
						rawClaims?: Record<string, string>;
				  }
				| undefined;
			const id = JSON.stringify([road.id, section.id, "style", ...path]);
			const claimId = `${id}:effective`;
			const origin: StreetValueOrigin =
				sourceReferenceId === null
					? road.origin === "authored"
						? {
								kind: "authored",
								reason: "Preserved current authored road value",
							}
						: { kind: "legacy-authored" }
					: resolved?.origin === "mapped"
						? {
								kind: "source",
								sourceReferenceId,
								sourceFeatureId: source ? `way/${source.wayId}` : null,
							}
						: {
								kind: "inferred",
								ruleId: "initial-street-section",
								ruleVersion: "1",
								basisClaimIds: [],
								observationIds: [],
							};
			baseline.propertyEvidence[id] = {
				id,
				target: {
					category: "roads",
					featureId: road.id,
					path: ["sections", section.id, "style", ...path],
				},
				units: /Width|Thickness/.test(key) ? "metres" : null,
				claims: { [claimId]: { id: claimId, value, origin } },
				rejectedClaims: [],
				accepted: { kind: "claim", claimId },
			};
		}
	}
}
