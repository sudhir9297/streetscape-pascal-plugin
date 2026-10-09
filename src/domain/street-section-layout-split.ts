import { StreetSectionLayout } from "./street-section-layout";

/** Clip authored station intervals into two editable, independently owned spans. */
export function splitStreetSectionLayout(
	input: StreetSectionLayout,
	station: number,
): [StreetSectionLayout, StreetSectionLayout] {
	const layout = StreetSectionLayout.parse(input);
	if (!Number.isFinite(station) || station <= 0 || station >= layout.length)
		throw Error("Split station must be strictly inside the section span");
	const clip = (start: number, end: number) =>
		StreetSectionLayout.parse({
			...layout,
			length: end - start,
			intervals: layout.intervals
				.filter((interval) => interval.end > start && interval.start < end)
				.map((interval) => ({
					...structuredClone(interval),
					...Object.fromEntries(
						(["lanes", "leftBands", "rightBands"] as const).map((key) => [
							key,
							interval[key].map((item) => {
								if (
									item.startWidth === undefined &&
									item.endWidth === undefined
								)
									return structuredClone(item);
								const widthAt = (station: number) =>
									(item.startWidth ?? item.width) +
									(((item.endWidth ?? item.width) -
										(item.startWidth ?? item.width)) *
										(station - interval.start)) /
										(interval.end - interval.start);
								return {
									...item,
									startWidth: widthAt(Math.max(start, interval.start)),
									endWidth: widthAt(Math.min(end, interval.end)),
								};
							}),
						]),
					),
					start: Math.max(start, interval.start) - start,
					end: Math.min(end, interval.end) - start,
				})),
		});
	return [clip(0, station), clip(station, layout.length)];
}
