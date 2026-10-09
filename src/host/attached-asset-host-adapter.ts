import { generatedMetadata } from "../domain/generated-item-history";
import { useScene, type AnyNode, type AnyNodeId } from "@pascal-app/core";
import { prepareAttachedAssetEdits } from "./attached-asset-edit";
import { commitHostStreetChangeSet } from "./application-change-set";
import { isAcceptedStreetCommand } from "./street-command-scope";

type Updates = { id: AnyNodeId; data: Partial<AnyNode> }[];
const installations = new WeakMap<object, () => void>();
const installationKey = Symbol.for("pascal:streetscape:asset-host-adapter");
const runtime = useScene as unknown as Record<symbol, (() => void) | undefined>;

/** Synchronous entry-point adapter: reconciliation lands inside the user write. */
export function installAttachedAssetHostAdapter() {
	const existing = installations.get(useScene);
	if (existing) return existing;
	// Replace the prior module installation during hot reload instead of layering wrappers.
	runtime[installationKey]?.();
	const original = useScene.getState();
	const { updateNode, updateNodes, applyNodeChanges, deleteNode } = original;
	const needsDeletion = (ids: readonly AnyNodeId[]) =>
		!isAcceptedStreetCommand() &&
		ids.some(
			(id) =>
				!!(
					useScene.getState().nodes[id] as unknown as {
						roadAttachment?: unknown;
					}
				)?.roadAttachment,
		);
	const needsAdapter = (updates: Updates) =>
		!isAcceptedStreetCommand() &&
		updates.some(({ id, data }) => {
			const node = useScene.getState().nodes[id] as unknown as
				| { type?: string; roadAttachment?: unknown }
				| undefined;
			return Object.keys(data).some((field) =>
				node?.type === "streetscape:road-network"
					? [
							"graphNodes",
							"edges",
							"attachments",
							"junctions",
							"stylePresets",
							"activeStyleId",
							"applyStyleToAll",
							"generatedItemHistory",
							"roadsideItemVisibility",
							"showRoadsideDecorations",
							"roadsideDecorationSpacing",
							"roadsideLampsBothSides",
							"roadsideDecorationSuppressed",
							"roadsideDecorations",
							"roadsideItemSuppressed",
							"roadsideAutoFillEnabled",
						].includes(field)
					: !!node?.roadAttachment &&
						(generatedMetadata(useScene.getState().nodes[id]?.metadata) !==
							null ||
							[
								"position",
								"rotation",
								"width",
								"length",
								"height",
								"diameter",
								"curveAmount",
								"drivewayShape",
								"supportHeight",
							].includes(field)),
			);
		});
	const wrappedUpdateNode: typeof updateNode = (id, data, options) => {
		if (!options && needsAdapter([{ id, data }])) {
			commitHostStreetChangeSet(prepareAttachedAssetEdits([{ id, data }]));
			return;
		}
		updateNode(id, data, options);
	};
	const wrappedUpdateNodes: typeof updateNodes = (updates, options) => {
		if (!options && needsAdapter(updates)) {
			commitHostStreetChangeSet(prepareAttachedAssetEdits(updates));
			return;
		}
		updateNodes(updates, options);
	};
	const wrappedApply: typeof applyNodeChanges = (changes, options) => {
		if (
			!options &&
			(needsAdapter(changes.update ?? []) ||
				needsDeletion(changes.delete ?? []))
		) {
			commitHostStreetChangeSet(
				prepareAttachedAssetEdits(changes.update ?? [], {
					create: changes.create,
					delete: changes.delete,
				}),
			);
			return;
		}
		applyNodeChanges(changes, options);
	};
	const wrappedDeleteNode: typeof deleteNode = (...args) => {
		const [id] = args;
		if (needsDeletion([id])) {
			commitHostStreetChangeSet(
				prepareAttachedAssetEdits([], { delete: [id] }),
			);
			return;
		}
		return deleteNode(...args);
	};
	useScene.setState({
		deleteNode: wrappedDeleteNode,
		updateNode: wrappedUpdateNode,
		updateNodes: wrappedUpdateNodes,
		applyNodeChanges: wrappedApply,
	});
	const dispose = () => {
		const current = useScene.getState();
		useScene.setState({
			...(current.deleteNode === wrappedDeleteNode ? { deleteNode } : {}),
			...(current.updateNode === wrappedUpdateNode ? { updateNode } : {}),
			...(current.updateNodes === wrappedUpdateNodes ? { updateNodes } : {}),
			...(current.applyNodeChanges === wrappedApply
				? { applyNodeChanges }
				: {}),
		});
		installations.delete(useScene);
		if (runtime[installationKey] === dispose) delete runtime[installationKey];
	};
	installations.set(useScene, dispose);
	runtime[installationKey] = dispose;
	return dispose;
}
