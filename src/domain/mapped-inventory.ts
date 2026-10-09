import { z } from "zod";
export const MappedAssociationCandidate = z.strictObject({
	id: z.string(),
	graphIndex: z.number().int().nonnegative(),
	edgeIds: z.array(z.string()).min(1),
	distanceMeters: z.number().nonnegative(),
	score: z.number().nonnegative(),
	headingScore: z.number().min(0).max(1),
	overlap: z.number().min(0).max(1),
	side: z.enum(["left", "right", "center"]),
});
export type MappedAssociationCandidate = z.infer<
	typeof MappedAssociationCandidate
>;
export const MappedInventoryReport = z
	.strictObject({
		format: z.literal("mapped-inventory-report"),
		schemaVersion: z.literal(1),
		policyVersion: z.literal(1),
		items: z.array(
			z.strictObject({
				id: z.string(),
				kind: z.enum(["surface", "crossing", "kerb", "point-asset"]),
				source: z.json(),
				status: z.enum(["resolved", "pending", "unmatched", "rejected"]),
				basis: z.enum(["automatic", "manual", "none"]),
				selectedCandidateId: z.string().nullable(),
				candidates: z.array(MappedAssociationCandidate),
				diagnostics: z.array(z.string()),
			}),
		),
	})
	.superRefine((report, context) => {
		const ids = new Set<string>();
		report.items.forEach((item, index) => {
			const issue = (message: string) =>
				context.addIssue({ code: "custom", path: ["items", index], message });
			if (ids.has(item.id)) issue("Mapped feature IDs must be unique");
			ids.add(item.id);
			const candidates = new Set(item.candidates.map((c) => c.id));
			if (candidates.size !== item.candidates.length)
				issue("Candidate IDs must be unique");
			if (
				item.selectedCandidateId !== null &&
				!candidates.has(item.selectedCandidateId)
			)
				issue("Selected candidate must exist");
			if (
				item.status === "resolved" &&
				item.kind !== "point-asset" &&
				item.selectedCandidateId === null
			)
				issue("Resolved association requires a selected corridor");
			if (item.status !== "resolved" && item.selectedCandidateId !== null)
				issue("Unresolved association cannot select a corridor");
		});
	});
export type MappedInventoryReport = z.infer<typeof MappedInventoryReport>;
export type MappedAssociationChoices = Record<string, string | null>;
export function parseMappedInventoryReport(
	value: unknown,
): MappedInventoryReport {
	return MappedInventoryReport.parse(
		typeof value === "string" ? JSON.parse(value) : value,
	);
}
