"use client";
import { useState } from "react";
import { useScene } from "@pascal-app/core";
import { z } from "zod";
import type { PersistedStreetProject } from "./host/street-project-persistence";
import { prepareImageryAssetCorrection } from "./host/imagery-asset-correction";
import { commitHostStreetChangeSet } from "./host/application-change-set";
import { ROAD_SIGN_IDS } from "./road-sign-config";
export function ImageryAssetCorrectionReview({
	siteId,
	stored,
	id,
}: {
	siteId: string;
	stored: PersistedStreetProject;
	id: string;
}) {
	const nodes = useScene((state) => state.nodes),
		imagery = stored.project.observations?.[id]?.imagery;
	const [position, setPosition] = useState(["", "", ""]),
		[sign, setSign] = useState("stop"),
		[reason, setReason] = useState(""),
		[message, setMessage] = useState("");
	const [review, setReview] = useState<ReturnType<
		typeof prepareImageryAssetCorrection
	> | null>(null);
	if (
		!imagery ||
		imagery.status !== "accepted" ||
		!imagery.target.assetFeatureId
	)
		return null;
	const binding = stored.projection.bindings.find(
			(binding) =>
				binding.category === "features" &&
				binding.featureId === imagery.target.assetFeatureId,
		),
		node = binding?.nodeIds[0]
			? nodes[binding.nodeIds[0] as keyof typeof nodes]
			: null;
	if (!node) return <p>Asset identity missing; correction requires review.</p>;
	const lamp = imagery.claim.kind === "lamp-location",
		signClaim = imagery.claim.kind === "sign-type";
	if (!lamp && !signClaim) return null;
	const invalidate = () => setReview(null);
	return (
		<section
			aria-label="Imagery asset correction"
			style={{ display: "grid", gap: 6 }}
		>
			<p>
				Asset: {imagery.target.assetFeatureId} · Current position:{" "}
				{JSON.stringify("position" in node ? node.position : null)}
			</p>
			{lamp ? (
				<>
					<p>
						Enter an explicitly authored site position in metres. The image does
						not determine metric coordinates automatically.
					</p>
					{["X", "Y", "Z"].map((axis, index) => (
						<label key={axis}>
							Authored site {axis}
							<input
								aria-label={`Imagery asset ${axis}`}
								value={position[index]}
								onChange={(event) => {
									setPosition((current) =>
										current.map((value, i) =>
											i === index ? event.target.value : value,
										),
									);
									invalidate();
								}}
							/>
						</label>
					))}
				</>
			) : (
				<label>
					Catalog sign
					<select
						aria-label="Imagery corrected sign"
						value={sign}
						onChange={(event) => {
							setSign(event.target.value);
							invalidate();
						}}
					>
						{ROAD_SIGN_IDS.map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</label>
			)}
			<label>
				Correction reason and positioning basis
				<input
					aria-label="Imagery asset correction reason"
					value={reason}
					onChange={(event) => {
						setReason(event.target.value);
						invalidate();
					}}
				/>
			</label>
			<button
				type="button"
				onClick={() => {
					try {
						if (lamp && position.some((value) => !value.trim()))
							throw Error("Enter all three explicitly authored coordinates.");
						setReview(
							prepareImageryAssetCorrection(
								siteId,
								id,
								lamp
									? {
											position: position.map(Number) as [
												number,
												number,
												number,
											],
										}
									: { signId: sign },
								reason,
							),
						);
						setMessage("Correction prepared; no scene changes yet.");
					} catch (error) {
						setReview(null);
						setMessage(
							error instanceof z.ZodError
								? error.issues.map((issue) => issue.message).join(". ")
								: error instanceof Error
									? error.message
									: "Correction failed.",
						);
					}
				}}
			>
				Review imagery asset correction
			</button>
			{review && (
				<>
					<button
						type="button"
						onClick={() => {
							try {
								commitHostStreetChangeSet(review);
								setReview(null);
								setMessage(
									"Asset correction applied with retained imagery evidence.",
								);
							} catch (error) {
								setReview(null);
								setMessage(
									error instanceof Error ? error.message : "Correction failed.",
								);
							}
						}}
					>
						Apply imagery asset correction
					</button>
					<button
						type="button"
						onClick={() => {
							setReview(null);
							setMessage("Correction cancelled; scene unchanged.");
						}}
					>
						Cancel imagery asset correction
					</button>
				</>
			)}
			{message && <p role="status">{message}</p>}
		</section>
	);
}
