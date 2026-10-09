import { expect, test } from "bun:test";
import {
	StreetSectionLayout,
	summarizeStreetSectionInterval,
} from "./street-section-layout";
import { asymmetricLayout } from "./street-section-layout-fixture";

test("asymmetric ordered intervals keep cycling and parking outside traffic lane counts", () => {
	const layout = StreetSectionLayout.parse(asymmetricLayout);
	expect(summarizeStreetSectionInterval(layout.intervals[0]!)).toEqual({
		trafficLaneCount: 2,
		trafficWidth: 6.2,
		surfaceWidth: 6.85,
		totalWidth: 13.05,
	});
	expect(StreetSectionLayout.parse(JSON.parse(JSON.stringify(layout)))).toEqual(
		layout,
	);
	expect(layout.intervals[1]!.leftBands[0]!.width).toBe(3);
});
test("rejects duplicate physical entries, gaps, overlaps, unordered intervals and vehicle widths on traffic lanes", () => {
	for (const mutate of [
		(l: StreetSectionLayout) => {
			l.intervals[0]!.leftBands[0]!.id = "lane-a";
		},
		(l: StreetSectionLayout) => {
			l.intervals[1]!.start = 11;
		},
		(l: StreetSectionLayout) => {
			l.intervals[1]!.start = 9;
		},
		(l: StreetSectionLayout) => {
			l.intervals.reverse();
		},
		(l: StreetSectionLayout) => {
			l.intervals[0]!.lanes[0]!.width = 1.2;
		},
	]) {
		const layout = StreetSectionLayout.parse(asymmetricLayout);
		mutate(layout);
		expect(StreetSectionLayout.safeParse(layout).success).toBe(false);
	}
});
