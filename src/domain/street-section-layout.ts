import { z } from "zod";

const Id = z.string().trim().min(1);
const Width = z.number().finite().positive();
/** A physical traffic lane occurs once; cycling and parking are surface bands. */
export const StreetTrafficLane = z.strictObject({
	id: Id,
	direction: z.enum(["forward", "backward", "both"]),
	use: z.enum(["general", "bus", "turning"]),
	width: Width.min(2.4).max(5),
	/** Physical taper endpoints; nominal driving width remains independently constrained. */
	startWidth: z.number().finite().min(0).max(5).optional(),
	endWidth: z.number().finite().min(0).max(5).optional(),
});
export const StreetSurfaceBand = z.strictObject({
	id: Id,
	kind: z.enum([
		"parking",
		"curb",
		"gutter",
		"verge",
		"sidewalk",
		"protected-cycling",
		"median",
		"shoulder",
	]),
	width: Width.max(30),
	startWidth: z.number().finite().min(0).max(30).optional(),
	endWidth: z.number().finite().min(0).max(30).optional(),
});
export const StreetSectionLayoutInterval = z
	.strictObject({
		id: Id,
		start: z.number().finite().nonnegative(),
		end: z.number().finite().positive(),
		/** Arrays run left to right when looking along the reference line. */
		lanes: z.array(StreetTrafficLane).max(12),
		leftBands: z.array(StreetSurfaceBand).max(24),
		rightBands: z.array(StreetSurfaceBand).max(24),
	})
	.superRefine((interval, ctx) => {
		if (interval.end <= interval.start)
			ctx.addIssue({
				code: "custom",
				message: "Interval end must exceed start",
			});
		const ids = [
			...interval.lanes,
			...interval.leftBands,
			...interval.rightBands,
		].map((item) => item.id);
		if (new Set(ids).size !== ids.length)
			ctx.addIssue({
				code: "custom",
				message: "Each physical lane or band must occur once per interval",
			});
	});
export const StreetSectionLayout = z
	.strictObject({
		format: z.literal("street-section-layout"),
		schemaVersion: z.literal(1),
		length: z.number().finite().positive(),
		intervals: z.array(StreetSectionLayoutInterval).min(1),
	})
	.superRefine((layout, ctx) => {
		const ids = new Set<string>();
		let station = 0;
		for (const interval of layout.intervals) {
			if (ids.has(interval.id))
				ctx.addIssue({
					code: "custom",
					message: "Interval IDs must be unique",
				});
			ids.add(interval.id);
			if (Math.abs(interval.start - station) > 1e-6)
				ctx.addIssue({
					code: "custom",
					message:
						"Intervals must be ordered, contiguous and nonoverlapping from station zero",
				});
			station = interval.end;
		}
		if (Math.abs(station - layout.length) > 1e-6)
			ctx.addIssue({
				code: "custom",
				message: "Intervals must cover the reference span",
			});
	});
export type StreetSectionLayout = z.infer<typeof StreetSectionLayout>;
export function summarizeStreetSectionInterval(
	interval: z.infer<typeof StreetSectionLayoutInterval>,
) {
	const trafficWidth = interval.lanes.reduce(
		(sum, lane) => sum + lane.width,
		0,
	);
	const surfaceWidth = [...interval.leftBands, ...interval.rightBands].reduce(
		(sum, band) => sum + band.width,
		0,
	);
	return {
		trafficLaneCount: interval.lanes.length,
		trafficWidth,
		surfaceWidth,
		totalWidth: trafficWidth + surfaceWidth,
	};
}
