import { SourceMergeInspector } from "./source-merge-inspector";
import { useEffect, useRef, useState } from "react";
import { useScene } from "@pascal-app/core";
import { readStreetProjectView } from "./host/street-project-persistence";
import {
	acquireStreetSourceRefresh,
	generateStreetSourceRefreshDiff,
	type StreetSourceRefreshDiff,
} from "./source/street-source-refresh";
import {
	createOsmSourceSnapshot,
	OSM_SOURCE_SNAPSHOT_FORMAT,
} from "./source/osm-source-snapshot";
import { canonicalSourceJson } from "./source/osm-source-snapshot";
import { parseOsmAcquisition } from "./source/osm-acquisition";
export function SourceRefreshInspector() {
	const nodes = useScene((s) => s.nodes);
	const choices = Object.values(nodes)
		.filter((n) => n.type === "site")
		.flatMap((site) => {
			const doc = readStreetProjectView(site);
			if (!doc) return [];
			return [
				...doc.project.baselineRevisions[doc.project.activeBaselineRevisionId]!
					.sourceReferenceIds,
			]
				.reverse()
				.flatMap((id) => {
					const source = doc.project.sourceReferences[id]!;
					return source.snapshot.status === "embedded" &&
						source.snapshot.format === OSM_SOURCE_SNAPSHOT_FORMAT
						? [
								{
									key: JSON.stringify([site.id, id]),
									siteId: site.id,
									sourceId: id,
									project: doc.project,
									label: `${doc.project.name} · captured ${source.acquiredAt?.slice(0, 10) ?? "date unknown"} · ${source.contentIdentity?.slice(-8) ?? id}`,
								},
							]
						: [];
				});
		});
	const [key, setKey] = useState(""),
		[text, setText] = useState(""),
		[message, setMessage] = useState(""),
		[busy, setBusy] = useState(false),
		[review, setReview] = useState<Awaited<
			ReturnType<typeof generateStreetSourceRefreshDiff>
		> | null>(null);
	const request = useRef<{ token: number; controller: AbortController } | null>(
			null,
		),
		sequence = useRef(0);
	useEffect(
		() => () => {
			sequence.current++;
			request.current?.controller.abort();
		},
		[],
	);
	const selected = choices.find((c) => c.key === key) ?? choices[0];
	const cancel = () => {
		sequence.current++;
		request.current?.controller.abort();
		request.current = null;
		setBusy(false);
		setReview(null);
		setMessage("Refresh review cancelled. Accepted street unchanged.");
	};
	const run = async (fetchNew: boolean) => {
		if (!selected) return;
		request.current?.controller.abort();
		const controller = new AbortController(),
			token = ++sequence.current;
		request.current = { token, controller };
		setBusy(true);
		setReview(null);
		setMessage("Preparing source comparison…");
		try {
			let result;
			if (fetchNew)
				result = await acquireStreetSourceRefresh(
					selected.project,
					selected.project.activeBaselineRevisionId,
					selected.sourceId,
					{ signal: controller.signal },
				);
			else {
				const input = JSON.parse(text);
				const snapshot =
					input.format === "osm-acquisition"
						? await createOsmSourceSnapshot(parseOsmAcquisition(input))
						: input;
				result = await generateStreetSourceRefreshDiff(
					selected.project,
					selected.project.activeBaselineRevisionId,
					selected.sourceId,
					snapshot,
				);
			}
			if (sequence.current !== token) return;
			// Revision changes invalidate an async review instead of applying it to new work.
			const current = readStreetProjectView(
				useScene.getState().nodes[selected.siteId],
			);
			if (
				!current ||
				canonicalSourceJson(current.project) !==
					canonicalSourceJson(selected.project)
			)
				throw Error(
					"Street project changed during comparison. Run the review again.",
				);
			setReview(result);
			setMessage(
				"Source comparison ready. Accepted street and scenarios unchanged.",
			);
		} catch (error) {
			if (sequence.current === token)
				setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			if (sequence.current === token) {
				setBusy(false);
				request.current = null;
			}
		}
	};
	if (!selected) return null;
	const stale =
		review &&
		(review.diff.projectRevision !== selected.project.revision ||
			review.diff.projectId !== selected.project.id ||
			review.diff.baselineRevisionId !==
				selected.project.activeBaselineRevisionId ||
			review.diff.sourceReferenceId !== selected.sourceId);
	const counts = review?.diff.features.reduce<
		Partial<
			Record<StreetSourceRefreshDiff["features"][number]["status"], number>
		>
	>(
		(counts, item) => ({
			...counts,
			[item.status]: (counts[item.status] ?? 0) + 1,
		}),
		{},
	);
	return (
		<section
			aria-label="Source refresh review"
			className="space-y-3 rounded-md border border-border p-3 text-sm [&_label]:block [&_textarea]:w-full [&_textarea]:rounded [&_textarea]:border [&_textarea]:border-border [&_textarea]:p-2 [&_button]:my-2 [&_button]:rounded [&_button]:border [&_button]:border-border [&_button]:px-2 [&_button]:py-1"
		>
			<h3>Review source refresh</h3>
			<p>
				Compare a fresh source capture before changing the accepted street. No
				changes are applied by this review.
			</p>
			<label>
				Retained source
				<select
					aria-label="Refresh retained source"
					value={selected.key}
					onChange={(e) => {
						cancel();
						setKey(e.target.value);
					}}
				>
					{choices.map((c, index) => (
						<option key={c.key} value={c.key}>
							{index + 1}. {c.label}
						</option>
					))}
				</select>
			</label>
			<button disabled={busy} onClick={() => void run(true)}>
				Acquire fresh source and compare
			</button>
			<label>
				Recorded snapshot or acquisition JSON
				<textarea
					aria-label="Refresh snapshot JSON"
					rows={4}
					disabled={busy}
					value={text}
					onChange={(e) => {
						setText(e.target.value);
						setReview(null);
					}}
				/>
			</label>
			<button disabled={busy || !text.trim()} onClick={() => void run(false)}>
				Compare recorded source
			</button>
			<button onClick={cancel}>Cancel refresh review</button>
			{message && <p role="status">{message}</p>}
			{review && (
				<div>
					<p>
						{Object.entries(counts!)
							.map(([status, count]) => `${count} ${status}`)
							.join(" · ")}
					</p>
					{stale && (
						<p role="alert">
							The project has changed. Run this comparison again before using
							the report.
						</p>
					)}
					<p>
						{review.diff.spans.filter((s) => s.status === "ambiguous").length}{" "}
						ambiguous accepted road spans
					</p>
					{review.diff.diagnostics.map((d) => (
						<p key={d}>{d}</p>
					))}
					{review.diff.features
						.filter((f) => f.status !== "unchanged" || f.metadataChanged)
						.map((f) => (
							<details key={f.sourceFeatureId}>
								<summary>
									{f.sourceFeatureId} · {f.status}
									{f.status === "unchanged" && f.metadataChanged
										? " (metadata only)"
										: ""}
								</summary>
								<p>
									Changed: {f.changedFields.join(", ") || "none"} · accepted
									targets: {f.acceptedTargets.length}
								</p>
								<pre className="max-h-60 overflow-auto whitespace-pre-wrap">
									{JSON.stringify(
										{ previous: f.previous, incoming: f.incoming },
										null,
										2,
									)}
								</pre>
							</details>
						))}
					{review.diff.spans
						.filter((s) => s.status !== "matched")
						.map((s) => (
							<details key={JSON.stringify([s.roadId, s.edgeId])}>
								<summary>Accepted span · {s.status}</summary>
								<p>{s.edgeId}</p>
								<p>Candidates: {s.candidateIds.join(", ") || "none"}</p>
							</details>
						))}
					{!stale && (
						<SourceMergeInspector
							key={review.diff.incomingIntegrityIdentity}
							project={selected.project}
							siteId={selected.siteId}
							sourceId={selected.sourceId}
							snapshot={review.incomingSnapshot}
						/>
					)}
					<button
						disabled={!!stale}
						onClick={() => {
							const url = URL.createObjectURL(
								new Blob([JSON.stringify(review, null, 2)], {
									type: "application/json",
								}),
							);
							const a = document.createElement("a");
							a.href = url;
							a.download = "street-source-refresh-review.json";
							a.click();
							URL.revokeObjectURL(url);
						}}
					>
						Export source comparison
					</button>
				</div>
			)}
		</section>
	);
}
