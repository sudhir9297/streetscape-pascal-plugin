import { z } from "zod";

const HttpUrl = z.url().refine((value) => {
	const url = new URL(value);
	return (
		["http:", "https:"].includes(url.protocol) &&
		!url.username &&
		!url.password &&
		!Array.from(url.searchParams.keys()).some((key) =>
			/^(access_token|token|api_key|key)$/i.test(key),
		)
	);
}, "Use an HTTP image/reference URL without embedded credentials");

/** A dated visual reference is evidence, not a calibrated measurement. */
export const StreetImageReference = z
	.strictObject({
		format: z.literal("street-image-reference"),
		schemaVersion: z.literal(1),
		id: z.string().min(1),
		provider: z.enum(["mapillary", "manual"]),
		providerImageId: z.string().min(1).nullable(),
		pageUrl: HttpUrl,
		imageUrl: HttpUrl.nullable(),
		capturedAt: z
			.union([z.iso.datetime({ offset: true }), z.iso.date()])
			.nullable(),
		location: z
			.strictObject({
				lat: z.number().min(-90).max(90),
				lon: z.number().min(-180).max(180),
			})
			.nullable(),
		locationBasis: z.enum(["provider-reported", "user-positioned", "unknown"]),
		locationAccuracyMeters: z.number().nonnegative().nullable(),
		headingDegrees: z.number().min(0).lt(360).nullable(),
		panoramic: z.boolean().nullable(),
		creator: z.strictObject({
			name: z.string().trim().min(1),
			profileUrl: HttpUrl.nullable(),
		}),
		license: z.strictObject({
			name: z.string().trim().min(1),
			url: HttpUrl.nullable(),
		}),
		acquiredAt: z.iso.datetime({ offset: true }),
		availability: z.enum(["linked", "image-available", "unavailable"]),
		uncertainty: z.string().trim().min(1),
	})
	.superRefine((reference, context) => {
		if (reference.provider === "mapillary" && !reference.providerImageId)
			context.addIssue({
				code: "custom",
				path: ["providerImageId"],
				message: "Mapillary references require a stable image ID",
			});
		if (reference.location === null && reference.locationBasis !== "unknown")
			context.addIssue({
				code: "custom",
				path: ["locationBasis"],
				message: "A located reference requires coordinates",
			});
		if (reference.availability === "image-available" && !reference.imageUrl)
			context.addIssue({
				code: "custom",
				path: ["imageUrl"],
				message: "An available image requires an image URL",
			});
	});
export type StreetImageReference = z.infer<typeof StreetImageReference>;

export type StreetImageryCoverage = {
	status: "available" | "no-coverage" | "not-configured" | "unavailable";
	references: StreetImageReference[];
	checkedAt: string;
	message: string;
	/** Truncated results must not be presented as complete coverage. */
	truncated: boolean;
};

export const MANUAL_IMAGERY_FALLBACK =
	"Add a dated image reference or a photo you own, identify its location and author, and record unknown accuracy. Streets can be imported and corrected without imagery.";

/** No missing metadata is filled with the current date or assumed precise GPS. */
export function createManualImageReference(
	input: Omit<
		StreetImageReference,
		"format" | "schemaVersion" | "provider" | "providerImageId"
	>,
): StreetImageReference {
	return StreetImageReference.parse({
		...input,
		format: "street-image-reference",
		schemaVersion: 1,
		provider: "manual",
		providerImageId: null,
	});
}
