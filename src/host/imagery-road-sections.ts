import type { PersistedStreetProject } from "./street-project-persistence";
import { ResolvedStreetRoadData } from "../domain/resolved-street-road";
import { resolveStreetFeatureData } from "../domain/street-resolution";
import { siteToGeographic } from "../domain/site-frame";
export type ImageryRoadSection = {
	id: string;
	roadId: string;
	edgeId: string;
	label: string;
	coordinates: [number, number][];
};
/** Read the semantic geometry in its site frame, excluding host display transforms. */
export function imageryRoadSections(
	stored: PersistedStreetProject,
): ImageryRoadSection[] {
	const project = stored.project;
	const baseline = project.baselineRevisions[project.activeBaselineRevisionId];
	if (!baseline) return [];
	return Object.values(baseline.roads).flatMap((road) => {
		const parsed = ResolvedStreetRoadData.safeParse(
			resolveStreetFeatureData(project, baseline.id, "roads", road.id),
		);
		if (!parsed.success || !parsed.data.coordinateFrameId) return [];
		const data = parsed.data,
			frame = project.siteFrames[parsed.data.coordinateFrameId];
		if (!frame) return [];
		return Object.values(data.referenceLines).flatMap((line) => {
			const start = data.referenceNodes[line.startNodeId],
				end = data.referenceNodes[line.endNodeId];
			if (!start || !end) return [];
			const coordinates = [start.position, ...line.alignment, end.position].map(
				(point) => {
					const geo = siteToGeographic([point[0], point[2]], frame);
					return [geo.lon, geo.lat] as [number, number];
				},
			);
			return [
				{
					id: `${road.id}~${line.id}`,
					roadId: road.id,
					edgeId: line.id,
					label: `Road section ${line.id}`,
					coordinates,
				},
			];
		});
	});
}
