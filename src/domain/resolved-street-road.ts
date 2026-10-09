import { z } from "zod";
import { StreetSectionLayout } from "./street-section-layout";

const Id = z.string().min(1);
const Json = z.record(z.string(), z.json());
const Point = z.tuple([z.number(), z.number(), z.number()]);
/** Reference geometry is authoritative; renderer attributes are compatibility data. */
export const ResolvedStreetRoadData = z
	.strictObject({
		coordinateFrameId: Id.nullable(),
		referenceNodes: z.record(Id, z.looseObject({ id: Id, position: Point })),
		referenceLines: z.record(
			Id,
			z.looseObject({
				id: Id,
				startNodeId: Id,
				endNodeId: Id,
				alignment: z.array(Point),
				styleId: Id,
			}),
		),
		sections: z.record(
			Id,
			z.strictObject({
				id: Id,
				edgeId: Id,
				interval: z.strictObject({
					start: z.literal(0),
					end: z.number().positive(),
				}),
				style: Json,
				layout: StreetSectionLayout.optional(),
				values: Json,
			}),
		),
		attachments: z.record(
			Id,
			z.looseObject({
				id: Id,
				edgeId: Id,
				assetNodeId: Id,
				station: z.number().nonnegative(),
				lateralOffset: z.number(),
				verticalOffset: z.number(),
			}),
		),
		junctions: Json,
		inventory: z.strictObject({
			surfaces: z.array(z.json()),
			crossings: z.array(z.json()),
			laneConnectivity: z.array(z.json()),
		}),
		compatibility: z.strictObject({
			node: Json,
			unusedStyles: Json,
			activeStyleId: Id,
		}),
	})
	.superRefine((road, ctx) => {
		const issue = (message: string) =>
			ctx.addIssue({ code: "custom", message });
		for (const [id, node] of Object.entries(road.referenceNodes))
			if (id !== node.id) issue("Reference node key must match its ID");
		for (const [id, line] of Object.entries(road.referenceLines)) {
			if (id !== line.id) issue("Reference line key must match its ID");
			if (
				!Object.hasOwn(road.referenceNodes, line.startNodeId) ||
				!Object.hasOwn(road.referenceNodes, line.endNodeId)
			)
				issue("Reference line endpoint does not exist");
			if (
				!Object.values(road.sections).some((section) => section.edgeId === id)
			)
				issue("Reference line requires a section");
		}
		const covered = new Set<string>();
		for (const [id, section] of Object.entries(road.sections)) {
			if (
				id !== section.id ||
				!Object.hasOwn(road.referenceLines, section.edgeId)
			)
				issue("Section must reference an existing line and match its ID");
			if (covered.has(section.edgeId))
				issue("Initial baseline supports one whole-span section per line");
			covered.add(section.edgeId);
			if (
				section.layout &&
				Math.abs(section.layout.length - section.interval.end) > 1e-6
			)
				issue("Section layout must cover its owning section span");
		}
		for (const [id, attachment] of Object.entries(road.attachments)) {
			if (
				id !== attachment.id ||
				!Object.hasOwn(road.referenceLines, attachment.edgeId)
			)
				issue("Attachment must reference an existing line and match its ID");
		}
		for (const field of [
			"graphNodes",
			"edges",
			"stylePresets",
			"attachments",
			"junctions",
			"osmMappedSurfaces",
			"osmCrossings",
			"osmLaneConnectivity",
		])
			if (Object.hasOwn(road.compatibility.node, field))
				issue("Compatibility data cannot own semantic road fields");
	});
export type ResolvedStreetRoadData = z.infer<typeof ResolvedStreetRoadData>;
