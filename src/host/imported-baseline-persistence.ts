import { BaselineDiagnosticReport } from "../domain/baseline-diagnostics";
import type { AnyNode } from "@pascal-app/core";
import type { OsmImportResult } from "../osm-import";
import { createImportedStreetProject } from "../osm-baseline-bridge";
import {
	parseStreetProject,
	type StreetProject,
} from "../domain/street-project";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
import { captureLegacyStreetProject } from "./street-project-store";
import { convertStreetProjectRoads } from "../street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
	type StreetProjectProjection,
	type PersistenceScene,
} from "./street-project-persistence";

/** Add a new accepted revision without erasing past baselines or captured sources. */
export function mergeImportedBaseline(
	previous: StreetProject,
	incoming: StreetProject,
) {
	const project = parseStreetProject(previous),
		imported = parseStreetProject(incoming);
	if (project.activeScenarioId !== null)
		throw Error("Select the accepted baseline before adding a source import.");
	if (
		project.siteFrameId !== null &&
		canonicalSourceJson(project.siteFrames[project.siteFrameId]) !==
			canonicalSourceJson(imported.siteFrames[imported.siteFrameId!])
	)
		throw Error(
			"Imported baseline must use the existing project coordinate frame.",
		);
	const parent = project.baselineRevisions[project.activeBaselineRevisionId]!,
		next = structuredClone(parent),
		addition = imported.baselineRevisions[imported.activeBaselineRevisionId]!;
	const id = `${parent.id}:import:${project.revision + 1}`;
	if (Object.hasOwn(project.baselineRevisions, id))
		throw Error("Baseline revision identity collision");
	for (const category of ["roads", "features", "propertyEvidence"] as const) {
		const combined = { ...(next[category] ?? {}) };
		for (const [key, value] of Object.entries(addition[category] ?? {})) {
			if (Object.hasOwn(combined, key))
				throw Error(`Imported baseline identity already exists: ${key}`);
			Object.assign(combined, { [key]: value });
		}
		Object.assign(next, { [category]: combined });
	}
	for (const [id, source] of Object.entries(imported.sourceReferences)) {
		if (
			Object.hasOwn(project.sourceReferences, id) &&
			canonicalSourceJson(project.sourceReferences[id]) !==
				canonicalSourceJson(source)
		)
			throw Error("Source reference identity collision");
		project.sourceReferences[id] = source;
	}
	Object.assign(project.siteFrames, imported.siteFrames);
	project.siteFrameId ??= imported.siteFrameId;
	next.id = id;
	next.parentRevisionId = parent.id;
	next.acceptedAt = addition.acceptedAt;
	next.sourceReferenceIds = [
		...new Set([...parent.sourceReferenceIds, ...addition.sourceReferenceIds]),
	];
	const items = [
		...(parent.diagnostics?.items ?? []).map((item) => ({
			...item,
			id: JSON.stringify([parent.id, item.id]),
		})),
		...(addition.diagnostics?.items ?? []).map((item) => ({
			...item,
			id: JSON.stringify([id, item.id]),
		})),
	];
	if (parent.diagnostics || addition.diagnostics)
		next.diagnostics = BaselineDiagnosticReport.parse({
			format: "street-baseline-diagnostics",
			schemaVersion: 1,
			stage: "resolved",
			status: items.some((item) => item.severity === "blocking")
				? "blocked"
				: items.some((item) => item.severity === "review")
					? "review-required"
					: "ready",
			items,
		});
	next.resolutionEvidence = {
		...(parent.resolutionEvidence ?? {}),
		imports: [
			...(Array.isArray(parent.resolutionEvidence?.imports)
				? parent.resolutionEvidence.imports
				: []),
			addition.resolutionEvidence ?? {},
		],
	};
	project.baselineRevisions[id] = next;
	project.activeBaselineRevisionId = id;
	project.revision++;
	return parseStreetProject(project);
}

export function getImportOwnerSite(scene: PersistenceScene, levelId: string) {
	const seen = new Set<string>();
	let id: string | null | undefined = levelId;
	while (id && !seen.has(id)) {
		seen.add(id);
		const node: PersistenceScene["nodes"][string] | undefined = scene.nodes[id];
		if (node?.type === "site" && scene.rootNodeIds.includes(id)) return id;
		id = node?.parentId;
	}
	throw Error(
		"The selected level must belong to a root site to retain its baseline document.",
	);
}

/** Prepare against the complete outgoing scene; caller commits nodes and metadata together. */
export function prepareImportedBaselinePersistence(input: {
	scene: PersistenceScene;
	siteId: string;
	result: OsmImportResult;
	networks: readonly AnyNode[];
	assets: readonly AnyNode[];
	incoming: StreetProject;
	acceptedAt: string;
}) {
	const stored = readStreetProjectFromSite(input.scene.nodes[input.siteId]);
	const captured = stored
		? null
		: captureLegacyStreetProject(input.siteId, {
				id: `streetscape:${input.siteId}`,
				name: "Street baseline",
				baselineRevisionId: "baseline-existing",
				acceptedAt: input.acceptedAt,
			});
	const previous =
		stored?.project ?? convertStreetProjectRoads(captured!.project);
	const project = mergeImportedBaseline(previous, input.incoming);
	const addition =
		input.incoming.baselineRevisions[input.incoming.activeBaselineRevisionId]!;
	const roadIds = Object.keys(addition.roads),
		assetIds = Object.keys(addition.features);
	if (
		roadIds.length !== input.networks.length ||
		assetIds.length !== input.assets.length
	)
		throw Error("Baseline projection count mismatch");
	const bindings: StreetProjectProjection["bindings"] = [
		...(stored?.projection.bindings ?? captured!.projection.bindings),
		...roadIds.map((featureId, index) => ({
			category: "roads" as const,
			featureId,
			nodeIds: [input.networks[index]!.id],
		})),
		...assetIds.map((featureId, index) => ({
			category: "features" as const,
			featureId,
			nodeIds: [input.assets[index]!.id],
		})),
	];
	const outgoing = {
		...input.scene,
		nodes: {
			...input.scene.nodes,
			...Object.fromEntries(
				[...input.networks, ...input.assets].map((node) => [node.id, node]),
			),
		},
	};
	return prepareStreetProjectPersistence(outgoing, input.siteId, {
		project,
		projection: {
			baselineRevisionId: project.activeBaselineRevisionId,
			scenarioId: null,
			bindings,
		},
		expectedRevision: stored?.project.revision ?? null,
	});
}
