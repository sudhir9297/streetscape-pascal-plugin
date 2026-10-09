import { parseStreetProject, type StreetProject } from "./street-project";
import { resolveStreetFeatureData } from "./street-resolution";
import { StreetDesignOverride } from "./street-evidence";
import { StreetSectionLayout } from "./street-section-layout";
import { ResolvedStreetRoadData } from "./resolved-street-road";
import {
	StreetInventoryTarget,
	StreetInventorySuppression,
	streetInventoryTargetId,
	streetSectionDesignId,
} from "./street-scenario";
const authored = (value: unknown, reason: string) =>
	StreetDesignOverride.parse({
		value,
		reason,
		authoredAt: new Date().toISOString(),
	});
function scenarioAt(project: StreetProject, id: string) {
	const scenario = project.scenarios[id];
	if (!scenario) throw Error("Unknown scenario");
	return scenario;
}
export function editStreetScenarioSection(
	input: StreetProject,
	scenarioId: string,
	roadId: string,
	sectionId: string,
	change: { layout?: unknown; style?: unknown },
	reason: string,
) {
	const project = parseStreetProject(input),
		scenario = scenarioAt(project, scenarioId);
	const key = streetSectionDesignId(roadId, sectionId);
	if (scenario.sectionEdits?.[key]?.locked)
		throw Error("Unlock this section before redesigning it");
	const baseline = project.baselineRevisions[scenario.baselineRevisionId]!;
	const section = ResolvedStreetRoadData.parse(baseline.roads[roadId]?.data)
		.sections[sectionId];
	if (!section) throw Error("Unknown stable section");
	for (const propertyId of Object.keys(scenario.propertyLocks ?? {})) {
		const target = baseline.propertyEvidence![propertyId]!.target;
		if (
			target.category === "roads" &&
			target.featureId === roadId &&
			target.path[0] === "sections" &&
			target.path[1] === sectionId &&
			((change.layout !== undefined && target.path[2] === "layout") ||
				(change.style !== undefined && target.path[2] === "style"))
		)
			throw Error("Unlock the section property before redesigning it");
	}
	const edit = { ...scenario.sectionEdits?.[key], roadId, sectionId };
	if (change.layout !== undefined) {
		const layout = StreetSectionLayout.parse(change.layout);
		if (Math.abs(layout.length - section.interval.end) > 1e-6)
			throw Error("Layout length must match the section span");
		edit.layout = authored(layout, reason);
	}
	if (change.style !== undefined) {
		if (
			!change.style ||
			typeof change.style !== "object" ||
			Array.isArray(change.style)
		)
			throw Error("Section style must be an object");
		const allowed = new Set([...Object.keys(section.style), "surfaceMaterial"]);
		if (
			Object.keys(change.style).some((key) => !allowed.has(key) || key === "id")
		)
			throw Error("Only section style fields may be redesigned");
		edit.style = authored(
			{ ...((edit.style?.value ?? {}) as object), ...change.style },
			reason,
		);
	}
	if (!edit.layout && !edit.style)
		throw Error("Specify a section design change");
	scenario.sectionEdits ??= {};
	scenario.sectionEdits[key] = edit;
	project.revision++;
	return parseStreetProject(project);
}
export function setStreetScenarioSectionLock(
	input: StreetProject,
	scenarioId: string,
	roadId: string,
	sectionId: string,
	locked: boolean,
	reason: string,
) {
	const project = parseStreetProject(input),
		scenario = scenarioAt(project, scenarioId),
		key = streetSectionDesignId(roadId, sectionId);
	scenario.sectionEdits ??= {};
	if (locked) {
		const section = ResolvedStreetRoadData.parse(
			resolveStreetFeatureData(
				project,
				scenario.baselineRevisionId,
				"roads",
				roadId,
				scenarioId,
			),
		).sections[sectionId];
		if (!section) throw Error("Unknown stable section");
		scenario.sectionEdits[key] = {
			roadId,
			sectionId,
			style: authored(section.style, reason),
			...(section.layout ? { layout: authored(section.layout, reason) } : {}),
			locked: true,
		};
	} else if (scenario.sectionEdits[key])
		scenario.sectionEdits[key]!.locked = false;
	project.revision++;
	return parseStreetProject(project);
}
export function setStreetScenarioPropertyLock(
	input: StreetProject,
	scenarioId: string,
	propertyId: string,
	locked: boolean,
	reason: string,
) {
	const project = parseStreetProject(input),
		scenario = scenarioAt(project, scenarioId);
	const property =
		project.baselineRevisions[scenario.baselineRevisionId]!.propertyEvidence?.[
			propertyId
		];
	if (!property) throw Error("Unknown stable baseline property");
	scenario.propertyLocks ??= {};
	if (locked) {
		let value: unknown = resolveStreetFeatureData(
			project,
			scenario.baselineRevisionId,
			property.target.category,
			property.target.featureId,
			scenarioId,
		);
		for (const token of property.target.path)
			value = (value as Record<string | number, unknown>)[token];
		scenario.propertyLocks[propertyId] = authored(value, reason);
	} else delete scenario.propertyLocks[propertyId];
	project.revision++;
	return parseStreetProject(project);
}
export function setStreetScenarioInventorySuppression(
	input: StreetProject,
	scenarioId: string,
	targetInput: unknown,
	suppressed: boolean,
	reason: string,
) {
	const project = parseStreetProject(input),
		scenario = scenarioAt(project, scenarioId),
		target = StreetInventoryTarget.parse(targetInput),
		id = streetInventoryTargetId(target);
	scenario.inventorySuppressions ??= {};
	if (suppressed)
		scenario.inventorySuppressions[id] = StreetInventorySuppression.parse({
			target,
			reason,
			authoredAt: new Date().toISOString(),
		});
	else delete scenario.inventorySuppressions[id];
	project.revision++;
	return parseStreetProject(project);
}
