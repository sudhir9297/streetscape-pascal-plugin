import { resolveScenarioRoadContext } from "./host/effective-road-context";
import {compileStreetPlacementPlan} from './street-placement-plan'
import { roadMovementContext } from './host/road-movement-context'
import type {AnyNode,AnyNodeId} from '@pascal-app/core'
import type { FloorplanGeometry, GeometryContext } from "@pascal-app/core";
import type { RoadNetworkNode } from "./schema";
import { compileStreet, type CompiledStreetPlan } from "./street-compiler";
import { classifyRoadJunction } from "./road-network-topology";
import { buildRoadCurbCornerHandles } from "./road-network-corner-editing";
import {
	roadTerminalEnds,
	sampleRoadEdgePoints,
} from "./road-network-geometry";
import {
	validateRoadGraph,
	roadValidationIssuePoint,
} from "./road-network-validation";

export function streetPlanToFloorplan(
	node: RoadNetworkNode,
	plan: CompiledStreetPlan,
	ctx: GeometryContext,
): FloorplanGeometry {
	const selected = ctx.viewState?.selected ?? false;
	const stroke = ctx.viewState?.palette.selectedStroke ?? "#2563eb";
	const children: FloorplanGeometry[] =
		plan.canonicalFloorplan.kind === "group"
			? plan.canonicalFloorplan.children.map((child) =>
					child.kind === "polygon" && child.strokeWidth === 0.04 && selected
						? { ...child, stroke, strokeWidth: 0.09 }
						: child,
				)
			: [plan.canonicalFloorplan];
	if (selected) {
		for (const graphNode of Object.values(node.graphNodes)) {
			const incident = Object.values(node.edges).filter(
				(edge) =>
					edge.startNodeId === graphNode.id || edge.endNodeId === graphNode.id,
			);
			if (incident.length < 3) continue;

			children.push({
				kind: "text",
				x: graphNode.position[0],
				y: graphNode.position[2],
				text: classifyRoadJunction(node, graphNode.id),
				fontSize: 0.32,
				fill: "#ffffff",
				fontWeight: 700,
				textAnchor: "middle",
				dominantBaseline: "middle",
				upright: true,
			});
			for (const handle of buildRoadCurbCornerHandles(node, graphNode.id)) {
				children.push({
					kind: "endpoint-handle",
					point: handle.point,
					state: "idle",
					variant: "curve",
					affordance: "road-curb-corner",
					payload: {
						junctionId: graphNode.id,
						cornerKey: handle.cornerKey,
					},
				});
			}
		}

		for (const terminal of roadTerminalEnds(node)) {
			const arrowOffset = 0.9;
			children.push({
				kind: "move-arrow",
				point: [
					terminal.point[0] + terminal.direction[0] * arrowOffset,
					terminal.point[2] + terminal.direction[1] * arrowOffset,
				],
				angle: terminal.angle,
				affordance: "road-extend-endpoint",
				payload: { nodeId: terminal.nodeId },
			});
		}
		for (const graphNode of Object.values(node.graphNodes)) {
			children.push({
				kind: "endpoint-handle",
				point: [graphNode.position[0], graphNode.position[2]],
				state: "idle",
				variant: "endpoint",
				affordance: "road-node-point",
				payload: { nodeId: graphNode.id },
			});
		}
		for (const edge of Object.values(node.edges)) {
			if (edge.alignment.length > 0) {
				const samples = sampleRoadEdgePoints(
					node,
					edge,
					Math.max(32, (edge.alignment.length + 1) * 16),
				);
				for (let index = 0; index <= edge.alignment.length; index += 1) {
					const t = (index + 0.5) / (edge.alignment.length + 1);
					const point = samples[Math.round(t * (samples.length - 1))];
					if (!point) continue;
					children.push({
						kind: "midpoint-handle",
						point: [point[0], point[2]],
						affordance: "road-insert-point",
						payload: { edgeId: edge.id, index, elevation: point[1] },
					});
				}
			}
			edge.alignment.forEach((point, index) => {
				children.push({
					kind: "endpoint-handle",
					point: [point[0], point[2]],
					state: "idle",
					variant: "curve",
					affordance: "road-control-point",
					payload: { edgeId: edge.id, index },
				});
			});
		}
	}
	for (const issue of validateRoadGraph(node)) {
		if (issue.severity === "warning" && !selected) continue;
		const point = roadValidationIssuePoint(node, issue);
		if (!point) continue;
		children.push({
			kind: "circle",
			cx: point[0],
			cy: point[2],
			r: 0.28,
			fill: issue.severity === "error" ? "#ef4444" : "#f59e0b",
			stroke: "#ffffff",
			strokeWidth: 0.06,
		});
		children.push({
			kind: "text",
			x: point[0],
			y: point[2],
			text: "!",
			fontSize: 0.3,
			fill: "#ffffff",
			fontWeight: 800,
			textAnchor: "middle",
			dominantBaseline: "middle",
			upright: true,
		});
	}

 const previewVisible=(node as RoadNetworkNode & {streetscapeProposalPreviewVisible?:boolean}).streetscapeProposalPreviewVisible!==false
 if(previewVisible){
  for(const proposal of plan.junctionMovementPlan.signalProposals)children.push({kind:'circle',cx:proposal.position[0],cy:proposal.position[2],r:0.25,fill:'#a78bfa',stroke:'#7c3aed',strokeWidth:0.04});
  const inventory=Object.fromEntries((ctx.siblings ?? []).map(item=>[item.id,item])) as Record<AnyNodeId,AnyNode>
  const placementPlan=compileStreetPlacementPlan(node,inventory)
  for(const proposal of placementPlan.proposals){
   const visible=node.showRoadsideDecorations ? node.roadsideItemVisibility?.[proposal.kind]!==false : node.roadsideItemVisibility?.[proposal.kind]===true
   if(visible)children.push({kind:'circle',cx:proposal.position[0],cy:proposal.position[2],r:0.18,fill:'#a78bfa',stroke:'#7c3aed',strokeWidth:0.04})
  }
 }

	return { kind: "group", children };
}
export function buildRoadNetworkFloorplan(
	node: RoadNetworkNode,
	ctx: GeometryContext,
): FloorplanGeometry {
	const effective = resolveScenarioRoadContext(node,ctx.resolve);
 return streetPlanToFloorplan(effective, compileStreet(effective,null,roadMovementContext(effective,ctx.resolve)), ctx);
}
