import type { OsmWay } from "./osm-interpretation";
import { normalizeOsmRoadTags } from "./osm-normalization";

export type OsmTopologyDiagnostic = {
	code: "incompatible-shared-node" | "inconsistent-node-position";
	nodeId: number;
	wayIds: number[];
	message: string;
};
export type OsmSourceTopology = {
	format: "osm-source-topology";
	schemaVersion: 1;
	nodes: Array<{
		id: string;
		sourceNodeId: number;
		lat: number;
		lon: number;
		grade: string;
	}>;
	edges: Array<{
		id: string;
		wayId: number;
		sourceStart: number;
		sourceEnd: number;
		startNodeId: string;
		endNodeId: string;
		direction: "forward" | "reverse" | "both";
	}>;
	diagnostics: OsmTopologyDiagnostic[];
};

/** Logical connectivity comes from source node identities, never proximity.
 * A bridge/ground boundary may connect at matching way endpoints. A shared
 * interior node with incompatible grade facts is retained as a source conflict.
 */
export function buildOsmSourceTopology(
	ways: readonly OsmWay[],
): OsmSourceTopology {
	const ordered = [...ways].sort((a, b) => a.id - b.id);
	const occurrences = new Map<
		number,
		Array<{
			wayId: number;
			endpoint: boolean;
			grade: string;
			lat: number;
			lon: number;
		}>
	>();
	const grades = new Map<number, string>();
	for (const way of ordered) {
		const { road } = normalizeOsmRoadTags(way.tags);
		const grade = `layer~${road.layer ?? 0}~${road.bridge === true ? "bridge" : road.tunnel === true ? "tunnel" : "ground"}`;
		grades.set(way.id, grade);
		way.points.forEach((p, i) => {
			const list = occurrences.get(p.nodeId) ?? [];
			list.push({
				wayId: way.id,
				endpoint: i === 0 || i === way.points.length - 1,
				grade,
				lat: p.lat,
				lon: p.lon,
			});
			occurrences.set(p.nodeId, list);
		});
	}
	const split = new Set<number>(),
		diagnostics: OsmTopologyDiagnostic[] = [];
	for (const [nodeId, list] of [...occurrences].sort(([a], [b]) => a - b)) {
		const wayIds = [...new Set(list.map((o) => o.wayId))];
		if (list.some((o) => o.lat !== list[0]!.lat || o.lon !== list[0]!.lon)) {
			split.add(nodeId);
			diagnostics.push({
				code: "inconsistent-node-position",
				nodeId,
				wayIds,
				message:
					"The same source node has inconsistent coordinates; occurrences remain separate pending review.",
			});
		} else if (
			new Set(list.map((o) => o.grade)).size > 1 &&
			!(
				list.every((o) => o.endpoint) &&
				new Set(list.map((o) => o.grade)).size === 2 &&
				list.some((o) => o.grade === "layer~0~ground") &&
				list.some(
					(o) => o.grade.endsWith("~bridge") || o.grade.endsWith("~tunnel"),
				)
			)
		) {
			split.add(nodeId);
			diagnostics.push({
				code: "incompatible-shared-node",
				nodeId,
				wayIds,
				message:
					"A shared interior source node has incompatible grade facts; no cross-grade connection was inferred.",
			});
		}
	}
	const nodes = new Map<string, OsmSourceTopology["nodes"][number]>(),
		edges: OsmSourceTopology["edges"] = [];
	for (const way of ordered) {
		const grade = grades.get(way.id)!,
			direction = normalizeOsmRoadTags(way.tags).road.direction ?? "both";
		const ids = way.points.map((p) => {
			const list = occurrences.get(p.nodeId)!;
			const conflict = diagnostics.some(
				(d) => d.nodeId === p.nodeId && d.code === "inconsistent-node-position",
			);
			const id = split.has(p.nodeId)
				? `n${p.nodeId}~${conflict ? `way~${way.id}` : grade}`
				: `n${p.nodeId}`;
			nodes.set(id, {
				id,
				sourceNodeId: p.nodeId,
				lat: p.lat,
				lon: p.lon,
				grade: split.has(p.nodeId)
					? grade
					: new Set(list.map((o) => o.grade)).size > 1
						? "endpoint-transition"
						: grade,
			});
			return id;
		});
		for (let i = 0; i < ids.length - 1; i++)
			edges.push({
				id: `osm~way~${way.id}~${i}~${i + 1}`,
				wayId: way.id,
				sourceStart: i,
				sourceEnd: i + 1,
				startNodeId: ids[i]!,
				endNodeId: ids[i + 1]!,
				direction,
			});
	}
	return {
		format: "osm-source-topology",
		schemaVersion: 1,
		nodes: [...nodes.values()].sort((a, b) =>
			a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
		),
		edges,
		diagnostics,
	};
}

export function sourceTopologyNodeIds(
	topology: OsmSourceTopology,
): Map<string, string> {
	const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
	const result = new Map<string, string>();
	for (const edge of topology.edges) {
		result.set(
			`${edge.wayId}~${edge.sourceStart}`,
			nodes.get(edge.startNodeId)!.id,
		);
		result.set(
			`${edge.wayId}~${edge.sourceEnd}`,
			nodes.get(edge.endNodeId)!.id,
		);
	}
	return result;
}
