import { expect, test } from "bun:test";
import { StreetSectionLayout } from "./street-section-layout";
import { asymmetricLayout } from "./street-section-layout-fixture";
import { splitStreetSectionLayout } from "./street-section-layout-split";

test("split within an interval preserves stable physical identities, parking interruption and editable widths", () => {
	const layout = StreetSectionLayout.parse(asymmetricLayout);
	const before = JSON.stringify(layout);
	const [first, second] = splitStreetSectionLayout(layout, 15);
	expect(first.length).toBe(15);
	expect(second.length).toBe(15);
	expect(first.intervals.map((i) => [i.start, i.end])).toEqual([
		[0, 10],
		[10, 15],
	]);
	expect(second.intervals.map((i) => [i.start, i.end])).toEqual([[0, 15]]);
	expect(first.intervals[0]!.rightBands.some((b) => b.kind === "parking")).toBe(
		true,
	);
	expect(
		second.intervals[0]!.rightBands.some((b) => b.kind === "parking"),
	).toBe(false);
	expect(second.intervals[0]!.lanes).toEqual(layout.intervals[1]!.lanes);
	second.intervals[0]!.leftBands[0]!.width = 4;
	expect(
		StreetSectionLayout.parse(second).intervals[0]!.leftBands[0]!.width,
	).toBe(4);
	expect(JSON.stringify(layout)).toBe(before);
});
test("exact-boundary split creates no zero-length intervals and rejects endpoint/nonfinite splits", () => {
	const layout = StreetSectionLayout.parse(asymmetricLayout);
	const [first, second] = splitStreetSectionLayout(layout, 10);
	expect(first.intervals).toHaveLength(1);
	expect(second.intervals).toHaveLength(1);
	for (const station of [0, 30, -1, 31, NaN, Infinity])
		expect(() => splitStreetSectionLayout(layout, station)).toThrow();
});
