import { test, expect } from "bun:test";
import {
	useScene,
	clearSceneHistory,
	type AnyNode,
	type AnyNodeId,
} from "@pascal-app/core";
import { SiteNode, BuildingNode, LevelNode } from "@pascal-app/core/schema";
import { RoadNetworkNode, StreetLightNode } from "../schema";
import { captureLegacyStreetProject } from "./street-project-store";
import { convertStreetProjectRoads } from "../street-project-compatibility";
import {
	prepareStreetProjectPersistence,
	readStreetProjectFromSite,
} from "./street-project-persistence";
import { prepareAttachedAssetEdits } from "./attached-asset-edit";
import { commitHostStreetChangeSet } from "./application-change-set";

import { prepareImageryAssetCorrection } from "./imagery-asset-correction";
import { createManualImageReference } from "../domain/street-imagery";
function fixture(attached: boolean) {
	const site = SiteNode.parse({
		id: "site_asset-batch",
		children: ["building_asset-batch"],
	});
	const building = BuildingNode.parse({
		id: "building_asset-batch",
		parentId: site.id,
		children: ["level_asset-batch"],
	});
	const level = LevelNode.parse({
		id: "level_asset-batch",
		parentId: building.id,
		children: [
			"road-network_asset-batch",
			"street-light_batch-a",
			"street-light_batch-b",
		],
	});
	const road = RoadNetworkNode.parse({
		id: "road-network_asset-batch",
		parentId: level.id,
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [30, 0, 0] },
		},
		edges: { ab: { id: "ab", startNodeId: "a", endNodeId: "b" } },
		attachments: !attached
			? {}
			: Object.fromEntries(
					["a", "b"].map((id, i) => [
						id,
						{
							id,
							edgeId: "ab",
							assetNodeId: `street-light_batch-${id}`,
							station: 5 + i * 10,
							lateralOffset: 4,
						},
					]),
				),
	});
	const assets = ["a", "b"].map((id, i) =>
		StreetLightNode.parse({
			id: `street-light_batch-${id}`,
			parentId: level.id,
			position: [5 + i * 10, 0, 4],
			roadAttachment: attached
				? { networkNodeId: road.id, attachmentId: id }
				: undefined,
		}),
	);
	useScene.setState({
		nodes: Object.fromEntries(
			[site, building, level, road, ...assets].map((n) => [n.id, n]),
		) as Record<AnyNodeId, AnyNode>,
		rootNodeIds: [site.id],
		readOnly: false,
	});
	const captured = captureLegacyStreetProject(site.id, {
		id: "asset-batch-project",
		name: "Asset batch",
		baselineRevisionId: "original",
		acceptedAt: "2026-10-08T12:00:00Z",
	});
	const project = convertStreetProjectRoads(captured.project);
	const stored = prepareStreetProjectPersistence(useScene.getState(), site.id, {
		project,
		projection: captured.projection,
		expectedRevision: null,
	});
	useScene.getState().applyNodeChanges({
		update: [{ id: site.id, data: { metadata: stored.metadata } }],
	});
	clearSceneHistory();
	return { site, road, assets, project };
}

for (const attached of [false, true])
	test(`imagery lamp correction retains evidence and atomic undo (attached=${attached})`, () => {
		const { site, road, assets } = fixture(attached);
		const stored = readStreetProjectFromSite(
			useScene.getState().nodes[site.id],
		)!;
		const binding = stored.projection.bindings.find(
			(b) => b.category === "features" && b.nodeIds.includes(assets[0]!.id),
		)!;
		const roadBinding = stored.projection.bindings.find(
			(b) => b.category === "roads" && b.nodeIds.includes(road.id),
		)!;
		const image = createManualImageReference({
			id: "image~asset",
			pageUrl: "https://example.org/owned-photo",
			imageUrl: null,
			capturedAt: "2025-08-17",
			location: null,
			locationBasis: "unknown",
			locationAccuracyMeters: null,
			headingDegrees: null,
			panoramic: null,
			creator: { name: "QA photographer", profileUrl: null },
			license: { name: "User owned", url: null },
			acquiredAt: "2026-10-09T06:00:00Z",
			availability: "linked",
			uncertainty: "Approximate authored placement",
		});
		stored.project.observations ??= {};
		stored.project.observations.lamp = {
			id: "lamp",
			description: "Mapped lamp context",
			sourceFeatureId: null,
			sourceReferenceId: null,
			referenceUri: image.pageUrl,
			observedAt: null,
			imagery: {
				format: "imagery-observation",
				schemaVersion: 1,
				status: "accepted",
				image,
				target: {
					roadId: roadBinding.featureId,
					edgeId: "ab",
					assetFeatureId: binding.featureId,
				},
				uncertainty: "Not an image-derived metric coordinate",
				claim: { kind: "lamp-location", locationDescription: "Near frontage" },
				review: {
					reason: "Explicit review",
					reviewedAt: "2026-10-09T06:00:00Z",
					acknowledgedConflicts: true,
				},
			},
		};
		stored.project.revision++;
		const prepared = prepareStreetProjectPersistence(
			useScene.getState(),
			site.id,
			{
				project: stored.project,
				projection: stored.projection,
				expectedRevision: stored.project.revision - 1,
			},
		);
		useScene
			.getState()
			.applyNodeChanges({
				update: [{ id: site.id, data: { metadata: prepared.metadata } }],
			});
		clearSceneHistory();
		const before = useScene.getState().nodes;
		const change = prepareImageryAssetCorrection(
			site.id,
			"lamp",
			{ position: [8, 1, 6] },
			"Explicit authored correction",
		);
		expect(useScene.getState().nodes).toBe(before);
		commitHostStreetChangeSet(change);
		const after = readStreetProjectFromSite(
			useScene.getState().nodes[site.id],
		)!;
		const baseline =
			after.project.baselineRevisions[after.project.activeBaselineRevisionId]!;
		expect(baseline.features[binding.featureId]!.data.position).toEqual([
			8, 1, 6,
		]);
		expect(
			Object.values(baseline.propertyEvidence!).some(
				(p) =>
					p.accepted.kind === "correction" &&
					p.accepted.observationIds.includes("lamp"),
			),
		).toBe(true);
		expect(after.project.observations!.lamp).toEqual(
			stored.project.observations.lamp,
		);
		expect(after.project.baselineRevisions.original).toEqual(
			stored.project.baselineRevisions.original,
		);
		expect(useScene.temporal.getState().pastStates).toHaveLength(1);
		useScene.temporal.getState().undo();
		expect(useScene.getState().nodes).toEqual(before);
		useScene.temporal.getState().redo();
		expect(
			(useScene.getState().nodes[assets[0]!.id as AnyNodeId] as unknown as StreetLightNode)
				.position,
		).toEqual([8, 1, 6]);
	});
