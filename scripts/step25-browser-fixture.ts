import {
	emitter,
	useScene,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode } from "@pascal-app/core/schema";
import { RoadNetworkNode } from "../src/schema";
import {
	initializeStreetscape,
	disposeStreetscape,
} from "../src/plugin-lifecycle";

export function runStep25BrowserFixture() {
	const original = useScene.getState(),
		history = useScene.temporal.getState();
	const savedHistory = {
		pastStates: history.pastStates,
		futureStates: history.futureStates,
	};
	const checks: Array<{ name: string; passed: boolean }> = [];
	const check = (name: string, passed: boolean) => {
		checks.push({ name, passed });
		if (!passed) throw new Error(name);
	};
	try {
		const road = RoadNetworkNode.parse({
			id: "road-network_lifecycle-browser",
			parentId: "site_lifecycle-browser",
		});
		const { terrainOffset: _, ...legacyRoad } = road;
		const obsolete = {
			id: "legacy_browser",
			type: "streetscape:in-ground-uplight",
			parentId: "site_lifecycle-browser",
			custom: { preserved: "exactly" },
		};
		const site = SiteNode.parse({
			id: "site_lifecycle-browser",
			children: [road.id, obsolete.id],
		});
		const nodes = {
			[site.id]: site,
			[road.id]: legacyRoad,
			[obsolete.id]: obsolete,
		} as unknown as Record<AnyNodeId, AnyNode>;
		initializeStreetscape();
		useScene.getState().setScene(nodes, [site.id as AnyNodeId]);
		check(
			"defaults applied without scene Canvas",
			"terrainOffset" in useScene.getState().nodes[road.id as AnyNodeId]!,
		);
		check(
			"obsolete custom payload retained",
			JSON.stringify(useScene.getState().nodes[obsolete.id as AnyNodeId]) ===
				JSON.stringify(obsolete),
		);
		const first = JSON.stringify(useScene.getState().nodes),
			past = useScene.temporal.getState().pastStates.length;
		useScene.getState().setScene(nodes, [site.id as AnyNodeId]);
		check(
			"second open identical",
			first === JSON.stringify(useScene.getState().nodes),
		);
		check(
			"second open no extra history",
			useScene.temporal.getState().pastStates.length === past,
		);
		const listenerCount = () =>
			(emitter.all as unknown as Map<string, unknown[]>).get(
				"selection:find-node",
			)?.length ?? 0;
		const beforeListeners = listenerCount();
		const dispose = initializeStreetscape(),
			wrapper = useScene.getState().setScene;
		initializeStreetscape();
		dispose();
		check(
			"find listener count unchanged after replacement",
			listenerCount() === beforeListeners,
		);
		check(
			"stale disposer leaves replacement active",
			useScene.getState().setScene !== wrapper,
		);
		check(
			"hot reload preserves scene",
			first === JSON.stringify(useScene.getState().nodes),
		);
		check(
			"hot reload no extra history",
			useScene.temporal.getState().pastStates.length === past,
		);
		disposeStreetscape();
		check(
			"dispose removes catalog listener",
			listenerCount() === beforeListeners - 1,
		);
		return { ok: true, checks };
	} catch (error) {
		return { ok: false, checks, error: String(error) };
	} finally {
		useScene.setState(original);
		useScene.temporal.setState(savedHistory);
		initializeStreetscape();
	}
}
