import { test, expect } from "bun:test";
import { encodeStoredReport, decodeStoredReport } from "./report-storage";

test("large reports compress losslessly, including Unicode and repeated evidence", () => {
	const report = {
		items: Array.from({ length: 3000 }, (_, i) => ({
			id: i,
			evidence: {
				name: "道路 · Baker Street",
				raw: "captured evidence ".repeat(30),
			},
		})),
	};
	const saved = encodeStoredReport(report);
	expect(saved.length).toBeLessThan(JSON.stringify(report).length / 5);
	expect(decodeStoredReport(saved)).toEqual(report);
	expect(decodeStoredReport(JSON.parse(saved))).toEqual(report);
});
test("small and legacy JSON reports remain compatible", () => {
	const report = { schemaVersion: 1, items: [{ value: 12 }] };
	expect(encodeStoredReport(report)).toBe(JSON.stringify(report));
	expect(decodeStoredReport(JSON.stringify(report))).toEqual(report);
	expect(decodeStoredReport(report)).toEqual(report);
});
test("invalid versions, sizes and corrupt reports reject", () => {
	const envelope = JSON.parse(
		encodeStoredReport({ data: "repeated ".repeat(100000) }),
	);
	expect(() => decodeStoredReport({ ...envelope, version: 2 })).toThrow(
		"Invalid compressed",
	);
	expect(() =>
		decodeStoredReport({ ...envelope, byteLength: 100000000 }),
	).toThrow("Invalid compressed");
	expect(() =>
		decodeStoredReport({ ...envelope, byteLength: envelope.byteLength + 1 }),
	).toThrow("size mismatch");
	const raw = atob(envelope.data),
		index = raw.length - 8;
	const corrupted =
		raw.slice(0, index) +
		String.fromCharCode(raw.charCodeAt(index) ^ 1) +
		raw.slice(index + 1);
	expect(() =>
		decodeStoredReport({ ...envelope, data: btoa(corrupted) }),
	).toThrow("checksum mismatch");
});
