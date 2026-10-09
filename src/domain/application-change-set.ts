import { z } from "zod";
import { canonicalSourceJson } from "../source/osm-source-snapshot";
const Id = z
	.string()
	.min(1)
	.refine(
		(value) =>
			value.trim() === value &&
			!["__proto__", "prototype", "constructor"].includes(value),
		"Invalid identity",
	);
const Json = z.record(z.string(), z.json());
const Ids = z
	.array(Id)
	.refine((ids) => new Set(ids).size === ids.length, "IDs must be unique");
const Field = z
	.string()
	.min(1)
	.refine(
		(field) =>
			!["id", "type", "__proto__", "constructor", "prototype"].includes(field),
		"Identity and unsafe fields cannot be unset",
	);
export const StreetIdentityReference = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("host-node"), id: Id }),
	z.strictObject({ kind: z.literal("road-edge"), networkId: Id, id: Id }),
	z.strictObject({ kind: z.literal("road-node"), networkId: Id, id: Id }),
	z.strictObject({ kind: z.literal("baseline-road"), siteId: Id, id: Id }),
	z.strictObject({ kind: z.literal("baseline-feature"), siteId: Id, id: Id }),
]);
export type StreetIdentityReference = z.infer<typeof StreetIdentityReference>;
const IdentityRemap = z
	.strictObject({
		from: StreetIdentityReference,
		to: z.array(StreetIdentityReference),
	})
	.superRefine((remap, ctx) => {
		if (remap.to.some((target) => target.kind !== remap.from.kind))
			ctx.addIssue({
				code: "custom",
				message: "Identity remap must preserve entity kind",
			});
		const ids = remap.to.map((target) => canonicalSourceJson(target));
		if (new Set(ids).size !== ids.length)
			ctx.addIssue({
				code: "custom",
				message: "Identity remap targets must be unique",
			});
	});
export const StreetApplicationChangeSet = z
	.strictObject({
		format: z.literal("street-application-change-set"),
		schemaVersion: z.literal(1),
		id: Id,
		reason: z.string().trim().min(1),
		expected: z.strictObject({
			sceneContent: z.string(),
			siteId: Id.nullable(),
			projectId: Id.nullable(),
			documentRevision: z.number().int().nonnegative().nullable(),
		}),
		create: z.array(z.strictObject({ node: Json, parentId: Id.nullable() })),
		update: z.array(
			z.strictObject({ id: Id, data: Json, unset: z.array(Field).default([]) }),
		),
		delete: Ids,
		identityRemaps: z.array(IdentityRemap),
		affectedGeometry: Ids,
	})
	.superRefine((change, ctx) => {
		if (
			(change.expected.projectId === null) !==
			(change.expected.documentRevision === null)
		)
			ctx.addIssue({
				code: "custom",
				message: "Project identity and revision must be supplied together",
			});
		const remapSources = change.identityRemaps.map((remap) =>
			canonicalSourceJson(remap.from),
		);
		if (new Set(remapSources).size !== remapSources.length)
			ctx.addIssue({
				code: "custom",
				message: "Identity remap sources must be unique",
			});
		const seen = new Set<string>();
		for (const id of [
			...change.create.map((op) => op.node.id),
			...change.update.map((op) => op.id),
			...change.delete,
		]) {
			if (typeof id !== "string" || !id.trim())
				ctx.addIssue({
					code: "custom",
					message: "Every operation requires a node ID",
				});
			else if (seen.has(id))
				ctx.addIssue({
					code: "custom",
					message: `Conflicting operations for ${id}`,
				});
			else seen.add(id);
		}
		for (const op of change.update) {
			if (
				new Set(op.unset).size !== op.unset.length ||
				op.unset.some((field) => Object.hasOwn(op.data, field))
			)
				ctx.addIssue({
					code: "custom",
					message: "Unset fields must be unique and cannot also be updated",
				});
			if (Object.hasOwn(op.data, "id") || Object.hasOwn(op.data, "type"))
				ctx.addIssue({
					code: "custom",
					message: "Update cannot change node identity or type",
				});
		}
		if (
			change.expected.siteId === null &&
			(change.expected.projectId !== null ||
				change.expected.documentRevision !== null)
		)
			ctx.addIssue({
				code: "custom",
				message: "Document preconditions require a site owner",
			});
	});
export type StreetApplicationChangeSet = z.infer<
	typeof StreetApplicationChangeSet
>;
export type ApplicationNode = {
	id: string;
	type: string;
	parentId?: string | null;
	children?: string[];
	[key: string]: unknown;
};
export type ApplicationScene = {
	nodes: Record<string, ApplicationNode>;
	rootNodeIds: string[];
};
export class StreetChangeConflict extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StreetChangeConflict";
	}
}
export function streetSceneContent(scene: ApplicationScene) {
	return canonicalSourceJson({
		nodes: scene.nodes,
		rootNodeIds: scene.rootNodeIds,
	});
}

/** Build and validate the entire outgoing graph without mutating persistent state. */
export function prepareStreetApplicationChangeSet(
	scene: ApplicationScene,
	input: StreetApplicationChangeSet,
	options: {
		readDocument: (
			scene: ApplicationScene,
			siteId: string,
		) => { id: string; revision: number } | null;
		parseNode: (node: ApplicationNode) => ApplicationNode;
		identityExists?: (
			scene: ApplicationScene,
			reference: StreetIdentityReference,
		) => boolean;
		validateResult?: (
			before: ApplicationScene,
			next: ApplicationScene,
			changedIds: string[],
		) => void;
	},
) {
	const change = StreetApplicationChangeSet.parse(input);
	if (streetSceneContent(scene) !== change.expected.sceneContent)
		throw new StreetChangeConflict(
			"Scene changed while this operation was being prepared. Preview or edit again.",
		);
	const current =
		change.expected.siteId === null
			? null
			: options.readDocument(scene, change.expected.siteId);
	if (
		(current?.id ?? null) !== change.expected.projectId ||
		(current?.revision ?? null) !== change.expected.documentRevision
	)
		throw new StreetChangeConflict(
			"Street document revision changed. Rebuild the operation against the current baseline.",
		);
	const nodes = { ...scene.nodes },
		rootNodeIds = [...scene.rootNodeIds];
	for (const op of change.create) {
		const id = op.node.id as string;
		if (Object.hasOwn(nodes, id))
			throw Error(`Created node already exists: ${id}`);
		nodes[id] = options.parseNode({
			...op.node,
			parentId: op.parentId,
		} as ApplicationNode);
	}
	for (const op of change.update) {
		const previous = nodes[op.id];
		if (!previous) throw Error(`Updated node does not exist: ${op.id}`);
		const candidate = { ...previous, ...op.data };
		for (const field of op.unset) delete candidate[field];
		nodes[op.id] = options.parseNode(candidate);
	}
	for (const id of change.delete) {
		if (!Object.hasOwn(nodes, id))
			throw Error(`Deleted node does not exist: ${id}`);
		delete nodes[id];
	}
	// Simulate host ownership maintenance so every new or moved node has one parent.
	const touched = new Set([
		...change.create.map((op) => op.node.id as string),
		...change.update.map((op) => op.id),
		...change.delete,
	]);
	for (const id of touched) {
		const oldParent = scene.nodes[id]?.parentId,
			newParent = nodes[id]?.parentId;
		if (oldParent && oldParent !== newParent && nodes[oldParent])
			nodes[oldParent] = {
				...nodes[oldParent]!,
				children: (nodes[oldParent]!.children ?? []).filter(
					(child) => child !== id,
				),
			};
		if (newParent && nodes[newParent])
			nodes[newParent] = {
				...nodes[newParent]!,
				children: [...new Set([...(nodes[newParent]!.children ?? []), id])],
			};
	}
	const roots = rootNodeIds.filter(
		(id) => Object.hasOwn(nodes, id) && nodes[id]!.parentId == null,
	);
	for (const op of change.create)
		if (op.parentId === null) roots.push(op.node.id as string);
	for (const op of change.update)
		if (nodes[op.id]?.parentId == null && !roots.includes(op.id))
			roots.push(op.id);
	const rootSet = new Set(roots);
	for (const [id, node] of Object.entries(nodes)) {
		if (id !== node.id) throw Error("Node key must match its identity");
		if (node.parentId) {
			const parent = nodes[node.parentId];
			if (!parent) throw Error(`Missing parent for ${id}`);
			if (!(parent.children ?? []).includes(id))
				throw Error(`Parent does not own ${id}`);
		} else if (!rootSet.has(id)) throw Error(`Unowned root node: ${id}`);
		for (const childId of node.children ?? [])
			if (!nodes[childId] || nodes[childId]!.parentId !== id)
				throw Error(`Invalid child ownership: ${id} / ${childId}`);
		const visited = new Set([id]);
		let parent = node.parentId;
		while (parent) {
			if (visited.has(parent)) throw Error("Scene parent cycle");
			visited.add(parent);
			parent = nodes[parent]?.parentId;
		}
	}
	for (const id of change.affectedGeometry)
		if (!Object.hasOwn(scene.nodes, id) && !Object.hasOwn(nodes, id))
			throw Error(`Unknown affected geometry: ${id}`);
	for (const remap of change.identityRemaps) {
		if (!options.identityExists)
			throw Error("Identity remap validation requires an entity resolver");
		if (!options.identityExists(scene, remap.from))
			throw Error("Identity remap source does not exist");
		for (const target of remap.to)
			if (
				!options.identityExists(
					{ nodes, rootNodeIds: [...new Set(roots)] },
					target,
				)
			)
				throw Error("Identity remap target does not exist");
	}
	const next = { nodes, rootNodeIds: [...new Set(roots)] };
	options.validateResult?.(scene, next, [...touched]);
	return { change, next };
}
