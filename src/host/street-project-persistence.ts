import { encodeStoredReport, decodeStoredReport } from "../report-storage";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
import { z } from "zod";
import { SiteNode } from "@pascal-app/core/schema";
import {
	assertSupportedStreetProjectVersion,
	parseStreetProject,
	StreetProject,
	type StreetProject as StreetProjectDocument,
} from "../domain/street-project";

export const STREET_PROJECT_METADATA_KEY = "pascal:streetscape-project";
export const DEFAULT_HOST_SCENE_BYTE_LIMIT = 10 * 1024 * 1024;
const Id = z.string().min(1);
export const StreetProjectProjection = z.strictObject({
	baselineRevisionId: Id,
	scenarioId: Id.nullable(),
	bindings: z.array(
		z.strictObject({
			category: z.enum(["roads", "features"]),
			featureId: Id,
			nodeIds: z
				.array(Id)
				.min(1)
				.refine(
					(ids) => new Set(ids).size === ids.length,
					"Projection node IDs must be unique",
				),
		}),
	),
});
export type StreetProjectProjection = z.infer<typeof StreetProjectProjection>;

/** The built-in site is the durable owner; projected roads do not own evidence. */
export const PersistedStreetProject = z
	.strictObject({
		format: z.literal("streetscape-host-document"),
		schemaVersion: z.literal(1),
		project: StreetProject,
		projection: StreetProjectProjection,
	})
	.superRefine((value, context) => {
		const { project, projection } = value;
		if (
			projection.baselineRevisionId !== project.activeBaselineRevisionId ||
			projection.scenarioId !== project.activeScenarioId
		) {
			context.addIssue({
				code: "custom",
				path: ["projection"],
				message: "Projection must reference the active baseline and scenario",
			});
		}
		const baseline = project.baselineRevisions[projection.baselineRevisionId];
		const seen = new Set<string>();
		for (const binding of projection.bindings) {
			const key = `${binding.category}/${binding.featureId}`;
			if (seen.has(key))
				context.addIssue({
					code: "custom",
					path: ["projection", "bindings"],
					message: "Projection feature bindings must be unique",
				});
			seen.add(key);
			if (
				!baseline ||
				!Object.hasOwn(baseline[binding.category], binding.featureId)
			)
				context.addIssue({
					code: "custom",
					path: ["projection", "bindings"],
					message: "Projection feature does not exist in the baseline",
				});
		}
	});
export type PersistedStreetProject = z.infer<typeof PersistedStreetProject>;
export type PersistenceSceneNode = {
	id: string;
	type: string;
	parentId?: string | null;
	metadata?: Record<string, unknown>;
};
export type PersistenceScene = {
	nodes: Record<string, PersistenceSceneNode>;
	rootNodeIds: string[];
};

const viewDocuments = new WeakMap<
	object,
	{ metadata: unknown; document: PersistedStreetProject | null }
>();
function freezeDocument(value: unknown): void {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
	for (const child of Object.values(value)) freezeDocument(child);
	Object.freeze(value);
}

/** Shared immutable view snapshot; commands keep using detached reads below. */
export function readStreetProjectView(
	input: unknown,
): PersistedStreetProject | null {
	if (!input || typeof input !== "object") return readStreetProjectFromSite(input);
	const metadata = (input as PersistenceSceneNode).metadata?.[
		STREET_PROJECT_METADATA_KEY
	];
	const cached = viewDocuments.get(input);
	if (cached && cached.metadata === metadata) return cached.document;
	const document = readStreetProjectFromSite(input);
	freezeDocument(document);
	viewDocuments.set(input, { metadata, document });
	return document;
}

export function readStreetProjectFromSite(
	input: unknown,
): PersistedStreetProject | null {
	const site = SiteNode.parse(input);
	if (!Object.hasOwn(site.metadata, STREET_PROJECT_METADATA_KEY)) return null;
	let value = decodeStoredReport(site.metadata[STREET_PROJECT_METADATA_KEY]);
	// Histories can exceed one report's decoded limit even when each revision
	// and the saved scene remain within their limits. Decode revisions separately.
	if (value && typeof value === "object" && "project" in value) {
		const project = value.project;
		if (project && typeof project === "object" && "baselineRevisions" in project &&
			project.baselineRevisions && typeof project.baselineRevisions === "object") {
			value = { ...value, project: { ...project, baselineRevisions: Object.fromEntries(
				Object.entries(project.baselineRevisions).map(([id, revision]) => [id, decodeStoredReport(revision)]),
			) } };
		}
	}
	if (
		value &&
		typeof value === "object" &&
		"schemaVersion" in value &&
		value.schemaVersion !== 1
	)
		throw new Error(
			`Unsupported Streetscape host document version: ${String(value.schemaVersion)}`,
		);
	if (value && typeof value === "object" && "project" in value)
		assertSupportedStreetProjectVersion(value.project);
	return PersistedStreetProject.parse(value);
}

function belongsToSite(
	scene: PersistenceScene,
	nodeId: string,
	siteId: string,
): boolean {
	const seen = new Set<string>();
	let current: string | null | undefined = nodeId;
	while (current && !seen.has(current)) {
		if (current === siteId) return true;
		seen.add(current);
		current = scene.nodes[current]?.parentId;
	}
	return false;
}

/** Missing projection references are reported; they never erase retained domain data. */
export function inspectStreetProjectProjection(
	scene: PersistenceScene,
	siteId: string,
	document: PersistedStreetProject,
) {
	return document.projection.bindings.flatMap((binding) =>
		binding.nodeIds.flatMap<{
			category: "roads" | "features";
			featureId: string;
			nodeIds: string[];
			nodeId: string;
			status: "missing" | "outside-owner" | "wrong-kind";
		}>((nodeId) => {
			const node = scene.nodes[nodeId];
			if (!node) return [{ ...binding, nodeId, status: "missing" as const }];
			if (!belongsToSite(scene, nodeId, siteId))
				return [{ ...binding, nodeId, status: "outside-owner" as const }];
			if (
				binding.category === "roads" &&
				node.type !== "streetscape:road-network"
			)
				return [{ ...binding, nodeId, status: "wrong-kind" as const }];
			return [];
		}),
	);
}

/** One metadata patch, detached from inputs. Caller commits via the host node action. */
export function prepareStreetProjectPersistence(
	scene: PersistenceScene,
	siteId: string,
	input: {
		project: StreetProjectDocument;
		projection: StreetProjectProjection;
		expectedRevision: number | null;
		maxSceneBytes?: number;
	},
): {
	metadata: Record<string, unknown>;
	document: PersistedStreetProject;
	sceneBytes: number;
} {
	const owner = scene.nodes[siteId];
	if (!owner || owner.type !== "site" || !scene.rootNodeIds.includes(siteId))
		throw new Error("Street project owner must be an existing root site");
	const previous = readStreetProjectFromSite(owner);
	if ((previous?.project.revision ?? null) !== input.expectedRevision)
		throw new Error("Street project revision conflict");
	const project = parseStreetProject(input.project);
	if (previous)
		for (const [id, reference] of Object.entries(
			previous.project.sourceReferences,
		)) {
			if (
				!Object.hasOwn(project.sourceReferences, id) ||
				canonicalSourceJson(project.sourceReferences[id]) !==
					canonicalSourceJson(reference)
			)
				throw Error(`Captured source references are immutable: ${id}`);
		}
	if (previous && previous.project.id !== project.id)
		throw new Error("Site already owns a different street project");
	if (previous && project.revision <= previous.project.revision)
		throw new Error("Street project revision must advance");
	const document = PersistedStreetProject.parse({
		format: "streetscape-host-document",
		schemaVersion: 1,
		project,
		projection: input.projection,
	});
	const problems = inspectStreetProjectProjection(scene, siteId, document);
	if (problems.length)
		throw new Error(
			`Invalid projection reference: ${problems[0]!.nodeId} (${problems[0]!.status})`,
		);
	let storedDocument: string;
	try {
		storedDocument = encodeStoredReport(document);
	} catch (error) {
		if (!(error instanceof Error) || error.message !== "Report exceeds decoded byte limit") throw error;
		storedDocument = encodeStoredReport({ ...document, project: { ...document.project,
			baselineRevisions: Object.fromEntries(Object.entries(document.project.baselineRevisions)
				.map(([id, revision]) => [id, JSON.parse(encodeStoredReport(revision))])),
		} });
	}
	const metadata = {
		...owner.metadata,
		[STREET_PROJECT_METADATA_KEY]: JSON.parse(storedDocument),
	};
	// Measure the entire outgoing graph, not just the document; never silently truncate.
	const sceneBytes = new TextEncoder().encode(
		JSON.stringify({
			...scene,
			nodes: { ...scene.nodes, [siteId]: { ...owner, metadata } },
		}),
	).byteLength;
	const limit = input.maxSceneBytes ?? DEFAULT_HOST_SCENE_BYTE_LIMIT;
	if (!Number.isSafeInteger(limit) || limit <= 0)
		throw new Error("Scene byte limit must be a positive integer");

	if (sceneBytes > limit)
		throw new Error(
			`Street project would make the scene ${sceneBytes} bytes (limit ${limit}); retain large snapshots through durable external references`,
		);
	return { metadata, document, sceneBytes };
}
