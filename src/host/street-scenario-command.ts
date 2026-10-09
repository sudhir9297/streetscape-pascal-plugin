import { resolveEffectiveStreetModel } from "../effective-street-model";
import {
	editStreetScenarioSection,
	setStreetScenarioSectionLock,
	setStreetScenarioPropertyLock,
	setStreetScenarioInventorySuppression,
} from "../domain/street-scenario-edits";
import { StreetDesignOverride } from "../domain/street-evidence";
import { useScene, type AnyNode, type AnyNodeId } from "@pascal-app/core";
import {
	parseStreetProject,
	type StreetProject,
} from "../domain/street-project";
import { setStreetScenarioOverride } from "../domain/street-resolution";
import { StreetSectionLayout } from "../domain/street-section-layout";

import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./street-project-persistence";
import { withAcceptedStreetCommand } from "./street-command-scope";

/** Commit mode and its projection together, so a single Undo restores both. */
function changeScenario(
	siteId: string,
	revision: number,
	change: (project: StreetProject) => StreetProject,
) {
	const scene = useScene.getState();
	if (scene.readOnly) throw Error("Scene is read-only");
	const stored = readStreetProjectFromSite(scene.nodes[siteId as AnyNodeId]);
	if (!stored || stored.project.revision !== revision)
		throw Error("Street project revision conflict");
	const project = parseStreetProject(change(structuredClone(stored.project)));
	const effective = resolveEffectiveStreetModel(
		project,
		project.activeBaselineRevisionId,
		project.activeScenarioId,
	);
	const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = [];
	const nodes = { ...scene.nodes };
	for (const binding of stored.projection.bindings.filter(
		(b) => b.category === "roads",
	)) {
		if (binding.nodeIds.length !== 1)
			throw Error("Scenario requires a single road projection binding");
		const id = binding.nodeIds[0]! as AnyNodeId;
		const road = effective.roads[binding.featureId]!;
		const data = {
			graphNodes: road.graphNodes,
			edges: road.edges,
			stylePresets: road.stylePresets,
			activeStyleId: road.activeStyleId,
			attachments: road.attachments,
			applyStyleToAll: road.applyStyleToAll,
			junctions: road.junctions,
			osmMappedSurfaces: road.osmMappedSurfaces,
			osmCrossings: road.osmCrossings,
			osmLaneConnectivity: road.osmLaneConnectivity,
		};
		const patch = data as unknown as Partial<AnyNode>;
		updates.push({ id, data: patch });
		nodes[id] = { ...nodes[id]!, ...patch } as AnyNode;
	}
	for (const binding of stored.projection.bindings.filter(
		(b) => b.category === "features",
	)) {
		const feature = effective.features[binding.featureId];
		for (const nodeId of binding.nodeIds) {
			const id = nodeId as AnyNodeId;
			const visible = feature
				? typeof feature.data.visible === "boolean"
					? feature.data.visible
					: true
				: false;
			const patch = { visible };
			updates.push({ id, data: patch });
			nodes[id] = { ...nodes[id]!, ...patch };
		}
	}

	const prepared = prepareStreetProjectPersistence(
		{ ...scene, nodes },
		siteId,
		{
			project,
			projection: {
				...stored.projection,
				baselineRevisionId: project.activeBaselineRevisionId,
				scenarioId: project.activeScenarioId,
			},
			expectedRevision: revision,
		},
	);
	updates.push({
		id: siteId as AnyNodeId,
		data: { metadata: prepared.metadata },
	});
	withAcceptedStreetCommand(() => scene.applyNodeChanges({ update: updates }));
	return project.activeScenarioId;
}

export function createStreetScenario(
	siteId: string,
	revision: number,
	name: string,
) {
	if (!name.trim()) throw Error("Name the design scenario");
	return changeScenario(siteId, revision, (project) => {
		const id = `scenario:${crypto.randomUUID()}`;
		project.scenarios[id] = {
			id,
			name: name.trim(),
			baselineRevisionId: project.activeBaselineRevisionId,
			overrides: {},
		};
		project.activeScenarioId = id;
		project.revision++;
		return project;
	});
}
export function selectStreetScenario(
	siteId: string,
	revision: number,
	scenarioId: string | null,
) {
	return changeScenario(siteId, revision, (project) => {
		if (scenarioId !== null) {
			const scenario = project.scenarios[scenarioId];
			if (!scenario) throw Error("Unknown design scenario");
			project.activeBaselineRevisionId = scenario.baselineRevisionId;
		}
		project.activeScenarioId = scenarioId;
		project.revision++;
		return project;
	});
}
export function redesignStreetSectionLayout(
	siteId: string,
	revision: number,
	roadId: string,
	sectionId: string,
	input: unknown,
	reason: string,
) {
	const layout = StreetSectionLayout.parse(input);
	return changeScenario(siteId, revision, (project) => {
		if (!project.activeScenarioId)
			throw Error("Select a design scenario first");
		return editStreetScenarioSection(
			project,
			project.activeScenarioId,
			roadId,
			sectionId,
			{ layout },
			reason,
		);
	});
}

/** Evidence-backed width/material properties remain authored design values. */
export function redesignStreetProperty(
	siteId: string,
	revision: number,
	propertyId: string,
	value: unknown,
	reason: string,
) {
	return changeScenario(siteId, revision, (project) => {
		if (!project.activeScenarioId)
			throw Error("Select a design scenario first");
		const property =
			project.baselineRevisions[project.activeBaselineRevisionId]!
				.propertyEvidence?.[propertyId];
		if (!property || property.target.category !== "roads")
			throw Error("Select an evidence-backed road property");
		return setStreetScenarioOverride(
			project,
			project.activeScenarioId,
			propertyId,
			StreetDesignOverride.parse({
				value,
				reason,
				authoredAt: new Date().toISOString(),
			}),
		);
	});
}

export function redesignStreetSectionStyle(
	siteId: string,
	revision: number,
	roadId: string,
	sectionId: string,
	style: unknown,
	reason: string,
) {
	return changeScenario(siteId, revision, (p) => {
		if (!p.activeScenarioId) throw Error("Select a design scenario first");
		return editStreetScenarioSection(
			p,
			p.activeScenarioId,
			roadId,
			sectionId,
			{ style },
			reason,
		);
	});
}
export function lockStreetScenarioSection(
	siteId: string,
	revision: number,
	roadId: string,
	sectionId: string,
	locked: boolean,
	reason: string,
) {
	return changeScenario(siteId, revision, (p) => {
		if (!p.activeScenarioId) throw Error("Select a design scenario first");
		return setStreetScenarioSectionLock(
			p,
			p.activeScenarioId,
			roadId,
			sectionId,
			locked,
			reason,
		);
	});
}
export function lockStreetScenarioProperty(
	siteId: string,
	revision: number,
	propertyId: string,
	locked: boolean,
	reason: string,
) {
	return changeScenario(siteId, revision, (p) => {
		if (!p.activeScenarioId) throw Error("Select a design scenario first");
		return setStreetScenarioPropertyLock(
			p,
			p.activeScenarioId,
			propertyId,
			locked,
			reason,
		);
	});
}
export function suppressStreetScenarioInventory(
	siteId: string,
	revision: number,
	target: unknown,
	suppressed: boolean,
	reason: string,
) {
	return changeScenario(siteId, revision, (p) => {
		if (!p.activeScenarioId) throw Error("Select a design scenario first");
		return setStreetScenarioInventorySuppression(
			p,
			p.activeScenarioId,
			target,
			suppressed,
			reason,
		);
	});
}
