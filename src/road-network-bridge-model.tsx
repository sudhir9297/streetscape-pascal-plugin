"use client";

import { useEffect, useMemo } from "react";
import {
	BufferGeometry,
	DoubleSide,
	Float32BufferAttribute,
} from "three";
import {
	buildRoadBridgePrismGeometry,
	buildRoadBridgeSpans,
} from "./road-network-bridge";
import type { RoadNetworkNode } from "./schema";

const NO_RAYCAST = () => undefined;

function BridgePrism({
	bottomOffset,
	color,
	lateralOffset = 0,
	name,
	points,
	topOffset,
	width,
}: {
	bottomOffset: number;
	color: string;
	lateralOffset?: number;
	name: string;
	points: Array<readonly [number, number, number]>;
	topOffset: number;
	width: number;
}) {
	const data = useMemo(
		() =>
			buildRoadBridgePrismGeometry(
				points,
				width,
				topOffset,
				bottomOffset,
				lateralOffset,
			),
		[bottomOffset, lateralOffset, points, topOffset, width],
	);
	const geometry = useMemo(() => {
		const result = new BufferGeometry();
		result.setAttribute(
			"position",
			new Float32BufferAttribute(data.positions, 3),
		);
		result.setIndex(data.indices);
		result.computeVertexNormals();
		result.computeBoundingBox();
		result.computeBoundingSphere();
		return result;
	}, [data]);
	useEffect(() => () => geometry.dispose(), [geometry]);
	if (data.positions.length === 0) return null;
	return (
		<mesh
			castShadow
			geometry={geometry}
			name={name}
			raycast={NO_RAYCAST}
			receiveShadow
		>
			<meshStandardMaterial
				color={color}
				metalness={0.03}
				roughness={0.86}
				side={DoubleSide}
			/>
		</mesh>
	);
}

/** Structural bridge geometry generated from bridge-mode road edges. */
export function RoadNetworkBridgeStructures({
	node, compiledSpans,
}: {
	compiledSpans?:ReturnType<typeof buildRoadBridgeSpans>;
	node: RoadNetworkNode;
}) {
	const spans = useMemo(() => compiledSpans ?? buildRoadBridgeSpans(node), [node,compiledSpans]);
	if (spans.length === 0) return null;
	const pierDiameter = node.bridgePierDiameter ?? 1.1;
	return (
		<group name="road-bridge-structures">
			{spans.map((span) => (
				<group key={span.edgeId} name={`road-bridge-span:${span.edgeId}`}>
					<BridgePrism
						bottomOffset={-span.surfaceThickness - span.deckThickness}
						color="#a9adb0"
						name="road-bridge-deck"
						points={span.points}
						topOffset={-span.surfaceThickness}
						width={span.deckWidth}
					/>
					{([-1, 1] as const).map((side) => (
						<BridgePrism
							bottomOffset={0}
							color="#deddd8"
							key={`barrier:${side}`}
							lateralOffset={side * (span.deckWidth / 2 - 0.17)}
							name={`road-bridge-barrier:${side < 0 ? "right" : "left"}`}
							points={span.points}
							topOffset={span.barrierHeight}
							width={0.24}
						/>
					))}
					{span.piers.map((pier) => {
						const capHeight = 0.45;
						const footingHeight = 0.3;
						const columnHeight = pier.topY - capHeight - footingHeight;
						if (columnHeight <= 0.4) return null;
						const columnOffset = Math.min(3, pier.deckWidth * 0.22);
						return (
							<group key={pier.id} name={`road-bridge-pier:${pier.id}`}>
								<mesh
									castShadow
									name="road-bridge-pier-cap"
									position={[
										pier.point[0],
										pier.topY - capHeight / 2,
										pier.point[2],
									]}
									raycast={NO_RAYCAST}
									receiveShadow
									rotation={[0, pier.angle, 0]}
								>
									<boxGeometry args={[pier.deckWidth * 0.86, capHeight, 1.1]} />
									<meshStandardMaterial color="#aeb2b3" roughness={0.9} />
								</mesh>
								{([-1, 1] as const).map((side) => {
									const x = pier.point[0] + pier.normal[0] * columnOffset * side;
									const z = pier.point[2] + pier.normal[1] * columnOffset * side;
									return (
										<group key={side}>
											<mesh
												castShadow
												name="road-bridge-pier-column"
												position={[
													x,
													footingHeight + columnHeight / 2,
													z,
												]}
												raycast={NO_RAYCAST}
												receiveShadow
											>
												<cylinderGeometry
													args={[pierDiameter / 2, pierDiameter * 0.58, columnHeight, 20]}
												/>
												<meshStandardMaterial color="#9fa4a5" roughness={0.92} />
											</mesh>
											<mesh
												castShadow
												name="road-bridge-pier-footing"
												position={[x, footingHeight / 2, z]}
												raycast={NO_RAYCAST}
												receiveShadow
											>
												<boxGeometry args={[pierDiameter * 1.7, footingHeight, pierDiameter * 1.7]} />
												<meshStandardMaterial color="#8f9494" roughness={0.94} />
											</mesh>
										</group>
									);
								})}
							</group>
						);
					})}
					{span.abutments.map((abutment) => {
						if (abutment.topY <= 0.25) return null;
						const tangent = [Math.sin(abutment.angle), Math.cos(abutment.angle)] as const;
						const normal = [tangent[1], -tangent[0]] as const;
						return (
							<group key={abutment.id} name={`road-bridge-abutment:${abutment.id}`}>
								<mesh
									castShadow
									name="road-bridge-abutment-wall"
									position={[
										abutment.point[0],
										abutment.topY / 2,
										abutment.point[2],
									]}
									raycast={NO_RAYCAST}
									receiveShadow
									rotation={[0, abutment.angle, 0]}
								>
									<boxGeometry args={[abutment.deckWidth + 0.7, abutment.topY, 0.8]} />
									<meshStandardMaterial color="#a3a6a5" roughness={0.93} />
								</mesh>
								{([-1, 1] as const).map((side) => (
									<mesh
										castShadow
										key={side}
										name="road-bridge-wing-wall"
										position={[
											abutment.point[0] + normal[0] * (abutment.deckWidth / 2 + 0.2) * side - tangent[0] * 1.15,
											abutment.topY * 0.36,
											abutment.point[2] + normal[1] * (abutment.deckWidth / 2 + 0.2) * side - tangent[1] * 1.15,
										]}
										raycast={NO_RAYCAST}
										receiveShadow
										rotation={[0, abutment.angle, 0]}
									>
										<boxGeometry args={[0.38, abutment.topY * 0.72, 3]} />
										<meshStandardMaterial color="#9da1a0" roughness={0.94} />
									</mesh>
								))}
							</group>
						);
					})}
				</group>
			))}
		</group>
	);
}
