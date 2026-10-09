import type { SitePoint } from "../domain/site-frame";

export type HostSitePlacement = {
	position: SitePoint;
	rotationY: number;
	displayLiftMeters: number;
};
export function siteToHostWorld(
	point: SitePoint,
	placement: HostSitePlacement,
): [number, number, number] {
	const c = Math.cos(placement.rotationY),
		s = Math.sin(placement.rotationY);
	return [
		placement.position[0] + point[0] * c + point[2] * s,
		placement.position[1] + point[1] + placement.displayLiftMeters,
		placement.position[2] - point[0] * s + point[2] * c,
	];
}
export function hostWorldToSite(
	point: SitePoint,
	placement: HostSitePlacement,
): [number, number, number] {
	const x = point[0] - placement.position[0],
		z = point[2] - placement.position[2],
		c = Math.cos(placement.rotationY),
		s = Math.sin(placement.rotationY);
	return [
		x * c - z * s,
		point[1] - placement.position[1] - placement.displayLiftMeters,
		x * s + z * c,
	];
}
export function withDisplayLift(
	point: SitePoint,
	lift: number,
): [number, number, number] {
	return [point[0], point[1] + lift, point[2]];
}
