import { z } from "zod";
import {
	StreetImageReference,
	MANUAL_IMAGERY_FALLBACK,
	type StreetImageryCoverage,
} from "../domain/street-imagery";

const Image = z.looseObject({
	id: z.string().regex(/^\d+$/),
	captured_at: z.number().int().nonnegative().optional(),
	geometry: z
		.strictObject({
			type: z.literal("Point"),
			coordinates: z.tuple([
				z.number().min(-180).max(180),
				z.number().min(-90).max(90),
			]),
		})
		.optional(),
	compass_angle: z.number().finite().optional(),
	is_pano: z.boolean().optional(),
	thumb_1024_url: z.url().optional(),
	creator: z
		.looseObject({ id: z.string().optional(), username: z.string().min(1) })
		.optional(),
});
const ResponseBody = z.looseObject({
	data: z.array(Image),
	paging: z.looseObject({ next: z.string().optional() }).optional(),
});

export function normalizeMapillaryImage(input: unknown, acquiredAt: string) {
	const image = Image.parse(input);
	if (!image.creator?.username)
		throw Error(
			"Mapillary image has no creator attribution; review metadata before displaying it",
		);
	return StreetImageReference.parse({
		format: "street-image-reference",
		schemaVersion: 1,
		id: `mapillary~${image.id}`,
		provider: "mapillary",
		providerImageId: image.id,
		pageUrl: `https://www.mapillary.com/app/?pKey=${image.id}&focus=photo`,
		imageUrl: image.thumb_1024_url ?? null,
		capturedAt:
			image.captured_at === undefined
				? null
				: new Date(image.captured_at).toISOString(),
		location: image.geometry
			? {
					lat: image.geometry.coordinates[1],
					lon: image.geometry.coordinates[0],
				}
			: null,
		locationBasis: image.geometry ? "provider-reported" : "unknown",
		locationAccuracyMeters: null,
		headingDegrees:
			image.compass_angle === undefined
				? null
				: ((image.compass_angle % 360) + 360) % 360,
		panoramic: image.is_pano ?? null,
		creator: {
			name: image.creator.username,
			profileUrl: `https://www.mapillary.com/app/user/${encodeURIComponent(image.creator.username)}`,
		},
		license: {
			name: "CC BY-SA 4.0",
			url: "https://creativecommons.org/licenses/by-sa/4.0/",
		},
		acquiredAt,
		availability: image.thumb_1024_url ? "image-available" : "linked",
		uncertainty:
			"Provider GPS accuracy is unknown. Capture date does not establish current conditions. Uncalibrated images do not establish metric dimensions.",
	});
}

/** Explicit bounded acquisition. No token or signed thumbnail is copied into scene facts. */
export async function acquireMapillaryCoverage(input: {
	bounds: { south: number; west: number; north: number; east: number };
	accessToken?: string;
	signal?: AbortSignal;
	fetch?: (url: string | URL, options?: RequestInit) => Promise<Response>;
	now?: () => string;
}): Promise<StreetImageryCoverage> {
	const checkedAt = input.now?.() ?? new Date().toISOString();
	const empty = (
		status: StreetImageryCoverage["status"],
		message: string,
	): StreetImageryCoverage => ({
		status,
		references: [],
		checkedAt,
		message: `${message} ${MANUAL_IMAGERY_FALLBACK}`,
		truncated: false,
	});
	if (!input.accessToken?.trim())
		return empty("not-configured", "Mapillary imagery is not configured.");
	const bounds = z
		.strictObject({
			south: z.number().min(-90).max(90),
			north: z.number().min(-90).max(90),
			west: z.number().min(-180).max(180),
			east: z.number().min(-180).max(180),
		})
		.refine(
			(b) =>
				b.south < b.north &&
				b.west < b.east &&
				b.north - b.south <= 0.02 &&
				b.east - b.west <= 0.02,
			"Choose an imagery area no larger than 0.02 degrees per side",
		)
		.parse(input.bounds);
	const url = new URL("https://graph.mapillary.com/images");
	url.searchParams.set(
		"bbox",
		`${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
	);
	url.searchParams.set("limit", "100");
	url.searchParams.set(
		"fields",
		"id,captured_at,geometry,compass_angle,is_pano,thumb_1024_url,creator",
	);
	try {
		const response = await (input.fetch ?? fetch)(url, {
			headers: { Authorization: `OAuth ${input.accessToken}` },
				signal: input.signal
					? AbortSignal.any([input.signal, AbortSignal.timeout(10_000)])
					: AbortSignal.timeout(10_000),
			credentials: "omit",
			cache: "no-store",
			redirect: "error",
		});
		if (!response.ok)
			return empty(
				"unavailable",
				response.status === 401 || response.status === 403
					? "Mapillary authorization was rejected."
					: response.status === 429
						? "Mapillary request limit reached; retry later."
						: "Mapillary imagery service is unavailable.",
			);
		const body = ResponseBody.parse(await response.json());
		const references = body.data.map((image) =>
			normalizeMapillaryImage(image, checkedAt),
		);
		return {
			status: references.length ? "available" : "no-coverage",
			references,
			checkedAt,
			truncated: Boolean(body.paging?.next),
			message: references.length
				? "Review capture date, attribution and location before using these images as evidence."
				: MANUAL_IMAGERY_FALLBACK,
		};
	} catch (error) {
		if (input.signal?.aborted) throw error;
		return empty(
			"unavailable",
			"Mapillary imagery could not be loaded or its metadata could not be validated.",
		);
	}
}
