import { z } from "zod";
import { StreetDesignOverride } from "./street-evidence";
const Id = z.string().trim().min(1);
export const StreetSectionDesign = z.strictObject({
	roadId: Id,
	sectionId: Id,
	layout: StreetDesignOverride.optional(),
	/** Partial material/style values; unaffected fields inherit. */
	style: StreetDesignOverride.optional(),
	locked: z.boolean().optional(),
});
export type StreetSectionDesign = z.infer<typeof StreetSectionDesign>;
export const StreetInventoryTarget = z.discriminatedUnion("category", [
	z.strictObject({ category: z.literal("features"), featureId: Id }),
	z.strictObject({
		category: z.enum([
			"surfaces",
			"crossings",
			"laneConnectivity",
			"attachments",
		]),
		roadId: Id,
		itemId: Id,
	}),
]);
export type StreetInventoryTarget = z.infer<typeof StreetInventoryTarget>;
export const StreetInventorySuppression = z.strictObject({
	target: StreetInventoryTarget,
	reason: z.string().trim().min(1),
	authoredAt: z.iso.datetime({ offset: true }),
});
/** Stable source identity distinguishes relation/way IDs and multipart surfaces. */
export function streetInventoryItemId(category: string, item: unknown): string {
	const data = item as {
		id: string | number;
		sourceType?: string;
		partIndex?: number;
	};
	return category === "surfaces"
		? JSON.stringify([
				data.sourceType ?? "way",
				String(data.id),
				data.partIndex ?? 0,
			])
		: String(data.id);
}
export function streetInventoryTargetId(target: StreetInventoryTarget): string {
	return target.category === "features"
		? JSON.stringify([target.category, target.featureId])
		: JSON.stringify([target.category, target.roadId, target.itemId]);
}
export function streetSectionDesignId(roadId: string, sectionId: string) {
	return JSON.stringify([roadId, sectionId]);
}
