import type { RoadNetworkNode } from "./schema";
import { compileStreetJunctions } from "./street-compiler-junctions";
import {
	buildRoadTransitionProfiles,
	trimRoadTransitionProfile,
} from "./road-transition-profile";
import { maskMappedComponentsForProfile } from "./road-mapped-band-mask";
import {
	buildRoadJunctionSeams,
	mergeCollidingJunctionSurfaces,
	roadJunctionMouth,
	trimRoadProfileAtJunctions,
} from "./road-junction-seams";

export function compileStreetLayout(node: RoadNetworkNode, profiles=buildRoadTransitionProfiles(node)) {
	const junctionSurfaces = compileStreetJunctions(node);
	const junctionTrimByApproach = Object.fromEntries(
		junctionSurfaces.flatMap(({ graphNode, solution }) =>
			Object.entries(solution.approachCuts).map(([edgeId, distance]) => [
				`${graphNode.id}:${edgeId}`,
				distance,
			]),
		),
	);
	const edgeSurfaces = profiles.map((profile) => {
		const decorativeProfile = trimRoadTransitionProfile(
			profile,
			junctionTrimByApproach[`${profile.startNodeId}:${profile.edgeIds[0]}`] ??
				0,
			junctionTrimByApproach[
				`${profile.endNodeId}:${profile.edgeIds[profile.edgeIds.length - 1]}`
			] ?? 0,
		);
		const isManual = (id: string) =>
			junctionSurfaces.some((j) => j.graphNode.id === id && j.manualBoundary);
		const surfaceProfile = trimRoadProfileAtJunctions(
			profile,
			isManual(profile.startNodeId)
				? 0
				: (junctionTrimByApproach[
						`${profile.startNodeId}:${profile.edgeIds[0]}`
					] ?? 0),
			isManual(profile.endNodeId)
				? 0
				: (junctionTrimByApproach[
						`${profile.endNodeId}:${profile.edgeIds.at(-1)}`
					] ?? 0),
		);
		const maskedProfile = maskMappedComponentsForProfile(node, surfaceProfile);
		return {
			decorativeProfile:
				isManual(profile.startNodeId) || isManual(profile.endNodeId)
					? decorativeProfile
					: maskedProfile,
			profile: maskedProfile,
		};
	});
	const renderedJunctionSurfaces = (() => {
		const mergedAsphalt = mergeCollidingJunctionSurfaces(
			junctionSurfaces.map((junction) => ({
				center: junction.graphNode.position,
				mergeKey: Object.values(node.edges)
					.filter(
						(edge) =>
							edge.startNodeId === junction.graphNode.id ||
							edge.endNodeId === junction.graphNode.id,
					)
					.map(
						(edge) =>
							`${edge.osmVertical?.bridge === true ? "bridge" : edge.osmVertical?.tunnel === true ? "tunnel" : "at-grade"}:${edge.osmVertical?.layer ?? 0}`,
					)
					.sort()
					.join("|"),
				solution: junction.solution,
			})),
		);
		return junctionSurfaces.map((junction, junctionIndex) => {
			if (junction.manualBoundary)
				return { ...junction, bandSurfaces: undefined };
			const mouths = Object.fromEntries(
				edgeSurfaces.flatMap(({ profile }) => {
					const entries = [];
					if (profile.startNodeId === junction.graphNode.id)
						entries.push([
							profile.edgeIds[0]!,
							roadJunctionMouth(profile, false),
						]);
					if (profile.endNodeId === junction.graphNode.id)
						entries.push([
							profile.edgeIds.at(-1)!,
							roadJunctionMouth(profile, true),
						]);
					return entries;
				}),
			);
			const seams = buildRoadJunctionSeams(
				junction.solution,
				junction.graphNode.position,
				mouths,
			);
			return {
				...junction,
				solution: {
					...junction.solution,
					...seams.asphalt,
					...mergedAsphalt[junctionIndex],
				},
				bandSurfaces: seams.bands,
			};
		});
	})();
	return {
		junctionSurfaces,
		junctionTrimByApproach,
		edgeSurfaces,
		renderedJunctionSurfaces,
	};
}
export type CompiledStreetLayout = ReturnType<typeof compileStreetLayout>;
