"use client";

import {
	type AnyNodeId,
	useLiveNodeOverrides,
	useScene,
} from "@pascal-app/core";
import { EDITOR_LAYER, triggerSFX } from "@pascal-app/editor";
import { useViewer } from "@pascal-app/viewer";
import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExtrudeGeometry, Ray, Shape, Vector2, Vector3 } from "three";
import {
	roadTerminalEnds,
	sampleRoadEdgePoints,
	type RoadTerminalEnd,
} from "./road-network-geometry";
import { moveRoadTerminal } from "./road-network-extension-handles";
import type { RoadNetworkNode } from "./schema";
import { acquireRoadHistoryPause } from "./scene-history-pause";
import { useRoadHandleScale } from "./road-handle-scale";
import {
	captureRoadEditPreconditions,
	commitRoadGeometryEdit,
} from "./road-edit-commit";

const HANDLE_OFFSET = 0.68;
const HANDLE_SCALE = 0.65;
const MIN_EDGE_LENGTH = 0.1;
const ARROW_COLOR = "#8381ed";
const ARROW_HOVER_COLOR = "#a5b4fc";
const NO_RAYCAST = () => null;

function swallowNextClick() {
	const swallow = (event: Event) => {
		event.stopPropagation();
		event.preventDefault();
	};
	window.addEventListener("click", swallow, { capture: true, once: true });
	window.setTimeout(
		() => window.removeEventListener("click", swallow, { capture: true }),
		300,
	);
}

function createRoadExtensionArrowGeometry() {
	const shape = new Shape();
	shape.moveTo(0.22, 0);
	shape.lineTo(-0.04, 0.12);
	shape.lineTo(-0.04, 0.035);
	shape.lineTo(-0.2, 0.035);
	shape.lineTo(-0.2, -0.035);
	shape.lineTo(-0.04, -0.035);
	shape.lineTo(-0.04, -0.12);
	shape.closePath();
	const geometry = new ExtrudeGeometry(shape, {
		depth: 0.045,
		bevelEnabled: true,
		bevelThickness: 0.018,
		bevelSize: 0.02,
		bevelSegments: 8,
		curveSegments: 16,
		steps: 1,
	});
	geometry.translate(0, 0, -0.0225);
	geometry.rotateX(-Math.PI / 2);
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return geometry;
}

function closestAxisParameterToRay(
	origin: Vector3,
	direction: Vector3,
	ray: Ray,
): number {
	const originToRay = new Vector3().subVectors(origin, ray.origin);
	const parallel = direction.dot(ray.direction);
	const alongAxis = direction.dot(originToRay);
	const alongRay = ray.direction.dot(originToRay);
	const denominator = 1 - parallel * parallel;
	if (Math.abs(denominator) < 1e-6) return -alongAxis;
	const axisParameter = (parallel * alongRay - alongAxis) / denominator;
	const rayParameter = alongRay + parallel * axisParameter;
	return rayParameter < 0 ? -alongAxis : axisParameter;
}

function terminalRetractionLimit(
	node: RoadNetworkNode,
	terminal: RoadTerminalEnd,
): number {
	const edge = node.edges[terminal.edgeId];
	if (!edge) return 0;
	const points = sampleRoadEdgePoints(node, edge, 48);
	let length = 0;
	for (let index = 1; index < points.length; index++) {
		const previous = points[index - 1]!;
		const point = points[index]!;
		length += Math.hypot(point[0] - previous[0], point[2] - previous[2]);
	}
	return Math.max(0, length - MIN_EDGE_LENGTH);
}

function RoadExtensionArrow({
	node,
	terminal,
}: {
	node: RoadNetworkNode;
	terminal: RoadTerminalEnd;
}) {
	const [hovered, setHovered] = useState(false);
	const cleanupRef = useRef<(() => void) | null>(null);
	const { camera, gl, raycaster } = useThree();
	const handleRef = useRoadHandleScale(HANDLE_SCALE * (hovered ? 1.12 : 1));
	const arrowGeometry = useMemo(createRoadExtensionArrowGeometry, []);

	useEffect(() => () => cleanupRef.current?.(), []);
	useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry]);

	const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
		if (event.button !== 0) return;
		event.stopPropagation();
		setHovered(false);
		cleanupRef.current?.();

		const nodeId = node.id as AnyNodeId;
		const expected = captureRoadEditPreconditions(node);
		const initialNode = node;
		const origin = new Vector3(...terminal.point);
		const direction = new Vector3(
			terminal.direction[0],
			0,
			terminal.direction[1],
		).normalize();
		const initialParameter = closestAxisParameterToRay(
			origin,
			direction,
			event.ray,
		);
		const maximumRetraction = terminalRetractionLimit(initialNode, terminal);
		const pointer = new Vector2();
		const moveRay = new Ray();
		let lastPatch: Pick<RoadNetworkNode, "graphNodes" | "junctions"> | null =
			null;
		const releaseHistory = useScene.temporal.getState().isTracking
			? acquireRoadHistoryPause()
			: () => {};

		useViewer.getState().setInputDragging(true);
		document.body.style.cursor = "ew-resize";
		triggerSFX("sfx:item-pick");

		const clearPreview = () => {
			useLiveNodeOverrides.getState().clear(nodeId);
			useScene.getState().markDirty(nodeId);
		};
		const cleanup = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onCancel);
			window.removeEventListener("blur", onCancel);
			window.removeEventListener("keydown", onKeyDown, true);
			document.body.style.cursor = "";
			useViewer.getState().setInputDragging(false);
			cleanupRef.current = null;
		};
		const onMove = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== event.pointerId) return;
			const rect = gl.domElement.getBoundingClientRect();
			pointer.set(
				((moveEvent.clientX - rect.left) / rect.width) * 2 - 1,
				-((moveEvent.clientY - rect.top) / rect.height) * 2 + 1,
			);
			raycaster.setFromCamera(pointer, camera);
			moveRay.copy(raycaster.ray);
			const currentParameter = closestAxisParameterToRay(
				origin,
				direction,
				moveRay,
			);
			const distance = Math.max(
				-maximumRetraction,
				currentParameter - initialParameter,
			);
			const patch = moveRoadTerminal(initialNode, terminal.nodeId, [
				terminal.point[0] + terminal.direction[0] * distance,
				terminal.point[1],
				terminal.point[2] + terminal.direction[1] * distance,
			]);
			if (!patch) return;
			lastPatch = patch;
			useLiveNodeOverrides.getState().set(nodeId, patch);
			useScene.getState().markDirty(nodeId);
		};
		const onUp = (upEvent: PointerEvent) => {
			if (upEvent.pointerId !== event.pointerId) return;
			releaseHistory();
			try {
				if (lastPatch) {
					commitRoadGeometryEdit(node, lastPatch, expected);
					triggerSFX("sfx:item-place");
				}
			} finally {
				clearPreview();
				swallowNextClick();
				cleanup();
			}
		};
		const onCancel = (cancelEvent?: Event) => {
			if (
				cancelEvent &&
				"pointerId" in cancelEvent &&
				cancelEvent.pointerId !== event.pointerId
			)
				return;
			releaseHistory();
			clearPreview();
			cleanup();
		};
		const onKeyDown = (keyEvent: KeyboardEvent) => {
			if (
				keyEvent.key !== "Escape" &&
				!(
					(keyEvent.metaKey || keyEvent.ctrlKey) &&
					keyEvent.key.toLowerCase() === "z"
				)
			)
				return;
			keyEvent.preventDefault();
			keyEvent.stopImmediatePropagation();
			onCancel();
		};

		cleanupRef.current = onCancel;
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onCancel);
		window.addEventListener("blur", onCancel);
		window.addEventListener("keydown", onKeyDown, true);
	};

	return (
		<group
			layers={EDITOR_LAYER}
			position={[
				terminal.point[0] + terminal.direction[0] * HANDLE_OFFSET,
				terminal.point[1] + 0.16,
				terminal.point[2] + terminal.direction[1] * HANDLE_OFFSET,
			]}
			rotation={[0, -terminal.angle, 0]}
			ref={handleRef}
		>
			<mesh geometry={arrowGeometry} raycast={NO_RAYCAST} renderOrder={1010}>
				<meshBasicMaterial
					color={hovered ? ARROW_HOVER_COLOR : ARROW_COLOR}
					depthTest={false}
					depthWrite={false}
				/>
			</mesh>
			<mesh
				onPointerDown={onPointerDown}
				onPointerEnter={() => {
					document.body.style.cursor = "ew-resize";
					setHovered(true);
				}}
				onPointerLeave={() => {
					if (!cleanupRef.current) document.body.style.cursor = "";
					setHovered(false);
				}}
			>
				<boxGeometry args={[0.52, 0.12, 0.32]} />
				<meshBasicMaterial depthWrite={false} opacity={0} transparent />
			</mesh>
		</group>
	);
}

export function RoadNetworkExtensionControls({
	node,
}: {
	node: RoadNetworkNode;
}) {
	return roadTerminalEnds(node).map((terminal) => (
		<RoadExtensionArrow key={terminal.nodeId} node={node} terminal={terminal} />
	));
}
