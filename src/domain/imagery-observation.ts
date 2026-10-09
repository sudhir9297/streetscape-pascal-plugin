import { z } from "zod";
import { StreetImageReference } from "./street-imagery";
const Text = z.string().trim().min(1);
export const ImageryObservationEvidence = z
	.strictObject({
		format: z.literal("imagery-observation"),
		schemaVersion: z.literal(1),
		status: z.enum(["pending", "accepted", "rejected"]),
		image: StreetImageReference,
		target: z.strictObject({
			roadId: Text,
			edgeId: Text,
			assetFeatureId: Text.optional(),
		}),
		uncertainty: Text,
		review: z
			.strictObject({
				reason: Text,
				reviewedAt: z.iso.datetime({ offset: true }),
				acknowledgedConflicts: z.boolean(),
			})
			.optional(),
		claim: z.discriminatedUnion("kind", [
			z.strictObject({
				kind: z.literal("sidewalk-presence"),
				side: z.enum(["left", "right"]),
				present: z.boolean(),
			}),
			z.strictObject({ kind: z.literal("surface"), material: Text }),
			z.strictObject({ kind: z.literal("sign-type"), signType: Text }),
			z.strictObject({
				kind: z.literal("lamp-location"),
				locationDescription: Text,
			}),
			z.strictObject({
				kind: z.literal("measurement"),
				property: Text,
				valueMeters: z.number().positive(),
				calibrationReference: z.url().refine((value) => {
					const url = URL.parse(value);
					return (
						!!url &&
						["http:", "https:"].includes(url.protocol) &&
						!url.username &&
						!url.password
					);
				}, "Use an HTTP calibration reference"),
				method: Text,
			}),
		]),
	})
	.superRefine((evidence, context) => {
		if (evidence.status !== "pending" && !evidence.review)
			context.addIssue({
				code: "custom",
				path: ["review"],
				message: "Accepted or rejected imagery requires a dated review reason.",
			});
		if (evidence.status === "pending" && evidence.review)
			context.addIssue({
				code: "custom",
				path: ["review"],
				message: "Pending imagery cannot contain an accepted review decision.",
			});
	});
export type ImageryObservationEvidence = z.infer<
	typeof ImageryObservationEvidence
>;
