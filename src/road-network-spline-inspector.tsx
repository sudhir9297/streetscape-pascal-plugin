"use client";

import { ActionButton, ActionGroup, SliderControl } from "@pascal-app/editor";
import {
	deleteRoadSplinePoints,
	flattenRoadSplinePoints,
	gradeRoadSplinePoints,
	moveRoadSplineEndpoint,
	moveRoadSplinePoint,
	moveRoadSplinePoints,
} from "./road-network-spline-handles";
import type { RoadNetworkNode } from "./schema";
import { useStreetscapeStore } from "./store";
import { createElement } from "react";
import { commitRoadGeometryEdit } from "./road-edit-commit";

/** Host inspector entry point shares the command path with Canvas controls. */
export function RoadSplineCommandEditor(
	props: Parameters<typeof RoadSplinePointEditor>[0],
) {
	return createElement(RoadSplinePointEditor, {
		...props,
		onUpdate: (patch) => commitRoadGeometryEdit(props.node, patch),
	});
}

export function RoadSplinePointEditor({
	node,
	onUpdate,
}: {
	node: RoadNetworkNode;
	onUpdate: (patch: Partial<RoadNetworkNode>) => void;
}) {
	const selection = useStreetscapeStore((state) => state.roadElementSelection);
	if (selection?.networkId !== node.id) {
		return null;
	}

	const selectedIndices =
		selection.kind === "control"
			? (selection.indices ??
				(selection.index === undefined ? [] : [selection.index]))
			: [];
	const referenceIndex = selectedIndices[0] ?? selection.index;

	const point =
		selection.kind === "control" && referenceIndex !== undefined
			? node.edges[selection.id]?.alignment[referenceIndex]
			: selection.kind === "endpoint"
				? node.graphNodes[selection.id]?.position
				: undefined;
	if (!point) {
		return null;
	}

	const updateCoordinate = (axis: 0 | 1 | 2, value: number) => {
		const nextPoint: [number, number, number] = [...point];
		nextPoint[axis] = value;
		const patch =
			selection.kind === "control" && referenceIndex !== undefined
				? selectedIndices.length > 1
					? moveRoadSplinePoints(node, selection.id, selectedIndices, [
							nextPoint[0] - point[0],
							nextPoint[1] - point[1],
							nextPoint[2] - point[2],
						])
					: moveRoadSplinePoint(node, selection.id, referenceIndex, nextPoint)
				: selection.kind === "endpoint"
					? moveRoadSplineEndpoint(node, selection.id, nextPoint)
					: null;
		if (patch) onUpdate(patch);
	};

	const runSelectedPointCommand = (command: "delete" | "flatten" | "grade") => {
		if (selection.kind !== "control" || selectedIndices.length === 0) return;
		const patch =
			command === "delete"
				? deleteRoadSplinePoints(node, selection.id, selectedIndices)
				: command === "flatten"
					? flattenRoadSplinePoints(
							node,
							selection.id,
							selectedIndices,
							point[1],
						)
					: gradeRoadSplinePoints(node, selection.id, selectedIndices);
		if (!patch) return;
		onUpdate(patch);
		if (command === "delete") {
			useStreetscapeStore.getState().setRoadElementSelection({
				networkId: node.id,
				kind: "spline",
				id: node.id,
			});
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<SliderControl
				label="X"
				max={1000}
				min={-1000}
				onChange={(value) => updateCoordinate(0, value)}
				precision={2}
				step={0.01}
				unit="m"
				value={point[0]}
			/>
			<SliderControl
				label="Elevation"
				max={1000}
				min={-1000}
				onChange={(value) => updateCoordinate(1, value)}
				precision={2}
				step={0.01}
				unit="m"
				value={point[1]}
			/>
			<SliderControl
				label="Z"
				max={1000}
				min={-1000}
				onChange={(value) => updateCoordinate(2, value)}
				precision={2}
				step={0.01}
				unit="m"
				value={point[2]}
			/>
			{selection.kind === "control" ? (
				<ActionGroup className="flex-wrap pt-1">
					<ActionButton
						label="Flatten"
						onClick={() => runSelectedPointCommand("flatten")}
						type="button"
					/>
					<ActionButton
						label="Grade"
						onClick={() => runSelectedPointCommand("grade")}
						type="button"
					/>
					<ActionButton
						className="min-w-full text-red-300"
						label={`Delete${selectedIndices.length > 1 ? ` (${selectedIndices.length})` : ""}`}
						onClick={() => runSelectedPointCommand("delete")}
						type="button"
					/>
				</ActionGroup>
			) : null}
		</div>
	);
}
