"use client";
import { ImageryAssetCorrectionReview } from "./imagery-asset-correction-review";
import { useState } from "react";
import { z } from "zod";
import type { PersistedStreetProject } from "./host/street-project-persistence";
import {
	inspectImageryObservation,
	reviewImageryObservation,
} from "./host/review-imagery-observation";
export function ImageryObservationDecision({
	siteId,
	stored,
	id,
}: {
	siteId: string;
	stored: PersistedStreetProject;
	id: string;
}) {
	const [reason, setReason] = useState(""),
		[acknowledged, setAcknowledged] = useState(false),
		[message, setMessage] = useState("");
	const observation = stored.project.observations?.[id];
	if (!observation?.imagery) return null;
	const review = inspectImageryObservation(stored, id);
	const decide = (decision: "accepted" | "rejected") => {
		try {
			reviewImageryObservation(siteId, stored.project.revision, {
				id,
				decision,
				reason,
				reviewedAt: new Date().toISOString(),
				acknowledgeConflicts: acknowledged,
			});
			setMessage(`Observation ${decision}; accepted geometry unchanged.`);
		} catch (error) {
			setMessage(
				error instanceof z.ZodError
					? error.issues.map((issue) => issue.message).join(". ")
					: error instanceof Error
						? error.message
						: "Review failed.",
			);
		}
	};
	return (
		<section
			aria-label={`Review observation: ${observation.description}`}
			style={{ display: "grid", gap: 6 }}
		>
			<p>
				Current fact:{" "}
				{review.current === null
					? "Unknown or requires asset/manual review"
					: JSON.stringify(review.current)}{" "}
				· Image claim:{" "}
				{review.proposed === null
					? "Descriptive claim; no automatic correction"
					: JSON.stringify(review.proposed)}
			</p>
			{!review.targetExists && (
				<p>Road section missing. Resolve identity before acceptance.</p>
			)}
			{review.contradictsCurrent && (
				<p>
					This image claim conflicts with the currently accepted fact. Capture
					date does not establish current conditions.
				</p>
			)}
			{review.conflicts.map((conflict) => (
				<p key={conflict.id}>
					Conflicting observation: {conflict.description} ·{" "}
					{conflict.date ?? "Unknown date"} · {conflict.status}
				</p>
			))}
			{observation.imagery.review && (
				<p>
					Decision: {observation.imagery.review.reason} · Reviewed{" "}
					{observation.imagery.review.reviewedAt}
				</p>
			)}
			{observation.imagery.status === "pending" && (
				<>
					<label>
						Review reason
						<input
							aria-label="Imagery review reason"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							style={{
								width: "100%",
								padding: 6,
								border: "1px solid #666",
								borderRadius: 6,
							}}
						/>
					</label>
					<label>
						<input
							type="checkbox"
							aria-label="Acknowledge imagery conflicts"
							checked={acknowledged}
							onChange={(event) => setAcknowledged(event.target.checked)}
						/>{" "}
						I reviewed conflicting facts, image age and uncertainty.
					</label>
					<button type="button" onClick={() => decide("accepted")}>
						Accept observation evidence
					</button>
					<button type="button" onClick={() => decide("rejected")}>
						Reject observation evidence
					</button>
				</>
			)}
			<ImageryAssetCorrectionReview siteId={siteId} stored={stored} id={id} />
			{message && <p role="status">{message}</p>}
		</section>
	);
}
