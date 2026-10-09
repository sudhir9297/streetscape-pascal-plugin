"use client";
import { z } from "zod";
import { ImageryObservationDecision } from "./imagery-observation-decision";
import { useState } from "react";
import { useScene } from "@pascal-app/core";
import type { StreetImageReference } from "./domain/street-imagery";
import { ImageryObservationEvidence } from "./domain/imagery-observation";
import type { ImageryRoadSection } from "./host/imagery-road-sections";
import { readStreetProjectView } from "./host/street-project-persistence";
import { recordImageryObservation } from "./host/record-imagery-observation";

export function ImageryObservationReview({
	image,
	section,
}: {
	image: StreetImageReference;
	section?: ImageryRoadSection;
}) {
	const nodes = useScene((state) => state.nodes);
	const owner = Object.values(nodes).find(
		(node) => node.type === "site" && readStreetProjectView(node),
	);
	const stored = owner ? readStreetProjectView(owner) : null;
	const [kind, setKind] =
		useState<ImageryObservationEvidence["claim"]["kind"]>("sidewalk-presence");
	const [value, setValue] = useState("");
	const [side, setSide] = useState<"left" | "right">("left");
	const [present, setPresent] = useState(true);
	const [assetFeatureId, setAssetFeatureId] = useState("");
	const [notes, setNotes] = useState("");
	const [uncertainty, setUncertainty] = useState("");
	const [calibration, setCalibration] = useState("");
	const [measurementProperty, setMeasurementProperty] = useState(
		"left sidewalk width",
	);
	const [method, setMethod] = useState("");
	const [message, setMessage] = useState("");
	const field = {
		width: "100%",
		padding: 6,
		border: "1px solid #666",
		borderRadius: 6,
	};

	return (
		<section
			aria-label="Record imagery observations"
			style={{ display: "grid", gap: 8 }}
		>
			<h4>Record an observation</h4>
			<p>
				Recording retains evidence as pending. It does not correct the accepted
				street. An uncalibrated image cannot establish metric width.
			</p>
			<p>
				Evidence: {image.creator.name} ·{" "}
				{image.capturedAt ?? "Unknown capture date"} ·{" "}
				{section?.label ?? "Select an imported road section"}
			</p>
			<label>
				Observation type
				<select
					style={field}
					aria-label="Imagery observation type"
					value={kind}
					onChange={(event) => setKind(event.target.value as typeof kind)}
				>
					<option value="sidewalk-presence">Sidewalk presence</option>
					<option value="surface">Road surface</option>
					<option value="sign-type">Sign type</option>
					<option value="lamp-location">Lamp location</option>
					<option value="measurement">Calibrated measurement</option>
				</select>
			</label>
			{kind === "sidewalk-presence" ? (
				<>
					<label>
						Side
						<select
							style={field}
							aria-label="Observed sidewalk side"
							value={side}
							onChange={(event) => setSide(event.target.value as typeof side)}
						>
							<option value="left">Left</option>
							<option value="right">Right</option>
						</select>
					</label>
					<label>
						Presence
						<select
							style={field}
							aria-label="Observed sidewalk presence"
							value={String(present)}
							onChange={(event) => setPresent(event.target.value === "true")}
						>
							<option value="true">Visible sidewalk</option>
							<option value="false">Evidence of absence</option>
						</select>
					</label>
				</>
			) : (
				<label>
					{kind === "measurement"
						? "Measured value (metres)"
						: "Observed value or location description"}
					<input
						style={field}
						aria-label="Imagery observation value"
						value={value}
						onChange={(event) => setValue(event.target.value)}
					/>
				</label>
			)}
			{kind === "measurement" && (
				<>
					<label>
						Calibration or surveyed reference URL
						<input
							style={field}
							aria-label="Measurement calibration reference"
							value={calibration}
							onChange={(event) => setCalibration(event.target.value)}
						/>
					</label>
					<label>
						Measurement property
						<select
							style={field}
							aria-label="Measurement property"
							value={measurementProperty}
							onChange={(event) => setMeasurementProperty(event.target.value)}
						>
							<option value="left sidewalk width">Left sidewalk width</option>
							<option value="right sidewalk width">Right sidewalk width</option>
							<option value="lane width">Lane width</option>
						</select>
					</label>
					<label>
						Measurement method
						<input
							style={field}
							aria-label="Measurement method"
							value={method}
							onChange={(event) => setMethod(event.target.value)}
						/>
					</label>
					<p>
						Supply a calibrated or independently measured reference; visual
						pixel estimates alone are unsupported.
					</p>
				</>
			)}
			{(kind === "sign-type" || kind === "lamp-location") && (
				<label>
					Mapped asset identity (optional)
					<select
						style={field}
						aria-label="Observation asset identity"
						value={assetFeatureId}
						onChange={(event) => setAssetFeatureId(event.target.value)}
					>
						<option value="">Section-level evidence; no specific asset</option>
						{stored?.projection.bindings
							.filter((binding) => binding.category === "features")
							.map((binding) => (
								<option key={binding.featureId} value={binding.featureId}>
									{binding.featureId}
								</option>
							))}
					</select>
				</label>
			)}
			<label>
				Observation description
				<textarea
					style={field}
					aria-label="Imagery observation description"
					value={notes}
					onChange={(event) => setNotes(event.target.value)}
				/>
			</label>
			<label>
				Uncertainty and limitations
				<textarea
					style={field}
					aria-label="Imagery observation uncertainty"
					value={uncertainty}
					onChange={(event) => setUncertainty(event.target.value)}
					placeholder="Visibility, age, occlusion, position or measurement limitations"
				/>
			</label>
			<button
				type="button"
				disabled={!owner || !stored || !section}
				onClick={() => {
					try {
						if (!owner || !stored || !section)
							throw Error("Select an imported road section first.");
						const claim =
							kind === "sidewalk-presence"
								? { kind, side, present }
								: kind === "surface"
									? { kind, material: value }
									: kind === "sign-type"
										? { kind, signType: value }
										: kind === "lamp-location"
											? { kind, locationDescription: value }
											: {
													kind,
													valueMeters: Number(value),
													property: measurementProperty,
													calibrationReference: calibration,
													method,
												};
						const evidence = ImageryObservationEvidence.parse({
							format: "imagery-observation",
							schemaVersion: 1,
							status: "pending",
							image,
							target: {
								roadId: section.roadId,
								edgeId: section.edgeId,
								...((kind === "sign-type" || kind === "lamp-location") &&
								assetFeatureId
									? { assetFeatureId }
									: {}),
							},
							uncertainty,
							claim,
						});
						recordImageryObservation(owner.id, stored.project.revision, {
							id: `observation~${crypto.randomUUID()}`,
							description: notes,
							evidence,
						});
						setMessage(
							"Observation recorded as pending. Accepted street unchanged.",
						);
					} catch (error) {
						setMessage(
							error instanceof z.ZodError
								? error.issues.map((issue) => issue.message).join(". ")
								: error instanceof Error
									? error.message
									: "Observation could not be recorded.",
						);
					}
				}}
			>
				Record pending observation
			</button>
			{message && <p role="status">{message}</p>}
			<RecordedImageryObservations />
		</section>
	);
}

export function RecordedImageryObservations() {
	const nodes = useScene((state) => state.nodes);
	const owners = Object.values(nodes)
		.filter((node) => node.type === "site")
		.map((node) => ({
			siteId: node.id,
			stored: readStreetProjectView(node),
		}))
		.filter((owner) => owner.stored);
	const observations = Object.values(nodes).flatMap((node) =>
		node.type === "site"
			? Object.values(
					readStreetProjectView(node)?.project.observations ?? {},
				).filter((observation) => observation.imagery)
			: [],
	);
	return (
		<section aria-label="Persisted imagery observations">
			{" "}
			<h4>Recorded observations ({observations.length})</h4>
			{observations.map((observation) => (
				<article
					key={observation.id}
					aria-label="Recorded imagery observation"
					style={{ padding: 8, border: "1px solid #666", borderRadius: 6 }}
				>
					<p>
						{observation.imagery!.status} · {observation.imagery!.claim.kind} ·{" "}
						{observation.description}
					</p>
					<p>Road section: {observation.imagery!.target.edgeId}</p>
					<a
						href={observation.imagery!.image.pageUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						Observation image evidence
					</a>
					<p>
						Captured: {observation.imagery!.image.capturedAt ?? "Unknown date"}{" "}
						· {observation.imagery!.image.creator.name}
					</p>
					<p>Claim: {JSON.stringify(observation.imagery!.claim)}</p>
					<p>Uncertainty: {observation.imagery!.uncertainty}</p>
					{owners
						.filter(
							(owner) => owner.stored?.project.observations?.[observation.id],
						)
						.map((owner) => (
							<ImageryObservationDecision
								key={owner.siteId}
								siteId={owner.siteId}
								stored={owner.stored!}
								id={observation.id}
							/>
						))}
				</article>
			))}
		</section>
	);
}
