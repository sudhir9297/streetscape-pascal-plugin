import {
	StreetSectionDesign,
	StreetInventorySuppression,
	streetInventoryItemId,
	streetInventoryTargetId,
	streetSectionDesignId,
} from "./street-scenario";
import { StreetSectionLayout } from "./street-section-layout";
import { LaneMovementDecision } from "./lane-movement";
import { ResolvedStreetRoadData } from "./resolved-street-road";
import { BaselineDiagnosticReport } from "./baseline-diagnostics";
import { z } from "zod";
import { SiteFrame } from "./site-frame";
import {
	StreetObservation,
	StreetPropertyEvidence,
	StreetDesignOverride,
	hasStreetPropertyPath,
} from "./street-evidence";

export const STREET_PROJECT_FORMAT = "streetscape-project" as const;
export const STREET_PROJECT_VERSION = 1 as const;
const Id = z
	.string()
	.min(1)
	.refine(
		(value) => value.trim() === value,
		"IDs must not contain surrounding whitespace",
	);
const JsonObject = z.record(z.string(), z.json());
const SourceIds = z
	.array(Id)
	.refine(
		(ids) => new Set(ids).size === ids.length,
		"Source reference IDs must be unique",
	);

/** Availability is explicit: an old scene cannot supply a missing raw snapshot. */
export const StreetSourceReference = z.strictObject({
	id: Id,
	provider: z.string().min(1),
	acquiredAt: z.iso.datetime({ offset: true }).nullable(),
	contentIdentity: z.string().min(1).nullable(),
	snapshot: z.discriminatedUnion("status", [
		z.strictObject({
			status: z.literal("unavailable"),
			reason: z.string().min(1),
		}),
		z.strictObject({
			status: z.literal("embedded"),
			format: z.string().min(1),
			data: z.json(),
		}),
		z.strictObject({
			status: z.literal("external"),
			format: z.string().min(1),
			uri: z.url(),
		}),
	]),
});
export type StreetSourceReference = z.infer<typeof StreetSourceReference>;

const Origin = z.enum(["imported", "authored", "legacy-authored"]);

/** Legacy payloads remain readable; new baselines use resolved semantic data. */
export const StreetRoad = z
	.strictObject({
		id: Id,
		origin: Origin,
		sourceReferenceIds: SourceIds,
		representation: z.enum(["pascal-road-network-v1", "resolved-street-v1"]),
		data: JsonObject,
	})
	.superRefine((road, context) => {
		if (road.representation === "resolved-street-v1") {
			const result = ResolvedStreetRoadData.safeParse(road.data);
			if (!result.success)
				for (const issue of result.error.issues)
					context.addIssue({ ...issue, path: ["data", ...issue.path] });
		}
	});
export type StreetRoad = z.infer<typeof StreetRoad>;

export const StreetFeature = z.strictObject({
	id: Id,
	kind: z.enum([
		"point-asset",
		"mapped-surface",
		"crossing",
		"lane-connectivity",
		"scene-asset",
	]),
	origin: Origin,
	sourceReferenceIds: SourceIds,
	sourceFeatureId: z.string().min(1).nullable(),
	representation: z.enum(["osm-import-v1", "pascal-scene-node-v1"]),
	data: JsonObject,
});
export type StreetFeature = z.infer<typeof StreetFeature>;

export const StreetBaselineRevision = z.strictObject({
	id: Id,
	parentRevisionId: Id.nullable(),
	acceptedAt: z.iso.datetime({ offset: true }),
	sourceReferenceIds: SourceIds,
	roads: z.record(Id, StreetRoad),
	features: z.record(Id, StreetFeature),
	propertyEvidence: z.record(Id, StreetPropertyEvidence).optional(),
	diagnostics: BaselineDiagnosticReport.optional(),
	resolutionEvidence: JsonObject.optional(),
	laneMovementDecisions: z.record(Id, LaneMovementDecision).optional(),
});
export type StreetBaselineRevision = z.infer<typeof StreetBaselineRevision>;

/** A proposal against one immutable accepted baseline revision. */
export const StreetScenarioReference = z.strictObject({
	id: Id,
	name: z.string().min(1),
	baselineRevisionId: Id,
	overrides: z.record(Id, StreetDesignOverride).optional(),
	propertyLocks: z.record(Id, StreetDesignOverride).optional(),
	sectionEdits: z.record(Id, StreetSectionDesign).optional(),
	inventorySuppressions: z.record(Id, StreetInventorySuppression).optional(),
});
export type StreetScenarioReference = z.infer<typeof StreetScenarioReference>;

export const StreetProject = z
	.strictObject({
		format: z.literal(STREET_PROJECT_FORMAT),
		schemaVersion: z.literal(STREET_PROJECT_VERSION),
		id: Id,
		name: z.string().min(1),
		revision: z.number().int().nonnegative(),
		// Null means local legacy coordinates are unlocated.
		siteFrameId: Id.nullable(),
		siteFrames: z.record(Id, SiteFrame).default({}),
		sourceReferences: z.record(Id, StreetSourceReference),
		observations: z.record(Id, StreetObservation).optional(),
		baselineRevisions: z.record(Id, StreetBaselineRevision),
		activeBaselineRevisionId: Id,
		scenarios: z.record(Id, StreetScenarioReference),
		activeScenarioId: Id.nullable(),
	})
	.superRefine((project, context) => {
		const issue = (path: (string | number)[], message: string) =>
			context.addIssue({ code: "custom", path, message });
		const checkKeys = (
			records: Record<string, { id: string }>,
			path: string[],
		) => {
			for (const [key, value] of Object.entries(records)) {
				if (key !== value.id)
					issue([...path, key, "id"], "Record key must match its ID");
			}
		};
		checkKeys(project.siteFrames, ["siteFrames"]);
		if (
			project.siteFrameId !== null &&
			!Object.hasOwn(project.siteFrames, project.siteFrameId)
		) {
			issue(["siteFrameId"], "Project site frame does not exist");
		}
		checkKeys(project.sourceReferences, ["sourceReferences"]);
		checkKeys(project.observations ?? {}, ["observations"]);
		for (const [id, observation] of Object.entries(
			project.observations ?? {},
		)) {
			if (
				observation.sourceReferenceId !== null &&
				!Object.hasOwn(project.sourceReferences, observation.sourceReferenceId)
			)
				issue(
					["observations", id, "sourceReferenceId"],
					"Observation source reference does not exist",
				);
		}
		checkKeys(project.baselineRevisions, ["baselineRevisions"]);
		checkKeys(project.scenarios, ["scenarios"]);
		if (
			!Object.hasOwn(
				project.baselineRevisions,
				project.activeBaselineRevisionId,
			)
		) {
			issue(
				["activeBaselineRevisionId"],
				"Active baseline revision does not exist",
			);
		}
		for (const [id, baseline] of Object.entries(project.baselineRevisions)) {
			checkKeys(baseline.laneMovementDecisions ?? {}, [
				"baselineRevisions",
				id,
				"laneMovementDecisions",
			]);
			const path = ["baselineRevisions", id];
			checkKeys(baseline.roads, [...path, "roads"]);
			checkKeys(baseline.features, [...path, "features"]);
			for (const sourceId of baseline.sourceReferenceIds) {
				if (!Object.hasOwn(project.sourceReferences, sourceId))
					issue(
						[...path, "sourceReferenceIds"],
						`Unknown source reference: ${sourceId}`,
					);
			}
			for (const category of ["roads", "features"] as const) {
				for (const [featureId, feature] of Object.entries(baseline[category])) {
					if (category === "features" && baseline.roads[featureId]) {
						issue(
							[...path, category, featureId],
							"Road and feature IDs must be distinct within a baseline",
						);
					}
					if (
						feature.origin === "imported" &&
						feature.sourceReferenceIds.length === 0
					) {
						issue(
							[...path, category, featureId, "sourceReferenceIds"],
							"Imported content requires a source reference",
						);
					}
					if (
						category === "roads" &&
						feature.representation === "resolved-street-v1"
					) {
						const frameId = feature.data.coordinateFrameId;
						if (
							frameId !== null &&
							(typeof frameId !== "string" ||
								!Object.hasOwn(project.siteFrames, frameId))
						)
							issue(
								[...path, category, featureId, "data", "coordinateFrameId"],
								"Road coordinate frame does not exist",
							);
					}
					for (const sourceId of feature.sourceReferenceIds) {
						if (!baseline.sourceReferenceIds.includes(sourceId)) {
							issue(
								[...path, category, featureId, "sourceReferenceIds"],
								`Source reference is not part of the baseline: ${sourceId}`,
							);
						}
					}
				}
			}
			checkKeys(baseline.propertyEvidence ?? {}, [...path, "propertyEvidence"]);
			const targets = new Set<string>();
			type TargetBranch = { owned: boolean; children: Map<string | number, TargetBranch> };
			const targetRoots = new Map<string, TargetBranch>();
			for (const [propertyId, property] of Object.entries(
				baseline.propertyEvidence ?? {},
			)) {
				const propertyPath = [...path, "propertyEvidence", propertyId];
				const target =
					baseline[property.target.category][property.target.featureId];
				if (
					!target ||
					!hasStreetPropertyPath(target.data, property.target.path)
				)
					issue(
						[...propertyPath, "target"],
						"Evidence target must reference an existing data property",
					);
				const targetKey = JSON.stringify(property.target);
				if (targets.has(targetKey))
					issue(
						[...propertyPath, "target"],
						"Only one evidence record may own a property",
					);
				targets.add(targetKey);
				// Index typed paths instead of comparing every pair in dense networks.
				const rootKey = JSON.stringify([property.target.category, property.target.featureId]);
				const root = targetRoots.get(rootKey) ?? { owned: false, children: new Map<string | number, TargetBranch>() };
				targetRoots.set(rootKey, root);
				let branch: TargetBranch = root;
				let overlaps = branch.owned;
				for (const token of property.target.path) {
					let child: TargetBranch | undefined = branch.children.get(token);
					if (!child) {
						child = { owned: false, children: new Map() };
						branch.children.set(token, child);
					}
					branch = child;
					overlaps ||= branch.owned;
				}
				if (overlaps || branch.children.size > 0)
					issue([...propertyPath, "target"], "Evidence targets must not overlap");
				branch.owned = true;
				checkKeys(property.claims, [...propertyPath, "claims"]);
				const checkObservations = (ids: string[], at: (string | number)[]) => {
					for (const observationId of ids) {
						const observation = project.observations?.[observationId];
						if (
							!observation ||
							!Object.hasOwn(project.observations ?? {}, observationId)
						)
							issue(at, `Unknown observation: ${observationId}`);
						else if (
							observation.imagery &&
							observation.imagery.status !== "accepted"
						)
							issue(
								at,
								"Imagery observation must be explicitly accepted before correcting the baseline",
							);
						else if (
							observation.sourceReferenceId !== null &&
							!baseline.sourceReferenceIds.includes(
								observation.sourceReferenceId,
							)
						)
							issue(at, "Observation source is not part of the baseline");
					}
				};
				for (const [claimId, claim] of Object.entries(property.claims)) {
					const at = [...propertyPath, "claims", claimId, "origin"];
					if (
						claim.origin.kind === "source" &&
						!baseline.sourceReferenceIds.includes(
							claim.origin.sourceReferenceId,
						)
					)
						issue(at, "Claim source is not part of the baseline");
					if (
						claim.origin.kind === "observed" ||
						claim.origin.kind === "inferred"
					)
						checkObservations(claim.origin.observationIds, at);
					if (claim.origin.kind === "inferred") {
						for (const basisId of claim.origin.basisClaimIds)
							if (!Object.hasOwn(property.claims, basisId))
								issue(at, `Unknown basis claim: ${basisId}`);
						const visiting = new Set<string>();
						const visit = (currentId: string): boolean => {
							if (visiting.has(currentId)) return true;
							visiting.add(currentId);
							const origin = property.claims[currentId]?.origin;
							const cycle =
								origin?.kind === "inferred" && origin.basisClaimIds.some(visit);
							visiting.delete(currentId);
							return !!cycle;
						};
						if (visit(claimId))
							issue(at, "Inference claim ancestry contains a cycle");
					}
				}
				const rejected = new Set<string>();
				for (const rejection of property.rejectedClaims) {
					if (!Object.hasOwn(property.claims, rejection.claimId))
						issue(
							[...propertyPath, "rejectedClaims"],
							"Rejected claim does not exist",
						);
					if (rejected.has(rejection.claimId))
						issue(
							[...propertyPath, "rejectedClaims"],
							"Claim may only be rejected once",
						);
					rejected.add(rejection.claimId);
				}
				if (property.accepted.kind === "claim") {
					if (!Object.hasOwn(property.claims, property.accepted.claimId))
						issue(
							[...propertyPath, "accepted"],
							"Accepted claim does not exist",
						);
					if (rejected.has(property.accepted.claimId))
						issue(
							[...propertyPath, "accepted"],
							"A rejected claim cannot be accepted",
						);
				} else {
					checkObservations(property.accepted.observationIds, [
						...propertyPath,
						"accepted",
					]);
					if (
						property.accepted.supersedesClaimId !== null &&
						!Object.hasOwn(property.claims, property.accepted.supersedesClaimId)
					)
						issue(
							[...propertyPath, "accepted"],
							"Superseded claim does not exist",
						);
				}
			}
			const seen = new Set([id]);
			let parent = baseline.parentRevisionId;
			while (parent !== null) {
				if (seen.has(parent)) {
					issue(
						[...path, "parentRevisionId"],
						"Baseline revision ancestry contains a cycle",
					);
					break;
				}
				seen.add(parent);
				const ancestor = project.baselineRevisions[parent];
				if (!ancestor || !Object.hasOwn(project.baselineRevisions, parent)) {
					issue(
						[...path, "parentRevisionId"],
						`Unknown parent revision: ${parent}`,
					);
					break;
				}
				parent = ancestor.parentRevisionId;
			}
		}
		for (const [id, scenario] of Object.entries(project.scenarios)) {
			for (const propertyId of [
				...Object.keys(scenario.overrides ?? {}),
				...Object.keys(scenario.propertyLocks ?? {}),
			]) {
				if (
					!Object.hasOwn(
						project.baselineRevisions[scenario.baselineRevisionId]
							?.propertyEvidence ?? {},
						propertyId,
					)
				)
					issue(
						["scenarios", id, "overrides", propertyId],
						"Scenario override requires a property in its baseline",
					);
			}

			const scenarioBaseline =
				project.baselineRevisions[scenario.baselineRevisionId];
			for (const [key, edit] of Object.entries(scenario.sectionEdits ?? {})) {
				if (
					edit.layout &&
					!StreetSectionLayout.safeParse(edit.layout.value).success
				)
					issue(
						["scenarios", id, "sectionEdits", key, "layout"],
						"Invalid section design layout",
					);
				if (
					edit.style &&
					(!edit.style.value ||
						typeof edit.style.value !== "object" ||
						Array.isArray(edit.style.value))
				)
					issue(
						["scenarios", id, "sectionEdits", key, "style"],
						"Section design style must be an object",
					);
				if (edit.locked && !edit.style)
					issue(
						["scenarios", id, "sectionEdits", key, "locked"],
						"Locked sections require captured style values",
					);

				const data = scenarioBaseline?.roads[edit.roadId]?.data;
				if (
					key !== streetSectionDesignId(edit.roadId, edit.sectionId) ||
					!data ||
					!ResolvedStreetRoadData.safeParse(data).success ||
					!(data.sections as Record<string, unknown>)[edit.sectionId]
				)
					issue(
						["scenarios", id, "sectionEdits", key],
						"Section edit must reference an exact stable baseline section",
					);
			}
			for (const [key, suppression] of Object.entries(
				scenario.inventorySuppressions ?? {},
			)) {
				const target = suppression.target;
				let exists = false;
				if (target.category === "features")
					exists = !!scenarioBaseline?.features[target.featureId];
				else {
					const parsed = ResolvedStreetRoadData.safeParse(
						scenarioBaseline?.roads[target.roadId]?.data,
					);
					if (parsed.success) {
						const items =
							target.category === "attachments"
								? Object.values(parsed.data.attachments)
								: parsed.data.inventory[target.category];
						exists = items.some(
							(item) =>
								streetInventoryItemId(target.category, item) === target.itemId,
						);
					}
				}
				if (key !== streetInventoryTargetId(target) || !exists)
					issue(
						["scenarios", id, "inventorySuppressions", key],
						"Suppression requires an exact baseline inventory identity",
					);
			}
			if (
				!Object.hasOwn(project.baselineRevisions, scenario.baselineRevisionId)
			) {
				issue(
					["scenarios", id, "baselineRevisionId"],
					"Scenario baseline revision does not exist",
				);
			}
		}
		if (project.activeScenarioId !== null) {
			const scenario = project.scenarios[project.activeScenarioId];
			if (
				!scenario ||
				!Object.hasOwn(project.scenarios, project.activeScenarioId)
			)
				issue(["activeScenarioId"], "Active scenario does not exist");
			else if (
				scenario.baselineRevisionId !== project.activeBaselineRevisionId
			) {
				issue(
					["activeScenarioId"],
					"Active scenario must reference the active baseline revision",
				);
			}
		}
	});
export type StreetProject = z.infer<typeof StreetProject>;

/** Parse an object or JSON without fetching sources or writing host scene state. */
export function parseStreetProject(input: unknown): StreetProject {
	let value = input;
	if (typeof input === "string") {
		try {
			value = JSON.parse(input);
		} catch {
			throw new Error("Street project is not valid JSON.");
		}
	}
	if (
		value &&
		typeof value === "object" &&
		"format" in value &&
		value.format === STREET_PROJECT_FORMAT
	) {
		if (
			!("schemaVersion" in value) ||
			value.schemaVersion !== STREET_PROJECT_VERSION
		) {
			throw new Error(
				`Unsupported street project schema version: ${"schemaVersion" in value ? String(value.schemaVersion) : "missing"}. Supported version: ${STREET_PROJECT_VERSION}.`,
			);
		}
	}
	return StreetProject.parse(value);
}

export function serializeStreetProject(project: StreetProject): string {
	return JSON.stringify(parseStreetProject(project), null, 2);
}
