import type { OsmImportResult } from "./osm-import";
import { RoadNetworkNode } from "./schema";
import {
	adaptResolvedCurrentRoad,
	addSectionEvidence,
	readResolvedCurrentRoad,
} from "./street-project-compatibility";
import {
	parseStreetProject,
	type StreetProject,
} from "./domain/street-project";
import {
	buildBaselineDiagnosticReport,
	BaselineDiagnosticError,
} from "./domain/baseline-diagnostics";
import { resolveInitialStreetSections } from "./domain/street-sections";
import { resolveMappedInventory } from "./osm-road-corridors";
import {
	parseOsmSourceSnapshot,
	type OsmSourceSnapshot,
} from "./source/osm-source-snapshot";
import { createOsmSiteFrame } from "./domain/site-frame";
import type { GeoPoint } from "./domain/site-frame";
import type { StreetRegionalPolicy } from "./domain/street-sections";

/** No acquisition or scene writes: resolve an import into a portable semantic baseline. */
export function createImportedStreetProject(
	result: OsmImportResult,
	input: { acceptedAt: string; id?: string; name?: string },
): StreetProject {
	const frame =
		result.coordinateFrame ??
		createOsmSiteFrame({
			center: result.source.center,
			baseElevation: result.source.baseElevation,
		});
	const sections = resolveInitialStreetSections(
		result.graphs,
		result.sectionReport?.policy ?? {
			id: "right-driving",
			version: 1,
			status: "proposed",
			basis: "fallback",
			evidence: null,
		},
	);
	const inventory = resolveMappedInventory(
		result.graphs,
		result.mappedSurfaces ?? [],
		result.crossings ?? [],
		result.source.center,
		result.source.radiusMeters,
		0,
		frame,
		result.associationChoices,
	);
	inventory.report.items.push(
		...(result.inventoryReport?.items.filter(
			(item) => item.kind === "point-asset",
		) ?? []),
	);
	const diagnostics = buildBaselineDiagnosticReport({
		...result,
		sectionReport: sections,
		inventoryReport: inventory.report,
	});
	if (diagnostics.status === "blocked")
		throw new BaselineDiagnosticError(diagnostics);
	const snapshot = result.sourceSnapshot;
	const sourceId = snapshot
		? `osm:${snapshot.integrityIdentity}`
		: "osm:unavailable";
	const project = parseStreetProject({
		format: "streetscape-project",
		schemaVersion: 1,
		id: input.id ?? `streetscape:${snapshot?.contentIdentity ?? "unavailable"}`,
		name: input.name ?? "Imported street baseline",
		revision: 0,
		siteFrameId: frame.id,
		siteFrames: { [frame.id]: frame },
		sourceReferences: {
			[sourceId]: {
				id: sourceId,
				provider: "openstreetmap",
				acquiredAt: snapshot?.acquiredAt ?? null,
				contentIdentity: snapshot?.contentIdentity ?? null,
				snapshot: snapshot
					? {
							status: "embedded",
							format: snapshot.format,
							data: JSON.parse(JSON.stringify(snapshot)),
						}
					: {
							status: "unavailable",
							reason:
								"Injected semantic import inputs did not include an original provider snapshot",
						},
			},
		},
		baselineRevisions: {
			"baseline-1": {
				id: "baseline-1",
				parentRevisionId: null,
				acceptedAt: input.acceptedAt,
				sourceReferenceIds: [sourceId],
				roads: {},
				features: {},
				propertyEvidence: {},
				diagnostics,
				resolutionEvidence: JSON.parse(
					JSON.stringify({
						normalization: result.normalization ?? null,
						movements: result.movementEvidence ?? null,
						sourceTopology: result.sourceTopology ?? null,
						sections,
						inventory: inventory.report,
						terrain: result.terrainEvidence ?? null,
						context: result.context ?? null,
					}),
				),
			},
		},
		activeBaselineRevisionId: "baseline-1",
		scenarios: {},
		activeScenarioId: null,
	});
	const baseline = project.baselineRevisions["baseline-1"]!;
	result.graphs.forEach((graph, index) => {
		// Components have disjoint source edges. Anchor identity to one exact edge,
		// rather than embedding every edge ID into every property/claim identity.
		// The latter grows evidence quadratically for dense connected networks.
		const anchor = Object.keys(graph.edges).sort()[0];
		if (!anchor) throw Error("Imported component has no source edges");
		const id = `road:${anchor}`;
		if (Object.hasOwn(baseline.roads, id))
			throw Error("Duplicate semantic component identity");
		const network = RoadNetworkNode.parse({
			...graph,
			id: `road-network_baseline-${index}`,
			applyStyleToAll: false,
			regionalPack: sections.policy.id,
			osmMappedSurfaces: inventory.surfacesByGraph[index],
			osmCrossings: inventory.crossingsByGraph[index],
			osmLaneConnectivity: (result.laneConnectivity ?? []).filter((relation) =>
				relation.members.some(
					(member) =>
						member.type === "way" &&
						Object.values(graph.edges).some(
							(edge) => edge.osmSource?.wayId === member.ref,
						),
				),
			),
		});
		const road = adaptResolvedCurrentRoad({
			id,
			network,
			origin: "imported",
			sourceReferenceIds: [sourceId],
			sectionReport: sections,
			coordinateFrameId: frame.id,
		});
		baseline.roads[id] = road;
		addSectionEvidence(baseline, road, sourceId);
	});
	for (const asset of result.assets) {
		const id = `asset:${asset.sourceId}`;
		baseline.features[id] = {
			id,
			kind: "point-asset",
			origin: "imported",
			sourceReferenceIds: [sourceId],
			sourceFeatureId: asset.sourceId,
			representation: "osm-import-v1",
			data: JSON.parse(JSON.stringify(asset)),
		};
	}
	return parseStreetProject(project);
}

/** Current renderer compatibility inputs are compiled from resolved property values. */
export function readImportedBaselineNetworks(project: StreetProject) {
	const baselineId = project.activeBaselineRevisionId;
	return Object.keys(project.baselineRevisions[baselineId]!.roads).map(
		(id) => ({
			roadId: id,
			network: readResolvedCurrentRoad(
				project,
				baselineId,
				id,
				project.activeScenarioId,
			),
		}),
	);
}

/** Gate G1 entry point: embedded snapshots resolve without any network request. */
export async function resolveOsmSnapshotBaseline(input: {
	snapshot: OsmSourceSnapshot;
	center: GeoPoint;
	radiusMeters: number;
	policy: StreetRegionalPolicy;
	acceptedAt: string;
}) {
	const snapshot = await parseOsmSourceSnapshot(input.snapshot);
	const { prepareOsmStreetImport, completeOsmStreetImport } = await import(
		"./osm-import"
	);
	const prepared = await prepareOsmStreetImport(
		input.center,
		input.radiusMeters,
		{
			loadAcquisition: async () =>
				JSON.parse(JSON.stringify(snapshot.acquisition)),
			loadTerrain: false,
		},
	);
	const result = await completeOsmStreetImport({
		...prepared,
		regionalPolicy: input.policy,
	});
	return createImportedStreetProject(result, { acceptedAt: input.acceptedAt });
}
