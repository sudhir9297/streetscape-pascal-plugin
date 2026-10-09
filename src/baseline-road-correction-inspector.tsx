"use client";
import { useScene } from "@pascal-app/core";
import { readStreetProjectView } from "./host/street-project-persistence";
import { useState } from "react";
import { RoadNetworkNode, type RoadNetworkNode as Road } from "./schema";
import {
	editRoadEdgeRoadway,
	editRoadEdgeSide,
	resolveRoadStyleEditingScope,
} from "./road-network-style-editing";
import {
	prepareBaselineRoadCorrection,
	commitBaselineRoadCorrection,
} from "./baseline-road-correction";

export function BaselineRoadCorrectionInspector({ node }: { node: Road }) {
	const nodes = useScene((state) => state.nodes);
	const stored = Object.values(nodes)
		.filter((node) => node.type === "site")
		.map(readStreetProjectView)
		.find((document) =>
			document?.projection.bindings.some(
				(binding) =>
					binding.category === "roads" && binding.nodeIds.includes(node.id),
			),
		);
	const featureId = stored?.projection.bindings.find(
		(binding) =>
			binding.category === "roads" && binding.nodeIds.includes(node.id),
	)?.featureId;
	const [linkedIds, setLinkedIds] = useState<string[]>([]);
	const [edgeId, setEdgeId] = useState(Object.keys(node.edges)[0] ?? "");
	const [lane, setLane] = useState(""),
		[sidewalk, setSidewalk] = useState(""),
		[side, setSide] = useState<"left" | "right">("left");
	const [material, setMaterial] = useState(""),
		[shift, setShift] = useState(""),
		[junction, setJunction] = useState(""),
		[treatment, setTreatment] = useState("");
	const [reason, setReason] = useState(""),
		[evidence, setEvidence] = useState(""),
		[error, setError] = useState("");
	const [review, setReview] = useState<ReturnType<
		typeof prepareBaselineRoadCorrection
	> | null>(null);
	const invalidate = () => {
		setReview(null);
		setError("");
	};
	const reviewCorrection = () => {
		try {
			if (
				linkedIds.some((id) => {
					const imagery = stored?.project.observations?.[id]?.imagery;
					return (
						!imagery ||
						imagery.status !== "accepted" ||
						imagery.target.roadId !== featureId ||
						imagery.target.edgeId !== edgeId
					);
				})
			)
				throw Error(
					"Selected imagery evidence changed or belongs to another section. Review it again.",
				);
			if (!reason.trim())
				throw Error("Describe why the existing street needs this correction.");
			let draft = node;
			let patch: Partial<Road> = {};
			const merge = (next: Partial<Road> | null) => {
				if (next) {
					patch = { ...patch, ...next };
					draft = RoadNetworkNode.parse({ ...draft, ...next });
				}
			};
			if (lane)
				merge(editRoadEdgeRoadway(draft, edgeId, "laneWidth", Number(lane)));
			if (sidewalk)
				merge(
					editRoadEdgeSide(
						draft,
						edgeId,
						side,
						"sidewalkWidth",
						Number(sidewalk),
					),
				);
			if (material) {
				merge(
					editRoadEdgeRoadway(
						draft,
						edgeId,
						"laneWidth",
						resolveRoadStyleEditingScope(draft, edgeId).style.laneWidth,
					),
				);
				const id = draft.edges[edgeId]!.styleId;
				merge({
					stylePresets: {
						...draft.stylePresets,
						[id]: {
							...draft.stylePresets[id]!,
							surfaceMaterial: material as
								| "asphalt"
								| "concrete"
								| "paving-stones",
							surfaceSource: undefined,
						},
					},
				});
			}
			if (shift) {
				const edge = draft.edges[edgeId]!;
				const ids = new Set([edge.startNodeId, edge.endNodeId]);
				merge({
					graphNodes: Object.fromEntries(
						Object.entries(draft.graphNodes).map(([id, value]) => [
							id,
							ids.has(id)
								? {
										...value,
										position: [
											value.position[0] + Number(shift),
											value.position[1],
											value.position[2],
										],
									}
								: value,
						]),
					),
					edges: {
						...draft.edges,
						[edge.id]: {
							...edge,
							alignment: edge.alignment.map((p) => [
								p[0] + Number(shift),
								p[1],
								p[2],
							]),
						},
					},
				});
			}
			if (junction && treatment)
				merge({
					junctions: {
						...draft.junctions,
						[junction]: {
							...draft.junctions[junction]!,
							treatment: treatment as Road["junctions"][string]["treatment"],
						},
					},
				});
			if (!Object.keys(patch).length)
				throw Error("Choose at least one correction.");
			setReview(
				prepareBaselineRoadCorrection(node, patch, {
					reason,
					edgeId,
					observationIds: linkedIds,
					observations: evidence.trim()
						? [
								{
									id: `observation:${crypto.randomUUID()}`,
									description: evidence.trim(),
									observedAt: null,
									sourceReferenceId: null,
									sourceFeatureId: null,
									referenceUri: null,
								},
							]
						: [],
				}),
			);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Correction could not be prepared.",
			);
		}
	};
	return (
		<section
			aria-label="Correct accepted baseline"
			className="flex flex-col gap-2 text-xs"
		>
			<p>
				Correct the existing street. Applying creates an accepted baseline
				revision.
			</p>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Street segment
				<select
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Correction street segment"
					value={edgeId}
					onChange={(e) => {
						setEdgeId(e.target.value);
						invalidate();
					}}
				>
					{Object.keys(node.edges).map((id) => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</select>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Lane width (m)
				<input
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Corrected lane width"
					type="number"
					min="2.4"
					max="5"
					step=".05"
					value={lane}
					onChange={(e) => {
						setLane(e.target.value);
						invalidate();
					}}
				/>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Side
				<select
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Correction sidewalk side"
					value={side}
					onChange={(e) => {
						setSide(e.target.value as "left" | "right");
						invalidate();
					}}
				>
					<option value="left">Left</option>
					<option value="right">Right</option>
				</select>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Sidewalk width (m; 0 = absent)
				<input
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Corrected sidewalk width"
					type="number"
					min="0"
					max="6"
					step=".1"
					value={sidewalk}
					onChange={(e) => {
						setSidewalk(e.target.value);
						invalidate();
					}}
				/>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Material
				<select
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Corrected road material"
					value={material}
					onChange={(e) => {
						setMaterial(e.target.value);
						invalidate();
					}}
				>
					<option value="">Keep current material</option>
					<option value="asphalt">Asphalt</option>
					<option value="concrete">Concrete</option>
					<option value="paving-stones">Paving stones</option>
				</select>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Alignment east shift (m)
				<input
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Correction alignment shift"
					type="number"
					step=".1"
					value={shift}
					onChange={(e) => {
						setShift(e.target.value);
						invalidate();
					}}
				/>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Junction
				<select
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Correction junction"
					value={junction}
					onChange={(e) => {
						setJunction(e.target.value);
						invalidate();
					}}
				>
					<option value="">Keep junctions</option>
					{Object.keys(node.junctions).map((id) => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</select>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Treatment
				<select
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Corrected junction treatment"
					value={treatment}
					onChange={(e) => {
						setTreatment(e.target.value);
						invalidate();
					}}
				>
					<option value="">Keep current treatment</option>
					{["auto", "stop", "yield", "signal", "roundabout"].map((id) => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</select>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Reason
				<input
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Baseline correction reason"
					value={reason}
					onChange={(e) => {
						setReason(e.target.value);
						invalidate();
					}}
				/>
			</label>
			<label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				Evidence or measurement notes
				<textarea
					style={{
						width: "100%",
						minHeight: 32,
						padding: "6px 8px",
						border: "1px solid #666",
						borderRadius: 6,
						background: "transparent",
						color: "inherit",
					}}
					aria-label="Baseline correction evidence"
					value={evidence}
					onChange={(e) => {
						setEvidence(e.target.value);
						invalidate();
					}}
				/>
			</label>
			<fieldset aria-label="Accepted imagery evidence">
				<legend>Accepted imagery evidence for this segment</legend>
				{Object.values(stored?.project.observations ?? {})
					.filter(
						(observation) =>
							observation.imagery?.status === "accepted" &&
							observation.imagery.target.roadId === featureId &&
							observation.imagery.target.edgeId === edgeId,
					)
					.map((observation) => (
						<label key={observation.id} style={{ display: "block" }}>
							<input
								type="checkbox"
								aria-label={`Link imagery: ${observation.description}`}
								checked={linkedIds.includes(observation.id)}
								onChange={(event) => {
									setLinkedIds((current) =>
										event.target.checked
											? [...current, observation.id]
											: current.filter((id) => id !== observation.id),
									);
									invalidate();
								}}
							/>
							{observation.description} ·{" "}
							{observation.imagery!.image.capturedAt ?? "Unknown date"}
						</label>
					))}
			</fieldset>
			<button
				style={{
					minHeight: 32,
					padding: "6px 8px",
					border: "1px solid #666",
					borderRadius: 6,
				}}
				type="button"
				onClick={reviewCorrection}
			>
				Review baseline correction
			</button>
			{review && (
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<p>
						Ready to correct this street and realign attached items. The
						previous baseline is retained; one Undo restores it.
					</p>
					<button
						style={{
							minHeight: 32,
							padding: "6px 8px",
							border: "1px solid #666",
							borderRadius: 6,
						}}
						type="button"
						onClick={() => {
							try {
								commitBaselineRoadCorrection(review);
								setReview(null);
								setError("Correction accepted.");
							} catch (e) {
								setError(e instanceof Error ? e.message : "Correction failed.");
							}
						}}
					>
						Apply baseline correction
					</button>
					<button
						style={{
							minHeight: 32,
							padding: "6px 8px",
							border: "1px solid #666",
							borderRadius: 6,
						}}
						type="button"
						onClick={() => setReview(null)}
					>
						Cancel baseline correction
					</button>
				</div>
			)}
			{error && <p role="status">{error}</p>}
		</section>
	);
}
