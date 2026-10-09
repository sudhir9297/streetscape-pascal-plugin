import { z } from "zod";
import { ImageryObservationEvidence } from "./imagery-observation";

const Id = z
	.string()
	.min(1)
	.refine(
		(value) => value.trim() === value,
		"IDs must not contain surrounding whitespace",
	);
const Ids = z
	.array(Id)
	.refine(
		(ids) => new Set(ids).size === ids.length,
		"Evidence references must be unique",
	);
const DateTime = z.iso.datetime({ offset: true });

/** An observation is evidence about reality, never a proposed design. */
export const StreetObservation = z.strictObject({
	id: Id,
	description: z.string().trim().min(1),
	observedAt: DateTime.nullable(),
	sourceReferenceId: Id.nullable(),
	sourceFeatureId: Id.nullable(),
	referenceUri: z.url().nullable(),
	imagery: ImageryObservationEvidence.optional(),
});
export type StreetObservation = z.infer<typeof StreetObservation>;

export const StreetValueOrigin = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("source"),
		sourceReferenceId: Id,
		sourceFeatureId: Id.nullable(),
	}),
	z.strictObject({
		kind: z.literal("inferred"),
		ruleId: Id,
		ruleVersion: Id,
		basisClaimIds: Ids,
		observationIds: Ids,
	}),
	z.strictObject({ kind: z.literal("observed"), observationIds: Ids.min(1) }),
	z.strictObject({
		kind: z.literal("authored"),
		reason: z.string().trim().min(1),
	}),
	z.strictObject({ kind: z.literal("legacy-authored") }),
]);
export type StreetValueOrigin = z.infer<typeof StreetValueOrigin>;

export const StreetValueClaim = z.strictObject({
	id: Id,
	value: z.json(),
	origin: StreetValueOrigin,
});
export type StreetValueClaim = z.infer<typeof StreetValueClaim>;

export const StreetBaselineCorrection = z.strictObject({
	kind: z.literal("correction"),
	value: z.json(),
	reason: z.string().trim().min(1),
	acceptedAt: DateTime,
	observationIds: Ids,
	supersedesClaimId: Id.nullable(),
});
export type StreetBaselineCorrection = z.infer<typeof StreetBaselineCorrection>;

export const StreetPropertyTarget = z.strictObject({
	category: z.enum(["roads", "features"]),
	featureId: Id,
	// Explicit path tokens distinguish an array index from a numeric object key.
	path: z
		.array(
			z.union([
				z
					.string()
					.min(1)
					.refine(
						(value) =>
							!["__proto__", "prototype", "constructor"].includes(value),
						"Unsafe property path",
					),
				z.number().int().nonnegative(),
			]),
		)
		.min(1),
});
export type StreetPropertyTarget = z.infer<typeof StreetPropertyTarget>;

export const StreetPropertyEvidence = z.strictObject({
	id: Id,
	target: StreetPropertyTarget,
	units: z.string().min(1).nullable(),
	claims: z.record(Id, StreetValueClaim),
	rejectedClaims: z.array(
		z.strictObject({ claimId: Id, reason: z.string().trim().min(1) }),
	),
	accepted: z.union([
		z.strictObject({ kind: z.literal("claim"), claimId: Id }),
		StreetBaselineCorrection,
	]),
});
export type StreetPropertyEvidence = z.infer<typeof StreetPropertyEvidence>;

export const StreetDesignOverride = z.strictObject({
	value: z.json(),
	reason: z.string().trim().min(1),
	authoredAt: DateTime,
});
export type StreetDesignOverride = z.infer<typeof StreetDesignOverride>;

/** Read only existing own properties; never resolve prototype fields or invent data. */
export function hasStreetPropertyPath(
	data: unknown,
	path: StreetPropertyTarget["path"],
): boolean {
	let current = data;
	for (const token of path) {
		if (current === null || typeof current !== "object") return false;
		if (Array.isArray(current) !== (typeof token === "number")) return false;
		if (!Object.hasOwn(current, token)) return false;
		current = (current as Record<string | number, unknown>)[token];
	}
	return true;
}
