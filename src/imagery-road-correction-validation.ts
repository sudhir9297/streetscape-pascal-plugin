import type { StreetObservation } from "./domain/street-evidence";
import type { RoadNetworkNode } from "./schema";
import { resolveRoadStyleEditingScope } from "./road-network-style-editing";
import { resolveRoadSideComponents } from "./road-cross-section";
/** Do not use descriptive imagery as calibrated metric evidence or unrelated correction evidence. */
export function validateImageryRoadCorrection(
	before: RoadNetworkNode,
	after: RoadNetworkNode,
	edgeId: string | undefined,
	observations: StreetObservation[],
) {
	const imagery = observations.flatMap((observation) =>
		observation.imagery ? [observation.imagery] : [],
	);
	if (!imagery.length) return;
	if (!edgeId || !before.edges[edgeId] || !after.edges[edgeId])
		throw Error("Select the evidence road section explicitly.");
	const old = resolveRoadStyleEditingScope(before, edgeId).style,
		next = resolveRoadStyleEditingScope(after, edgeId).style;
	for (const evidence of imagery) {
		if (evidence.status !== "accepted" || evidence.target.edgeId !== edgeId)
			throw Error("Imagery evidence must be accepted for this section.");
		const claim = evidence.claim;
		if (claim.kind === "surface") {
			if (next.surfaceMaterial !== claim.material)
				throw Error(
					"Corrected material does not agree with the accepted imagery claim.",
				);
		} else if (claim.kind === "sidewalk-presence") {
			if (
				resolveRoadSideComponents(next, claim.side).sidewalkWidth > 0 !==
				claim.present
			)
				throw Error(
					"Corrected sidewalk presence does not agree with accepted evidence.",
				);
		} else if (claim.kind === "measurement") {
			const actual =
				claim.property === "lane width"
					? next.laneWidth
					: claim.property === "left sidewalk width"
						? resolveRoadSideComponents(next, "left").sidewalkWidth
						: claim.property === "right sidewalk width"
							? resolveRoadSideComponents(next, "right").sidewalkWidth
							: null;
			if (actual === null || Math.abs(actual - claim.valueMeters) > 1e-9)
				throw Error(
					"Measurement must name lane width, left sidewalk width or right sidewalk width and agree with the correction.",
				);
		} else
			throw Error(
				"Sign and lamp observations support explicit asset corrections, not road dimensions.",
			);
	}
	const measured = (property: string, value: number) =>
		imagery.some(
			(evidence) =>
				evidence.claim.kind === "measurement" &&
				evidence.claim.property === property &&
				evidence.claim.valueMeters === value,
		);
	for (const side of ["left", "right"] as const) {
		const width = resolveRoadSideComponents(next, side).sidewalkWidth;
		if (
			width > 0 &&
			width !== resolveRoadSideComponents(old, side).sidewalkWidth &&
			!measured(`${side} sidewalk width`, width)
		)
			throw Error(
				"A changed metric sidewalk width requires accepted calibrated measurement evidence; an image presence claim is insufficient.",
			);
	}
	if (
		old.laneWidth !== next.laneWidth &&
		!measured("lane width", next.laneWidth)
	)
		throw Error(
			"A changed lane width requires accepted calibrated measurement evidence.",
		);
}
