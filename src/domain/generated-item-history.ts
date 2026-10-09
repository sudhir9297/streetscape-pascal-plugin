import { z } from "zod";
const Id = z.string().min(1);
const Pose = z.tuple([z.number(), z.number(), z.number()]);
export const GeneratedItemAcceptance = z.strictObject({
	format: z.literal("street-generated-item-acceptance"),
	schemaVersion: z.literal(1),
	id: Id,
	legacyKeys: z.array(Id).default([]),
	edgeId: Id,
	kind: Id,
	identityStatus: z.enum(["exact", "legacy-unresolved"]).default("exact"),
	assetNodeId: Id.nullable(),
	status: z.enum(["accepted", "suppressed"]),
	position: Pose.nullable(),
	sourceDecisions: z
		.record(
			Id,
			z.strictObject({
				decision: z.enum(["linked", "distinct", "suppressed"]),
				evidence: z.json(),
				decidedAt: z.iso.datetime({ offset: true }),
			}),
		)
		.default({}),
	events: z
		.array(
			z.strictObject({
				kind: z.enum([
					"accepted",
					"edited",
					"suppressed",
					"source-linked",
					"source-distinct",
					"source-suppressed",
				]),
				at: z.iso.datetime({ offset: true }),
				data: z.json(),
			}),
		)
		.min(1),
});
export type GeneratedItemAcceptance = z.infer<typeof GeneratedItemAcceptance>;
export const GeneratedItemHistory = z
	.record(Id, GeneratedItemAcceptance)
	.superRefine((records, ctx) => {
		const assets = new Set<string>();
		for (const [key, item] of Object.entries(records)) {
			if (key !== item.id)
				ctx.addIssue({
					code: "custom",
					message: "Generated acceptance key must match its identity",
				});
			if (item.status === "accepted" && item.assetNodeId) {
				if (assets.has(item.assetNodeId))
					ctx.addIssue({
						code: "custom",
						message:
							"A generated asset cannot own multiple accepted identities",
					});
				assets.add(item.assetNodeId);
			}
		}
	});
export function generatedSlotIdentity(
	rule: string,
	edgeId: string,
	side: string,
	slot: string | number,
) {
	return `roadside-slot~${JSON.stringify([rule, edgeId, side, String(slot)])}`;
}
export function persistedGeneratedKey(key: string) {
	return /^[a-z][a-z0-9+.-]+:[^\s]/i.test(key)
		? `generated-key~${encodeURIComponent(key)}`
		: key;
}
export function persistedGeneratedKind(kind: string) {
	return kind.startsWith("kind~") ? kind : `kind~${kind}`;
}
export function generatedMetadata(
	metadata: unknown,
): { key: string; legacyKey?: string } | null {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		return null;
	const m = metadata as Record<string, unknown>;
	if (
		m.generatedBy !== "road-auto-infrastructure" ||
		typeof m.roadAutoInfrastructureKey !== "string"
	)
		return null;
	return {
		key: persistedGeneratedKey(m.roadAutoInfrastructureKey),
		...(typeof m.roadAutoInfrastructureLegacyKey === "string"
			? { legacyKey: persistedGeneratedKey(m.roadAutoInfrastructureLegacyKey) }
			: {}),
	};
}

export function retainsGeneratedProposal(
	history: Record<string, GeneratedItemAcceptance> | undefined,
	id: string,
	legacyKey: string | undefined,
	edgeId: string,
	kind: string,
) {
	return Object.values(history ?? {}).some(
		(item) =>
			item.id === persistedGeneratedKey(id) ||
			item.legacyKeys.includes(persistedGeneratedKey(id)) ||
			(legacyKey &&
				(item.id === persistedGeneratedKey(legacyKey) ||
					item.legacyKeys.includes(persistedGeneratedKey(legacyKey)))) ||
			(item.identityStatus === "legacy-unresolved" &&
				(item.edgeId === edgeId || item.edgeId === "unlocated") &&
				(persistedGeneratedKind(item.kind) === persistedGeneratedKind(kind) ||
					persistedGeneratedKind(item.kind) ===
						persistedGeneratedKind("legacy-suppression"))),
	);
}
