import { z } from "zod";
import { StreetObservation } from "../domain/street-evidence";
export const BaselineCorrectionContext = z.strictObject({
	edgeId: z.string().min(1).optional(),
	reason: z.string().trim().min(1),
	observations: z.array(StreetObservation).default([]),
	observationIds: z.array(z.string().min(1)).default([]),
});
export type BaselineCorrectionContext = z.infer<
	typeof BaselineCorrectionContext
>;
