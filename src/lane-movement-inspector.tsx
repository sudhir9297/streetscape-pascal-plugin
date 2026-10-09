import { useMemo, useState } from "react";
import { useScene, type AnyNodeId } from "@pascal-app/core";
import { readStreetProjectView } from "./host/street-project-persistence";
import { compileProjectLaneMovements } from "./lane-movement-graph";
import { acceptLaneMovementDecision } from "./host/lane-movement-command";
import type { LaneMovementGraph } from "./domain/lane-movement";
import { compileStreet } from "./street-compiler";
import { readResolvedCurrentRoad } from "./street-project-compatibility";
import { RoadNetworkNode } from "./schema";
import { roadMovementContext } from "./host/road-movement-context";

function MovementEditor({
	siteId,
	revision,
	graph,
}: {
	siteId: string;
	revision: number;
	graph: LaneMovementGraph;
}) {
	const fromLanes = graph.lanes.filter(
		(l) =>
			l.role === "incoming" &&
			graph.links.some((link) => link.fromLaneId === l.id),
	);
	const [fromId, setFromId] = useState(fromLanes[0]?.id ?? "");
	const from = fromLanes.find((l) => l.id === fromId) ?? fromLanes[0];
	const links = graph.links.filter((l) => l.fromLaneId === from?.id);
	const [toId, setToId] = useState("");
	const selected =
		links.find((l) => l.toLaneId === toId) ??
		links.find((l) => l.suggested) ??
		links[0];
	const [reason, setReason] = useState(""),
		[message, setMessage] = useState("");
	const [prepared, setPrepared] = useState<{
		fromLaneId: string;
		toLaneId: string;
		status: "accepted" | "rejected";
		reason: string;
		expectedRevision: number;
	} | null>(null);
	if (!from || !selected)
		return <p>No supported lane links at the current junctions.</p>;
	const label = (id: string) => {
		const lane = graph.lanes.find((l) => l.id === id)!;
		return `${lane.edgeId} · lane ${lane.number} (${lane.direction}, ${lane.laneId})`;
	};
	const review = (status: "accepted" | "rejected") => {
		if (!reason.trim()) {
			setMessage("Explain this lane-link decision.");
			return;
		}
		setPrepared({
			fromLaneId: from.id,
			toLaneId: selected.toLaneId,
			status,
			reason: reason.trim(),
			expectedRevision: revision,
		});
		setMessage("Review the lane link and reason before applying.");
	};
	return (
		<div className="mt-2 space-y-2">
			<label className="block">
				Approach lane
				<select
					aria-label="Movement approach lane"
					className="w-full rounded border bg-background p-2"
					value={from.id}
					onChange={(e) => {
						setFromId(e.target.value);
						setToId("");
						setPrepared(null);
					}}
				>
					{fromLanes.map((l) => (
						<option key={l.id} value={l.id}>
							{label(l.id)}
						</option>
					))}
				</select>
			</label>
			<label className="block">
				Outgoing lane
				<select
					aria-label="Movement outgoing lane"
					className="w-full rounded border bg-background p-2"
					value={selected.toLaneId}
					onChange={(e) => {
						setToId(e.target.value);
						setPrepared(null);
					}}
				>
					{links.map((l) => (
						<option key={l.id} value={l.toLaneId}>
							{label(l.toLaneId)} · {l.turn} · {l.status}
							{l.suggested ? " · suggested" : ""}
						</option>
					))}
				</select>
			</label>
			<p>
				{selected.basis} · {selected.status}
				{selected.requiresLaneChange ? " · lane change required" : ""}
			</p>
			<p>{selected.reason}</p>
			{selected.evidenceIds.length > 0 && (
				<p>Source: {selected.evidenceIds.join(", ")}</p>
			)}
			<label className="block">
				Decision reason
				<textarea
					aria-label="Movement decision reason"
					className="w-full rounded border bg-background p-2"
					value={reason}
					onChange={(e) => {
						setReason(e.target.value);
						setPrepared(null);
					}}
				/>
			</label>
			<div className="flex gap-2">
				<button
					type="button"
					className="rounded border p-2"
					onClick={() => review("accepted")}
				>
					Review acceptance
				</button>
				<button
					type="button"
					className="rounded border p-2"
					onClick={() => review("rejected")}
				>
					Review rejection
				</button>
			</div>
			{prepared && (
				<div className="rounded border p-2">
					<p>
						{prepared.status === "accepted" ? "Accept" : "Reject"}{" "}
						{label(prepared.fromLaneId)} → {label(prepared.toLaneId)}
					</p>
					<p>{prepared.reason}</p>
					<button
						type="button"
						className="rounded border p-2"
						onClick={() => {
							try {
								acceptLaneMovementDecision({ siteId, ...prepared });
								setPrepared(null);
								setMessage(
									"Lane-link decision applied. Undo restores the previous baseline.",
								);
							} catch (e) {
								setMessage(e instanceof Error ? e.message : String(e));
							}
						}}
					>
						Apply lane decision
					</button>
					<button
						type="button"
						className="ml-2 rounded border p-2"
						onClick={() => {
							setPrepared(null);
							setMessage("Review cancelled; the baseline is unchanged.");
						}}
					>
						Cancel lane review
					</button>
				</div>
			)}
			{message && <p role="status">{message}</p>}
		</div>
	);
}
export function LaneMovementInspector() {
	const nodes = useScene((state) => state.nodes);
	const projects = useMemo(
		() =>
			Object.values(nodes)
				.filter((n) => n.type === "site")
				.flatMap((site) => {
					const stored = readStreetProjectView(site);
					return stored
						? [
								{
									siteId: site.id,
									project: stored.project,
									projection: stored.projection,
									graph: compileProjectLaneMovements(stored.project),
								},
							]
						: [];
				}),
		[nodes],
	);
	if (!projects.length) return null;
	return (
		<section
			aria-label="Lane movement graph"
			className="mt-3 rounded border border-border p-3 text-xs"
		>
			<h3 className="font-medium">Lane movement graph</h3>
			<p>
				Mapped links use explicit connectivity. Inferred links remain pending
				until reviewed. Supported forbidden turns are excluded. Lane numbers run
				left to right in the direction of travel.
			</p>
			{projects.map(({ siteId, project, graph, projection }) => (
				<article key={siteId}>
					<p>
						{graph.links.filter((l) => l.status === "accepted").length} accepted
						·{" "}
						{
							graph.links.filter((l) => l.status === "pending" && l.suggested)
								.length
						}{" "}
						suggested pending ·{" "}
						{graph.links.filter((l) => l.status === "rejected").length} rejected
					</p>
					<MovementEditor
						key={`${siteId}:${project.revision}`}
						siteId={siteId}
						revision={project.revision}
						graph={graph}
					/>
					<details className="mt-2">
						<summary>
							Movement review diagnostics ({graph.diagnostics.length})
						</summary>
						{graph.diagnostics.map((d, i) => (
							<p key={`${d.targetId}:${d.code}:${i}`}>
								{d.targetId}: {d.message}
							</p>
						))}
					</details>
					<details className="mt-2" aria-label="Junction movement generation">
						<summary>Junction geometry and marking review</summary>
						<p>
							Arrows reflect accepted movements. Signal fixture proposals are
							pending visual placements; timing and phases require a separate
							control design. Crossing proposals do not establish pedestrian
							priority.
						</p>
						{Object.keys(
							project.baselineRevisions[project.activeBaselineRevisionId]!
								.roads,
						).map((roadId) => {
							const binding = projection.bindings.find(
								(b) => b.category === "roads" && b.featureId === roadId,
							);
							const projected = binding?.nodeIds
								.map((id) => nodes[id as AnyNodeId])
								.find(
									(n) =>
										(n?.type as string | undefined) ===
										"streetscape:road-network",
								);
							const road = projected
								? RoadNetworkNode.parse(projected)
								: readResolvedCurrentRoad(
										project,
										project.activeBaselineRevisionId,
										roadId,
										project.activeScenarioId,
									);
							const plan = compileStreet(
								road,
								null,
								projected
									? roadMovementContext(road, (id) => nodes[id])
									: graph,
							).junctionMovementPlan;
							return (
								<div key={roadId}>
									<p>
										{roadId}:{" "}
										{
											plan.markings.filter((m) => m.kind === "direction-arrow")
												.length
										}{" "}
										arrow polygons · {plan.crossings.length} crossing
										relationships · {plan.signalProposals.length} pending signal
										fixtures
									</p>
									{plan.signalProposals.map((p) => (
										<p key={p.id}>
											{p.id}: proposed at{" "}
											{p.position.map((v) => v.toFixed(2)).join(", ")} ·{" "}
											{p.movementIds.length} accepted movements
										</p>
									))}
									{plan.crossings.map((p) => (
										<p key={p.id}>
											{p.id}: {p.basis} · pending · {p.movementIds.length}{" "}
											accepted movements
										</p>
									))}
									{plan.diagnostics.map((d, i) => (
										<p key={i}>{d.message}</p>
									))}
								</div>
							);
						})}
					</details>
				</article>
			))}
		</section>
	);
}
