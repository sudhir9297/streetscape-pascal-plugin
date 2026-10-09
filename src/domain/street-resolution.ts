import { ResolvedStreetRoadData } from "./resolved-street-road";
import { StreetSectionLayout } from "./street-section-layout";
import {
	streetSectionDesignId,
	streetInventoryItemId,
} from "./street-scenario";
import { parseStreetProject, type StreetProject } from "./street-project";
import {
	StreetBaselineCorrection,
	StreetDesignOverride,
	type StreetPropertyEvidence,
} from "./street-evidence";

function propertyAt(
	project: StreetProject,
	baselineId: string,
	propertyId: string,
): StreetPropertyEvidence {
	const property =
		project.baselineRevisions[baselineId]?.propertyEvidence?.[propertyId];
	if (
		!property ||
		!Object.hasOwn(
			project.baselineRevisions[baselineId]?.propertyEvidence ?? {},
			propertyId,
		)
	)
		throw new Error(`Unknown baseline property: ${baselineId}/${propertyId}`);
	return property;
}

function resolveProperty(
	project: StreetProject,
	baselineId: string,
	propertyId: string,
	scenarioId: string | null,
) {
	const property = propertyAt(project, baselineId, propertyId);
	const accepted =
		property.accepted.kind === "claim"
			? {
					value: property.claims[property.accepted.claimId]!.value,
					origin: property.claims[property.accepted.claimId]!.origin,
					claimId: property.accepted.claimId,
				}
			: {
					value: property.accepted.value,
					origin: property.accepted,
					claimId: null,
				};
	const scenario = scenarioId === null ? null : project.scenarios[scenarioId];
	if (
		scenarioId !== null &&
		(!scenario || scenario.baselineRevisionId !== baselineId)
	)
		throw new Error("Scenario must reference the requested baseline");
	const design =
		scenario?.overrides && Object.hasOwn(scenario.overrides, propertyId)
			? scenario.overrides[propertyId]!
			: null;
	return {
		propertyId,
		target: property.target,
		units: property.units,
		claims: property.claims,
		rejectedClaims: property.rejectedClaims,
		accepted,
		design,
		lock: scenario?.propertyLocks?.[propertyId] ?? null,
		effectiveValue: scenario?.propertyLocks?.[propertyId]
			? scenario.propertyLocks[propertyId]!.value
			: design === null
				? accepted.value
				: design.value,
	};
}

/** No scenario is applied implicitly: callers choose a baseline and optional proposal. */
export function resolveStreetProperty(
	input: StreetProject,
	baselineId: string,
	propertyId: string,
	scenarioId: string | null = null,
) {
	return resolveProperty(
		parseStreetProject(input),
		baselineId,
		propertyId,
		scenarioId,
	);
}

/** Validate once when an inspector resolves many properties from the same document. */
export function resolveStreetProperties(
	input: StreetProject,
	baselineId: string,
	scenarioId: string | null = null,
) {
	const project = parseStreetProject(input);
	const baseline = project.baselineRevisions[baselineId];
	if (!baseline) throw new Error(`Unknown baseline: ${baselineId}`);
	return Object.keys(baseline.propertyEvidence ?? {}).map((id) =>
		resolveProperty(project, baselineId, id, scenarioId),
	);
}

/** Compile evidence-backed values into a detached compatibility payload. */
export function resolveStreetFeatureData(
	input: StreetProject,
	baselineId: string,
	category: "roads" | "features",
	featureId: string,
	scenarioId: string | null = null,
) {
	const project = parseStreetProject(input);
	const baseline = project.baselineRevisions[baselineId];
	const feature = baseline?.[category][featureId];
	if (!feature) throw new Error(`Unknown baseline feature: ${featureId}`);
	if (
		scenarioId !== null &&
		project.scenarios[scenarioId]?.baselineRevisionId !== baselineId
	)
		throw new Error("Scenario must reference the requested baseline");
	const data = structuredClone(feature.data);
	for (const property of Object.values(baseline.propertyEvidence ?? {})) {
		if (
			property.target.category !== category ||
			property.target.featureId !== featureId
		)
			continue;
		const value = resolveProperty(
			project,
			baselineId,
			property.id,
			scenarioId,
		).effectiveValue;
		let parent: unknown = data;
		for (const token of property.target.path.slice(0, -1))
			parent = (parent as Record<string | number, unknown>)[token];
		(parent as Record<string | number, unknown>)[property.target.path.at(-1)!] =
			structuredClone(value);
	}
	const scenario = scenarioId === null ? null : project.scenarios[scenarioId]!;
	if (category === "roads" && feature.representation === "resolved-street-v1") {
		const resolved = ResolvedStreetRoadData.parse(data);
		for (const edit of Object.values(scenario?.sectionEdits ?? {})) {
			if (edit.roadId !== featureId) continue;
			const section = resolved.sections[edit.sectionId]!;
			if (edit.layout)
				section.layout = StreetSectionLayout.parse(edit.layout.value);
			if (edit.style) {
				if (
					!edit.style.value ||
					Array.isArray(edit.style.value) ||
					typeof edit.style.value !== "object"
				)
					throw Error("Section style must be an object");
				section.style = { ...section.style, ...edit.style.value };
			}
		}
		// Explicit pinned values have final precedence over section-level designs.
		for (const [id, lock] of Object.entries(scenario?.propertyLocks ?? {})) {
			const property = baseline.propertyEvidence![id]!;
			if (
				property.target.category !== category ||
				property.target.featureId !== featureId
			)
				continue;
			let parent: unknown = resolved;
			for (const token of property.target.path.slice(0, -1))
				parent = (parent as Record<string | number, unknown>)[token];
			(parent as Record<string | number, unknown>)[
				property.target.path.at(-1)!
			] = structuredClone(lock.value);
		}
		for (const suppression of Object.values(
			scenario?.inventorySuppressions ?? {},
		)) {
			const target = suppression.target;
			if (target.category === "features") {
				const asset = baseline.features[target.featureId]!;
				const assetId = asset.data.id ?? target.featureId;
				for (const [id, attachment] of Object.entries(resolved.attachments))
					if (attachment.assetNodeId === assetId)
						delete resolved.attachments[id];
			} else if (target.roadId === featureId) {
				if (target.category === "attachments") {
					delete resolved.attachments[target.itemId];
				} else
					resolved.inventory[target.category] = resolved.inventory[
						target.category
					].filter(
						(item) =>
							streetInventoryItemId(target.category, item) !== target.itemId,
					);
			}
		}
		return JSON.parse(JSON.stringify(ResolvedStreetRoadData.parse(resolved)));
	}
	return data;
}

/** Acceptance creates a revision; historical baselines and their scenarios stay intact. */
export function acceptStreetBaselineCorrection(
	input: StreetProject,
	change: {
		baselineRevisionId: string;
		nextBaselineRevisionId: string;
		propertyId: string;
		correction: StreetBaselineCorrection;
		rejectClaim?: { claimId: string; reason: string };
	},
): StreetProject {
	const project = parseStreetProject(input);
	if (project.baselineRevisions[change.nextBaselineRevisionId])
		throw new Error("Baseline revision ID already exists");
	const property = propertyAt(
		project,
		change.baselineRevisionId,
		change.propertyId,
	);
	const correction = StreetBaselineCorrection.parse(change.correction);
	const baseline = structuredClone(
		project.baselineRevisions[change.baselineRevisionId]!,
	);
	baseline.id = change.nextBaselineRevisionId;
	baseline.parentRevisionId = change.baselineRevisionId;
	baseline.acceptedAt = correction.acceptedAt;
	baseline.propertyEvidence![change.propertyId] = {
		...property,
		accepted: correction,
		rejectedClaims: change.rejectClaim
			? [...property.rejectedClaims, change.rejectClaim]
			: property.rejectedClaims,
	};
	project.baselineRevisions[baseline.id] = baseline;
	project.activeBaselineRevisionId = baseline.id;
	project.activeScenarioId = null;
	project.revision += 1;
	return parseStreetProject(project);
}

/** A design edit changes only its scenario, never the accepted reconstruction. */
export function setStreetScenarioOverride(
	input: StreetProject,
	scenarioId: string,
	propertyId: string,
	override: StreetDesignOverride | null,
): StreetProject {
	const project = parseStreetProject(input);
	const scenario = project.scenarios[scenarioId];
	if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
	propertyAt(project, scenario.baselineRevisionId, propertyId);
	if (scenario.propertyLocks?.[propertyId])
		throw Error("Unlock this property before changing its design override");
	const target = propertyAt(
		project,
		scenario.baselineRevisionId,
		propertyId,
	).target;
	if (
		target.category === "roads" &&
		target.path[0] === "sections" &&
		typeof target.path[1] === "string" &&
		scenario.sectionEdits?.[
			streetSectionDesignId(target.featureId, target.path[1])
		]?.locked
	)
		throw Error("Unlock this section before changing its design override");
	if (
		target.category === "roads" &&
		target.path[0] === "sections" &&
		typeof target.path[1] === "string"
	) {
		const edit =
			scenario.sectionEdits?.[
				streetSectionDesignId(target.featureId, target.path[1])
			];
		if (
			(target.path[2] === "layout" && edit?.layout) ||
			(target.path[2] === "style" && edit?.style)
		)
			throw Error("Use the section design editor for this property");
	}
	scenario.overrides ??= {};
	if (override === null) delete scenario.overrides[propertyId];
	else scenario.overrides[propertyId] = StreetDesignOverride.parse(override);
	project.revision += 1;
	return parseStreetProject(project);
}
