import { test, expect } from "bun:test";
import { useScene, type AnyNode, type AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode } from "./schema";
import { migrateStreetscapeScene } from "./scene-load-migration";
import { initializeStreetscape, disposeStreetscape } from "./plugin-lifecycle";

test("load migration fills missing defaults once and retains all legacy payloads", () => {
	const road = RoadNetworkNode.parse({ id: "road-network_lifecycle" });
	const { terrainOffset: _, ...legacyRoad } = road;
	const legacy = {
		id: "legacy_uplight",
		type: "streetscape:in-ground-uplight",
		custom: { untouched: true },
	};
	const wire = {
		id: "legacy_wire",
		type: "streetscape:utility-wire-span",
		fromPoleId: "missing",
	};
	const nodes = {
		[road.id]: legacyRoad,
		[legacy.id]: legacy,
		[wire.id]: wire,
	} as unknown as Record<AnyNodeId, AnyNode>;
	const migrated = migrateStreetscapeScene(nodes);
	expect(migrated[road.id as AnyNodeId]).toHaveProperty(
		"terrainOffset",
		road.terrainOffset,
	);
	expect(migrated[legacy.id as AnyNodeId]).toBe(legacy as unknown as AnyNode);
	expect(migrated[wire.id as AnyNodeId]).toBe(wire as unknown as AnyNode);
	expect(nodes[road.id as AnyNodeId]).not.toHaveProperty("terrainOffset");
	expect(migrateStreetscapeScene(migrated)).toBe(migrated);
});

test("lifecycle replaces wrappers, disposes idempotently, preserves history", () => {
	disposeStreetscape();
	const original = useScene.getState().setScene;
	const history = useScene.temporal.getState().pastStates;
	const first = initializeStreetscape();
	const firstWrapper = useScene.getState().setScene;
	const second = initializeStreetscape();
	expect(useScene.getState().setScene).not.toBe(firstWrapper);
	first(); // An obsolete disposer cannot remove the new runtime.
	expect(useScene.getState().setScene).not.toBe(original);
	expect(useScene.temporal.getState().pastStates).toBe(history);
	second();
	second();
	expect(useScene.getState().setScene).toBe(original);
});
