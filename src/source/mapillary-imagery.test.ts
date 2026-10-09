import { expect, test } from "bun:test";
import {
	acquireMapillaryCoverage,
	normalizeMapillaryImage,
} from "./mapillary-imagery";
import { createManualImageReference } from "../domain/street-imagery";

const bounds = {
	south: 37.7825,
	north: 37.7845,
	west: -122.41,
	east: -122.407,
};
const now = () => "2026-10-09T06:00:00Z";
test("no imagery credentials needs no request and provides an explicit manual fallback", async () => {
	let requests = 0;
	const result = await acquireMapillaryCoverage({
		bounds,
		now,
		fetch: async () => {
			requests++;
			throw Error("not expected");
		},
	});
	expect(requests).toBe(0);
	expect(result.status).toBe("not-configured");
	expect(result.message).toContain("photo you own");
	expect(result.references).toEqual([]);
});
test("normalization retains date, location, heading and attribution without inventing metric accuracy", () => {
	const reference = normalizeMapillaryImage(
		{
			id: "799922972744746",
			captured_at: Date.parse("2025-08-17T07:54:42Z"),
			compass_angle: 404,
			creator: { username: "marker_geo" },
			geometry: { type: "Point", coordinates: [-122.408, 37.783] },
			is_pano: false,
		},
		now(),
	);
	expect(reference.capturedAt).toBe("2025-08-17T07:54:42.000Z");
	expect(reference.headingDegrees).toBe(44);
	expect(reference.creator.name).toBe("marker_geo");
	expect(reference.locationAccuracyMeters).toBeNull();
	expect(reference.imageUrl).toBeNull();
	expect(reference.availability).toBe("linked");
	const sparse = normalizeMapillaryImage(
		{ id: "1", creator: { username: "author" } },
		now(),
	);
	expect(sparse.capturedAt).toBeNull();
	expect(sparse.location).toBeNull();
	expect(sparse.headingDegrees).toBeNull();
	expect(() => normalizeMapillaryImage({ id: "1" }, now())).toThrow(
		"creator attribution",
	);
});
test("bounded acquisition uses the configured token only in headers and retains truncation", async () => {
	let url = "",
		auth = "";
	const result = await acquireMapillaryCoverage({
		bounds,
		accessToken: "test-client-token",
		now,
		fetch: async (request, options) => {
			url = String(request);
			auth = (options!.headers as Record<string, string>).Authorization!;
			return Response.json({
				data: [{ id: "1", creator: { username: "author" } }],
				paging: {
					next: "https://graph.mapillary.com/images?access_token=must-not-follow",
				},
			});
		},
	});
	expect(url).not.toContain("test-client-token");
	expect(auth).toBe("OAuth test-client-token");
	expect(result.truncated).toBe(true);
	expect(JSON.stringify(result)).not.toContain("must-not-follow");
	expect(result.status).toBe("available");
});
test("empty coverage, authorization failure, rate limits and malformed metadata remain distinct from coverage", async () => {
	for (const [response, expected] of [
		[Response.json({ data: [] }), "no-coverage"],
		[new Response("", { status: 401 }), "unavailable"],
		[new Response("", { status: 429 }), "unavailable"],
		[Response.json({ data: [{ id: "1" }] }), "unavailable"],
	] as const) {
		const result = await acquireMapillaryCoverage({
			bounds,
			accessToken: "test",
			now,
			fetch: async () => response,
		});
		expect(result.status).toBe(expected);
		expect(result.references).toEqual([]);
	}
});
test("manual references preserve unknown dates and reject active URLs or credential-bearing links", () => {
	const input = {
		id: "manual~1",
		pageUrl: "https://example.com/my-photo",
		imageUrl: null,
		capturedAt: null,
		location: null,
		locationBasis: "unknown" as const,
		locationAccuracyMeters: null,
		headingDegrees: null,
		panoramic: null,
		creator: { name: "Owner", profileUrl: null },
		license: { name: "User-owned", url: null },
		acquiredAt: now(),
		availability: "linked" as const,
		uncertainty: "No reliable capture date or coordinates",
	};
	expect(createManualImageReference(input).capturedAt).toBeNull();
	expect(() =>
		createManualImageReference({ ...input, pageUrl: "javascript:alert(1)" }),
	).toThrow();
	expect(() =>
		createManualImageReference({
			...input,
			pageUrl: "https://example.com/photo?access_token=secret",
		}),
	).toThrow();
	expect(() =>
		createManualImageReference({ ...input, locationBasis: "user-positioned" }),
	).toThrow();
});
