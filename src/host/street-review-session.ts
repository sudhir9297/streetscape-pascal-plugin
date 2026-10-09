import { z } from "zod";

export const StreetReviewState = z.strictObject({
	format: z.literal("streetscape-review-state"),
	schemaVersion: z.literal(1),
	viewMode: z.enum(["2d", "3d", "split"]),
	selection: z.strictObject({
		buildingId: z.string().nullable(),
		levelId: z.string().nullable(),
		zoneId: z.string().nullable(),
		selectedIds: z.array(z.string()).max(1000),
	}),
});
export type StreetReviewState = z.infer<typeof StreetReviewState>;
type Node = { type: string; parentId?: string | null };

/** UI state belongs to this browser/scene, never to an accepted baseline. */
export function createStreetReviewSession(input: {
	sceneId: string;
	storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
	readNodes: () => Record<string, Node>;
	readUi: () => Pick<StreetReviewState, "viewMode" | "selection">;
	applyUi: (state: StreetReviewState) => void;
	subscribeUi: (changed: () => void) => () => void;
}) {
	const key = `pascal:streetscape-review:v1:${encodeURIComponent(input.sceneId)}`;
	let restoring = false;
	const save = () => {
		if (restoring) return;
		try {
			input.storage.setItem(
				key,
				JSON.stringify(
					StreetReviewState.parse({
						format: "streetscape-review-state",
						schemaVersion: 1,
						...input.readUi(),
					}),
				),
			);
		} catch {
			/* Browser preferences are optional when storage is unavailable. */
		}
	};
	const restore = () => {
		try {
			const raw = input.storage.getItem(key);
			if (!raw) return false;
			const state = StreetReviewState.parse(JSON.parse(raw));
			const nodes = input.readNodes();
			const belongs = (id: string, ancestor: string) => {
				const seen = new Set<string>();
				let current: string | null | undefined = id;
				while (current && !seen.has(current)) {
					if (current === ancestor) return true;
					seen.add(current);
					current = nodes[current]?.parentId;
				}
				return false;
			};
			const selection = state.selection;
			if (
				!selection.buildingId ||
				nodes[selection.buildingId]?.type !== "building"
			)
				selection.buildingId = null;
			if (
				!selection.levelId ||
				nodes[selection.levelId]?.type !== "level" ||
				(selection.buildingId &&
					!belongs(selection.levelId, selection.buildingId))
			)
				selection.levelId = null;
			if (
				!selection.zoneId ||
				!nodes[selection.zoneId] ||
				(selection.levelId && !belongs(selection.zoneId, selection.levelId))
			)
				selection.zoneId = null;
			selection.selectedIds = [...new Set(selection.selectedIds)].filter(
				(id) =>
					nodes[id] && (!selection.levelId || belongs(id, selection.levelId)),
			);
			restoring = true;
			try {
				input.applyUi(state);
			} finally {
				restoring = false;
			}
			return true;
		} catch {
			return false;
		}
	};
	return {
		restore,
		subscribe: () => input.subscribeUi(save),
		clear: () => input.storage.removeItem(key),
	};
}
