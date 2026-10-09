import {initializeProposalPreviewSynchronization} from './proposal-preview-store'
import { acquireSceneHistoryPause, useScene } from "@pascal-app/core";
import { initializeFindSync } from "./find-sync";
import { installAttachedAssetHostAdapter } from "./host/attached-asset-host-adapter";
import { migrateStreetscapeScene } from "./scene-load-migration";

import { commitRoadEdgeDeletion } from "./road-edge-delete-command";
import { RoadNetworkNode } from "./schema";
import { useStreetscapeStore } from "./store";

const key = Symbol.for("pascal:streetscape:plugin-lifecycle");
const runtime = useScene as unknown as Record<symbol, (() => void) | undefined>;

export function disposeStreetscape(): void {
	runtime[key]?.();
}

/** One runtime per shared host store, including across hot module replacement. */
export function initializeStreetscape(): () => void {
	disposeStreetscape();
	const original = useScene.getState().setScene;
	const setScene: typeof original = (nodes, roots, extra) =>
		original(migrateStreetscapeScene(nodes), roots, extra);
	const current = useScene.getState();
	const migrated = migrateStreetscapeScene(current.nodes);
	if (migrated !== current.nodes) {
		const release = acquireSceneHistoryPause(useScene);
		try {
			useScene.setState({ nodes: migrated });
		} finally {
			release();
		}
	}
	useScene.setState({ setScene });
	const disposeFind = initializeFindSync();
 const disposePreview=initializeProposalPreviewSynchronization();
	const disposeAdapter = installAttachedAssetHostAdapter();
	const onDeleteEdge = (event: KeyboardEvent) => {
		const selection = useStreetscapeStore.getState().roadElementSelection;
		if (
			selection?.kind !== "edge" ||
			(event.key !== "Delete" && event.key !== "Backspace")
		)
			return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.isContentEditable ||
				["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
		)
			return;
		const parsed = RoadNetworkNode.safeParse(
			useScene.getState().nodes[
				selection.networkId as keyof typeof current.nodes
			],
		);
		if (!parsed.success || !commitRoadEdgeDeletion(parsed.data, selection.id))
			return;
		event.preventDefault();
		event.stopImmediatePropagation();
		useStreetscapeStore.getState().setRoadElementSelection(null);
	};
	if (typeof window !== "undefined")
		window.addEventListener("keydown", onDeleteEdge, true);
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (typeof window !== "undefined")
			window.removeEventListener("keydown", onDeleteEdge, true);
		disposePreview();
		disposeFind();
		disposeAdapter();
		if (useScene.getState().setScene === setScene)
			useScene.setState({ setScene: original });
		if (runtime[key] === dispose) delete runtime[key];
	};
	runtime[key] = dispose;
	return dispose;
}
