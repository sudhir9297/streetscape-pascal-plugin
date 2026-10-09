/** Synthetic asymmetric interval fixture; not observed street data. */
export const asymmetricLayout = {
	format: "street-section-layout",
	schemaVersion: 1,
	length: 30,
	intervals: [
		{
			id: "first",
			start: 0,
			end: 10,
			lanes: [
				{ id: "lane-a", direction: "backward", use: "general", width: 3 },
				{ id: "lane-b", direction: "forward", use: "bus", width: 3.2 },
			],
			leftBands: [
				{ id: "walk-left", kind: "sidewalk", width: 2 },
				{ id: "cycle", kind: "protected-cycling", width: 1.2 },
				{ id: "curb", kind: "curb", width: 0.15 },
			],
			rightBands: [
				{ id: "parking", kind: "parking", width: 2 },
				{ id: "walk-right", kind: "sidewalk", width: 1.5 },
			],
		},
		{
			id: "second",
			start: 10,
			end: 30,
			lanes: [
				{ id: "lane-a", direction: "backward", use: "general", width: 3 },
				{ id: "lane-b", direction: "forward", use: "bus", width: 3.2 },
			],
			leftBands: [
				{ id: "walk-left", kind: "sidewalk", width: 3 },
				{ id: "cycle", kind: "protected-cycling", width: 1.2 },
				{ id: "curb", kind: "curb", width: 0.15 },
			],
			rightBands: [{ id: "walk-right", kind: "sidewalk", width: 1.5 }],
		},
	],
};
