"use client";

import { useEffect, useMemo } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import {
	buildRoadEarthworkGeometry,
	buildRoadEarthworkStrips,
} from "./road-network-earthworks";
import type { RoadNetworkNode } from "./schema";
import type { TerrainField } from "./terrain-field-compat";

const NO_RAYCAST = () => undefined;

function RoadEarthworkMesh({
	strip,
}: {
	strip: ReturnType<typeof buildRoadEarthworkStrips>[number];
}) {
	const data = useMemo(() => buildRoadEarthworkGeometry(strip), [strip]);
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
	return (
		<mesh
			geometry={geometry}
			name={`road-earthwork-${strip.kind}:${strip.side}`}
			raycast={NO_RAYCAST}
			receiveShadow
		>
			<meshStandardMaterial
				color={strip.kind === "fill" ? "#80735c" : "#756854"}
				polygonOffset
				polygonOffsetFactor={1}
				roughness={1}
				side={DoubleSide}
			/>
		</mesh>
	);
}

/** Non-interactive daylight slopes between ground roads and site terrain. */
export function RoadNetworkEarthworks({
	node,
	terrain, compiledStrips,
}: {
 compiledStrips?:ReturnType<typeof buildRoadEarthworkStrips>;
	node: RoadNetworkNode;
	terrain: TerrainField | null;
}) {
	const strips = useMemo(
		() => compiledStrips ?? buildRoadEarthworkStrips(node, terrain),
		[node, terrain,compiledStrips],
	);
	if (strips.length === 0) return null;
	return (
		<group name="road-network-earthworks">
			{strips.map((strip) => (
				<RoadEarthworkMesh key={strip.id} strip={strip} />
			))}
		</group>
	);
}
