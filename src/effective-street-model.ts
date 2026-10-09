import {
	parseStreetProject,
	type StreetProject,
} from "./domain/street-project";
import { resolveStreetFeatureData } from "./domain/street-resolution";
import { readResolvedCurrentRoad } from "./street-project-compatibility";
import { compileStreet } from "./street-compiler";
import { compileProjectLaneMovements } from "./lane-movement-graph";
import type { TerrainField } from "./terrain-field-compat";

/** Detached, disposable compiler input. The project document remains the sole owner. */
export function resolveEffectiveStreetModel(
	input: StreetProject,
	baselineId: string,
	scenarioId: string | null = null,
) {
	const project = parseStreetProject(input);
	const baseline = project.baselineRevisions[baselineId];
	if (!baseline) throw Error("Unknown baseline revision");
	if (
		scenarioId !== null &&
		project.scenarios[scenarioId]?.baselineRevisionId !== baselineId
	)
		throw Error("Scenario must reference the requested baseline");
	const scenario = scenarioId === null ? null : project.scenarios[scenarioId]!;
	const suppressedAssetNodeIds = new Set(
		Object.values(scenario?.inventorySuppressions ?? {}).flatMap((s) => {
			if (s.target.category !== "attachments") return [];
			const road = baseline.roads[s.target.roadId]!;
			const attachment = (
				road.data.attachments as Record<string, { assetNodeId: string }>
			)[s.target.itemId];
			return attachment ? [attachment.assetNodeId] : [];
		}),
	);
	const suppressedFeatures = new Set(
		Object.values(scenario?.inventorySuppressions ?? {}).flatMap((s) =>
			s.target.category === "features" ? [s.target.featureId] : [],
		),
	);
	for (const feature of Object.values(baseline.features))
		if (suppressedAssetNodeIds.has(String(feature.data.id ?? feature.id)))
			suppressedFeatures.add(feature.id);
	return {
		baselineRevisionId: baselineId,
		scenarioId,
		roads: Object.fromEntries(
			Object.keys(baseline.roads).map((id) => [
				id,
				readResolvedCurrentRoad(project, baselineId, id, scenarioId),
			]),
		),
		features: Object.fromEntries(
			Object.values(baseline.features)
				.filter((f) => !suppressedFeatures.has(f.id))
				.map((f) => [
					f.id,
					{
						...f,
						data: resolveStreetFeatureData(
							project,
							baselineId,
							"features",
							f.id,
							scenarioId,
						),
					},
				]),
		),
		suppressedFeatureIds: [...suppressedFeatures],
		suppressedAssetNodeIds: [...suppressedAssetNodeIds],
	};
}
export function compileStreetProject(
	input: StreetProject,
	baselineId: string,
	scenarioId: string | null = null,
	terrain: TerrainField | null = null,
) {
	const effective = resolveEffectiveStreetModel(input, baselineId, scenarioId);
	const movements = compileProjectLaneMovements({
		...parseStreetProject(input),
		activeBaselineRevisionId: baselineId,
		activeScenarioId: scenarioId,
	});
	return {
		effective,
		roads: Object.fromEntries(
			Object.entries(effective.roads).map(([id, road]) => [
				id,
				compileStreet(road, terrain, movements),
			]),
		),
	};
}
