import type { GeometryContext } from "@pascal-app/core";
import { RoadNetworkNode } from "./schema";
import { compileStreet } from "./street-compiler";
import { streetPlanToFloorplan } from "./road-network-floorplan";

export function runStep28FloorplanChecks() {
	const road = RoadNetworkNode.parse({
		id: "road-network_floorplan-browser",
		graphNodes: {
			a: { id: "a", position: [-40, 0, 0] },
			b: { id: "b", position: [0, 0, 0] },
			c: { id: "c", position: [40, 0, 0] },
			d: { id: "d", position: [0, 0, 40] },
		},
		edges: {
			ab: { id: "ab", startNodeId: "a", endNodeId: "b" },
			bc: { id: "bc", startNodeId: "b", endNodeId: "c" },
			bd: { id: "bd", startNodeId: "b", endNodeId: "d" },
		},
		junctions: { b: { nodeId: "b", kind: "tee", treatment: "signal" } },
		osmMappedSurfaces: [
			{
				id: 7,
				kind: "road-area",
				tags: { "area:highway": "traffic_island" },
				points: [
					[-0.5, 0, -0.5],
					[0.5, 0, -0.5],
					[0.5, 0, 0.5],
					[-0.5, 0, 0.5],
					[-0.5, 0, -0.5],
				],
			},
		],
	});
	const checks: Array<{ name: string; passed: boolean }> = [];
	const check = (name: string, passed: boolean) => {
		checks.push({ name, passed });
		if (!passed) throw Error(name);
	};
	try {
		const plan = compileStreet(road),
			before = JSON.stringify(plan);
		const ctx: GeometryContext = {
			resolve: () => undefined,
			children: [],
			siblings: [],
			parent: null,
		};
		const unselected = streetPlanToFloorplan(road, plan, ctx);
		const selected = streetPlanToFloorplan(road, plan, {
			...ctx,
			viewState: {
				selected: true,
				unit: "metric",
				highlighted: false,
				hovered: false,
				moving: false,
				palette: {
					selectedStroke: "#2563eb",
					selectedFill: "#2563eb",
					selectedHatch: "#2563eb",
					wallHoverStroke: "#2563eb",
					endpointHandleFill: "#2563eb",
					endpointHandleStroke: "#2563eb",
					endpointHandleHoverStroke: "#2563eb",
					endpointHandleActiveFill: "#2563eb",
					endpointHandleActiveStroke: "#2563eb",
					curveHandleFill: "#2563eb",
					curveHandleStroke: "#2563eb",
					curveHandleHoverStroke: "#2563eb",
					measurementStroke: "#2563eb",
					measurementLabelBackground: "#2563eb",
					measurementLabelText: "#2563eb",
				},
			},
		});
		if (unselected.kind !== "group" || selected.kind !== "group")
			throw Error("Expected groups");
		const polygons = (children: typeof selected.children) =>
			children.filter((child) => child.kind === "polygon");
		check(
			"selected and unselected footprints identical",
			JSON.stringify(polygons(selected.children).map((p) => p.points)) ===
				JSON.stringify(polygons(unselected.children).map((p) => p.points)),
		);
		check("adapter preserves compiler input", before === JSON.stringify(plan));
		check(
			"mapped junction island retained as hole",
			plan.junctions[0]!.solution.holes!.length === 1,
		);
		const mesh = plan.junctions[0]!.solution;
		const signs = (p: number[], a: number[], b: number[]) =>
			(p[0]! - b[0]!) * (a[1]! - b[1]!) - (a[0]! - b[0]!) * (p[1]! - b[1]!);
		const coversCenter = mesh.indices.some((_, index) => {
			if (index % 3 !== 0) return false;
			const tri = mesh.indices
				.slice(index, index + 3)
				.map((i) => [mesh.positions[i * 3]!, mesh.positions[i * 3 + 2]!]);
			const d = [
				signs([0, 0], tri[0]!, tri[1]!),
				signs([0, 0], tri[1]!, tri[2]!),
				signs([0, 0], tri[2]!, tri[0]!),
			];
			return !(d.some((v) => v < 0) && d.some((v) => v > 0));
		});
		check("junction asphalt excludes island center", !coversCenter);
		check(
			"crosswalks remain at compiler positions",
			plan.markings.filter((m) => m.kind === "crosswalk").length > 0 &&
				plan.markings
					.filter((m) => m.kind === "crosswalk")
					.every((m) =>
						polygons(selected.children).some(
							(p) =>
								JSON.stringify(p.points) ===
								JSON.stringify(m.points.map((point) => [point[0], point[2]])),
						),
					),
		);
		check(
			"road hit lines retained",
			selected.children.some((child) => child.kind === "hit-line"),
		);
		check(
			"node handles retained",
			selected.children.filter(
				(child) =>
					child.kind === "endpoint-handle" &&
					child.affordance === "road-node-point",
			).length === 4,
		);
		check(
			"unselected road has no editing handles",
			!unselected.children.some(
				(child) =>
					child.kind === "endpoint-handle" || child.kind === "move-arrow",
			),
		);
		return {
			ok: true,
			checks,
			polygons: polygons(selected.children).map((p) => ({
				points: p.points,
				fill: p.fill,
			})),
		};
	} catch (error) {
		return { ok: false, checks, error: String(error), polygons: [] };
	}
}
