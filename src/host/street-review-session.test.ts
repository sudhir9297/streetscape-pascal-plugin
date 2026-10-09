import { expect, test } from "bun:test";
import {
	createStreetReviewSession,
	type StreetReviewState,
} from "./street-review-session";

test("review state is scoped, restores after hydration, drops stale selections and never changes the document", () => {
	const values = new Map<string, string>();
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
	};
	const nodes = {
		building: { type: "building" },
		level: { type: "level", parentId: "building" },
		road: { type: "streetscape:road-network", parentId: "level" },
		unrelated: { type: "level" },
	};
	const before = JSON.stringify(nodes);
	let ui: Pick<StreetReviewState, "viewMode" | "selection"> = {
		viewMode: "2d",
		selection: {
			buildingId: "building",
			levelId: "level",
			zoneId: null,
			selectedIds: ["road", "missing", "road", "unrelated"],
		},
	};
	let changed = () => {};
	const session = (sceneId: string) =>
		createStreetReviewSession({
			sceneId,
			storage,
			readNodes: () => nodes,
			readUi: () => ui,
			applyUi: (value) => {
				ui = value;
				changed();
			},
			subscribeUi: (callback) => {
				changed = callback;
				return () => {
					changed = () => {};
				};
			},
		});
	const first = session("first");
	const dispose = first.subscribe();
	changed();
	dispose();
	ui = {
		viewMode: "3d",
		selection: {
			buildingId: null,
			levelId: null,
			zoneId: null,
			selectedIds: [],
		},
	};
	expect(session("second").restore()).toBe(false);
	expect(ui.viewMode).toBe("3d");
	expect(first.restore()).toBe(true);
	expect(ui.viewMode).toBe("2d");
	expect(ui.selection.selectedIds).toEqual(["road"]);
	expect(JSON.stringify(nodes)).toBe(before);
	first.clear();
	expect(first.restore()).toBe(false);
});

test("malformed or unavailable browser preferences never prevent opening an accepted scene", () => {
	let applied = false;
	const session = createStreetReviewSession({
		sceneId: "scene",
		storage: {
			getItem: () => '{"schemaVersion":99}',
			setItem: () => {
				throw Error("quota");
			},
			removeItem: () => {},
		},
		readNodes: () => ({}),
		readUi: () => ({
			viewMode: "3d",
			selection: {
				buildingId: null,
				levelId: null,
				zoneId: null,
				selectedIds: [],
			},
		}),
		applyUi: () => {
			applied = true;
		},
		subscribeUi: (change) => {
			change();
			return () => {};
		},
	});
	expect(session.restore()).toBe(false);
	expect(applied).toBe(false);
	expect(() => session.subscribe()()).not.toThrow();
});
