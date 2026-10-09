import type { RoadNetworkNode } from "./schema";
import type { RoadTransitionProfile } from "./road-transition-profile";
export function maskMappedComponentsForProfile(
	node: RoadNetworkNode,
	profile: RoadTransitionProfile,
): RoadTransitionProfile {
	const masks = new Map<number, Map<string, number>>();
	const samples = profile.samples;
	if (samples.length < 2) return profile;
	for (const surface of node.osmMappedSurfaces) {
		if (
			surface.associatedEdgeIds.length > 0 &&
			!surface.associatedEdgeIds.some((edgeId) =>
				profile.edgeIds.includes(edgeId),
			)
		)
			continue;
		const components =
			surface.kind === "cycleway"
				? (["bike-lane"] as const)
				: surface.kind === "kerb"
					? (["curb"] as const)
					: surface.kind === "sidewalk"
						? (["sidewalk"] as const)
						: surface.kind === "crossing"
							? (["curb", "sidewalk"] as const)
							: [];
		if (components.length === 0 || surface.points.length < 2) continue;
		// Compare every profile station with complete mapped segments. Sparse
		// source vertices must not leave a duplicate estimated band between them.
		for (let nearestIndex = 0; nearestIndex < samples.length; nearestIndex++) {
			const sample = samples[nearestIndex]!;
			let point = surface.points[0]!,
				nearestDistance = Number.POSITIVE_INFINITY;
			for (let i = 0; i < surface.points.length - 1; i++) {
				const a = surface.points[i]!,
					b = surface.points[i + 1]!,
					dx = b[0] - a[0],
					dz = b[2] - a[2];
				const denom = dx * dx + dz * dz;
				const t =
					denom === 0
						? 0
						: Math.max(
								0,
								Math.min(
									1,
									((sample.point[0] - a[0]) * dx +
										(sample.point[2] - a[2]) * dz) /
										denom,
								),
							);
				const candidate = [
					a[0] + dx * t,
					a[1] + (b[1] - a[1]) * t,
					a[2] + dz * t,
				] as [number, number, number];
				const distance = Math.hypot(
					sample.point[0] - candidate[0],
					sample.point[2] - candidate[2],
				);
				if (distance < nearestDistance) {
					point = candidate;
					nearestDistance = distance;
				}
			}
			if (nearestDistance > 6) continue;
			const next = samples[Math.min(samples.length - 1, nearestIndex + 1)]!;
			const previous = samples[Math.max(0, nearestIndex - 1)]!;
			const dx = next.point[0] - previous.point[0];
			const dz = next.point[2] - previous.point[2];
			const lateral =
				-dz * (point[0] - samples[nearestIndex]!.point[0]) +
				dx * (point[2] - samples[nearestIndex]!.point[2]);
			const sides =
				surface.side === "center"
					? ([lateral >= 0 ? "left" : "right"] as const)
					: ([surface.side] as const);
			for (const side of sides) {
				for (const component of components) {
					const key = `${side}:${component}`;
					for (const [offset, strength] of [
						[0, 1],
						[-1, 0.5],
						[1, 0.5],
						[-2, 0.2],
						[2, 0.2],
					] as const) {
						const index = nearestIndex + offset;
						if (index < 0 || index >= samples.length) continue;
						const station = masks.get(index) ?? new Map<string, number>();
						station.set(key, Math.max(station.get(key) ?? 0, strength));
						masks.set(index, station);
					}
				}
			}
		}
	}
	if (masks.size === 0) return profile;
	return {
		...profile,
		samples: profile.samples.map((sample, index) => {
			const masked = masks.get(index);
			if (!masked) return sample;
			const components = { ...sample.components };
			for (const [key, strength] of masked) {
				const [side, kind] = key.split(":") as [
					"left" | "right",
					keyof typeof sample.components.left,
				];
				const component = components[side][kind];
				const width = component.width * (1 - strength);
				components[side] = {
					...components[side],
					[kind]: {
						...component,
						width,
						outerOffset: component.innerOffset + width,
					},
				};
			}
			return { ...sample, components };
		}),
	};
}
