import { expect, test } from "bun:test";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { useScene, clearSceneHistory, type AnyNodeId } from "@pascal-app/core";
import { RoadNetworkNode } from "../schema";
import { createStreetCommandDraft } from "./street-command-draft";
import {
	captureStreetChangePreconditions,
	commitHostStreetChangeSet,
} from "./application-change-set";

test("draft batches coalesce edits without exposing partially created roads", () => {
	const site = SiteNode.parse({
			id: "site_draft",
			children: ["building_draft"],
		}),
		building = BuildingNode.parse({
			id: "building_draft",
			parentId: site.id,
			children: ["level_draft"],
		}),
		level = LevelNode.parse({ id: "level_draft", parentId: building.id });
	useScene.setState({
		nodes: { [site.id]: site, [building.id]: building, [level.id]: level },
		rootNodeIds: [site.id],
		readOnly: false,
	});
	clearSceneHistory();
	const original = useScene.getState().nodes;
	const draft = createStreetCommandDraft(
		original,
		captureStreetChangePreconditions(site.id),
	);
	const road = RoadNetworkNode.parse({
		id: "road-network_draft",
		parentId: level.id,
	});
	draft.createNode(road as never, level.id);
	draft.updateNode(road.id as AnyNodeId, { name: "Final planned name" });
	expect(useScene.getState().nodes).toBe(original);
	expect(useScene.temporal.getState().pastStates).toHaveLength(0);
	const command = draft.finish("draft-test", "Verify detached planning");
	expect(command.create).toHaveLength(1);
	expect(command.update).toHaveLength(0);
	expect(command.create[0]!.node.name).toBe("Final planned name");
	commitHostStreetChangeSet(command);
	expect(useScene.temporal.getState().pastStates).toHaveLength(1);
	useScene.temporal.getState().undo();
	expect(useScene.getState().nodes).toEqual(original);
});

test("draft rejects identity collisions instead of replacing an existing node", () => {
	const state = useScene.getState(),
		draft = createStreetCommandDraft(
			state.nodes,
			captureStreetChangePreconditions(null),
		);
	const old = Object.values(state.nodes)[0]!;
	expect(() => draft.createNode(old, old.id)).toThrow("identity collision");
	expect(state.nodes[old.id]).toBe(old);
});
