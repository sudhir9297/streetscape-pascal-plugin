import { expect, test } from "bun:test";
import { createOsmImportScope, outsideSelectedPaths } from "./osm-import-scope";
import {
	completeOsmStreetImport,
	getPreparedOsmStreetImportResult,
	localToGeo,
	prepareOsmStreetImport,
	projectToLocal,
	type OsmWay,
} from "./osm-import";
import { validateRoadGraph } from "./road-network-validation";
const center = { lat: 0, lon: 0 };
const point = (nodeId: number, x: number, z: number) => ({
	nodeId,
	...localToGeo([x, z], center),
});
// Junction just inside the selected boundary; its three outward arms end outside.
const ways: OsmWay[] = [
	{
		id: 1,
		tags: { highway: "residential" },
		points: [point(1, 0, 0), point(2, 99, 0), point(3, 180, 0)],
	},
	{
		id: 2,
		tags: { highway: "residential" },
		points: [point(4, 99, -80), point(2, 99, 0), point(5, 99, 80)],
	},
	{
		id: 3,
		tags: { highway: "service" },
		points: [point(6, -180, 70), point(7, -140, 70)],
	},
];
test("acquires expanded bounds, retains full boundary approaches, and generates selected centerlines only", async () => {
	let requested: unknown;
	const prepared = await prepareOsmStreetImport(center, 100, {
		loadStreets: async (bounds) => {
			requested = bounds;
			return ways;
		},
	});
	expect(requested).toEqual(
		createOsmImportScope(center, 100).acquisitionBounds,
	);
	expect(prepared.context.scope.contextRadiusMeters).toBe(200);
	const supporting = prepared.context.graphs.find(
		(graph) => graph.graphNodes.n2,
	)!;
	expect(
		Object.values(supporting.edges).filter(
			(edge) => edge.startNodeId === "n2" || edge.endNodeId === "n2",
		),
	).toHaveLength(4);
	expect(
		supporting.junctions.j2 ??
			Object.values(supporting.junctions).find(
				(junction) => junction.nodeId === "n2",
			),
	).toBeDefined();
	const result = await completeOsmStreetImport(prepared);
	expect(result.context).toEqual(prepared.context);
	expect(result.context).not.toBe(prepared.context);
	expect(
		result.graphs
			.flatMap((graph) => Object.values(graph.edges))
			.some((edge) => edge.osmSource?.wayId === 3),
	).toBe(false);
	for (const graph of result.graphs) {
		expect(
			validateRoadGraph(graph).filter((issue) => issue.severity === "error"),
		).toEqual([]);
		for (const node of Object.values(graph.graphNodes))
			expect(
				Math.hypot(node.position[0], node.position[2]),
			).toBeLessThanOrEqual(100.00001);
	}
	expect(getPreparedOsmStreetImportResult(prepared).context).toEqual(
		prepared.context,
	);
	expect(prepared.preview.contextPaths!.length).toBeGreaterThan(0);
	for (const path of prepared.preview.contextPaths!)
		for (const point of path.points)
			expect(
				Math.hypot(...projectToLocal(point, center)),
			).toBeGreaterThanOrEqual(99.99999);
});
test("a junction exactly at the selection edge keeps all supporting approaches", async () => {
	const boundaryWays = ways.slice(0, 2).map((way) => ({
		...way,
		points: way.points.map((point) => ({
			...point,
			...localToGeo(
				[
					projectToLocal(point, center)[0] + 1,
					projectToLocal(point, center)[1],
				],
				center,
			),
		})),
	}));
	const prepared = await prepareOsmStreetImport(center, 100, {
		loadStreets: async () => boundaryWays,
	});
	const graph = prepared.context.graphs.find((graph) => graph.graphNodes.n2)!;
	expect(
		Object.values(graph.edges).filter(
			(edge) => edge.startNodeId === "n2" || edge.endNodeId === "n2",
		),
	).toHaveLength(4);
	expect(prepared.preview.paths.length).toBeGreaterThan(0);
	const result = await completeOsmStreetImport(prepared);
	for (const graph of result.graphs)
		for (const node of Object.values(graph.graphNodes))
			expect(
				Math.hypot(node.position[0], node.position[2]),
			).toBeLessThanOrEqual(100.00001);
});
test("context splits an inside way at a junction touched only by an outside way", async () => {
	const junction = point(2, 100, 0);
	const prepared = await prepareOsmStreetImport(center, 100, {
		loadStreets: async () => [
			{
				id: 1,
				tags: { highway: "residential" },
				points: [point(1, 0, 0), junction, point(3, 0, 50)],
			},
			{
				id: 2,
				tags: { highway: "residential" },
				points: [junction, point(4, 180, 0)],
			},
		],
	});
	const selected = getPreparedOsmStreetImportResult(prepared).graphs;
	expect(selected.some((graph) => graph.graphNodes.n2)).toBe(true);
	expect(
		selected
			.flatMap((graph) => Object.values(graph.edges))
			.filter((edge) => edge.startNodeId === "n2" || edge.endNodeId === "n2")
			.length,
	).toBeGreaterThanOrEqual(2);
});
test("support-only data cannot become an empty selected import", async () => {
	await expect(
		prepareOsmStreetImport(center, 100, {
			loadStreets: async () => [ways[2]!],
		}),
	).rejects.toThrow("No streets were found");
});
test("scope handles explicit margin, maximum selection and invalid geographic input", () => {
	expect(createOsmImportScope(center, 600).contextRadiusMeters).toBe(700);
	expect(createOsmImportScope(center, 600, 200).contextRadiusMeters).toBe(800);
	expect(createOsmImportScope(center, 100, 0).acquisitionBounds).toEqual(
		createOsmImportScope(center, 100, 0).selectedBounds,
	);
	for (const margin of [-1, 201, NaN, Infinity])
		expect(() => createOsmImportScope(center, 100, margin)).toThrow();
	expect(() => createOsmImportScope({ lat: 86, lon: 0 }, 100)).toThrow();
	expect(() => createOsmImportScope({ lat: 0, lon: 179.9999 }, 100)).toThrow(
		"antimeridian",
	);
});
test("support paths split crossing and re-entering lines without joining across selection", () => {
	const scope = createOsmImportScope(center, 100);
	const paths = outsideSelectedPaths(
		[localToGeo([-200, 0], center), localToGeo([200, 0], center)],
		scope,
	);
	expect(paths).toHaveLength(2);
	expect(
		paths.map((path) => path.map((point) => projectToLocal(point, center)[0])),
	).toEqual([
		[-200, -100],
		[100, 200],
	]);
	expect(
		outsideSelectedPaths(
			[localToGeo([-20, 0], center), localToGeo([20, 0], center)],
			scope,
		),
	).toEqual([]);
});
