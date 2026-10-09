import { useEffect, useRef, useState } from "react";
import {
	type StreetProject,
	parseStreetProject,
} from "./domain/street-project";
import {
	canonicalSourceJson,
	type OsmSourceSnapshot,
} from "./source/osm-source-snapshot";
import {
	streetMergeChoiceLabel,
	prepareStreetSourceMerge,
	resolveStreetSourceMerge,
	type StreetSourceMergeReview,
	type StreetMergeChoice,
} from "./source/street-source-merge";
import { acceptStreetSourceMerge } from "./host/street-source-merge-command";

/** Resolution is supplied explicitly: a fresh snapshot is evidence, not an accepted interpretation. */
export function SourceMergeInspector({
	project,
	siteId,
	sourceId,
	snapshot,
}: {
	project: StreetProject;
	siteId: string;
	sourceId: string;
	snapshot: OsmSourceSnapshot;
}) {
	const [original, setOriginal] = useState(""),
		[incoming, setIncoming] = useState(""),
		[review, setReview] = useState<StreetSourceMergeReview | null>(null),
		[result, setResult] = useState<Awaited<
			ReturnType<typeof resolveStreetSourceMerge>
		> | null>(null),
		[choices, setChoices] = useState<Record<string, StreetMergeChoice>>({}),
		[message, setMessage] = useState(""),
		[busy, setBusy] = useState(false);
	const token = useRef(0);
	useEffect(
		() => () => {
			token.current++;
		},
		[],
	);
	const cancel = () => {
		token.current++;
		setReview(null);
		setResult(null);
		setChoices({});
		setBusy(false);
		setMessage("Merge cancelled. Accepted project unchanged.");
	};
	const prepare = async () => {
		const request = ++token.current;
		setBusy(true);
		setReview(null);
		setResult(null);
		setChoices({});
		try {
			const next = parseStreetProject(incoming),
				base = next.baselineRevisions[next.activeBaselineRevisionId]!;
			if (
				!base.sourceReferenceIds.some((id) => {
					const s = next.sourceReferences[id]!;
					return (
						s.snapshot.status === "embedded" &&
						canonicalSourceJson(s.snapshot.data) ===
							canonicalSourceJson(snapshot)
					);
				})
			)
				throw Error("Incoming resolution must use the compared snapshot");
			const prepared = await prepareStreetSourceMerge(
					project,
					parseStreetProject(original),
					next,
					sourceId,
				),
				resolved = await resolveStreetSourceMerge(prepared);
			if (token.current !== request) return;
			setReview(prepared);
			setResult(resolved);
			setMessage(
				resolved.unresolved.length
					? "Choose how to resolve each conflict."
					: "Merge ready for acceptance.",
			);
		} catch (e) {
			if (token.current === request)
				setMessage(e instanceof Error ? e.message : String(e));
		} finally {
			if (token.current === request) setBusy(false);
		}
	};
	const choose = async (id: string, value: string) => {
		if (!review) return;
		const request = ++token.current,
			next = { ...choices };
		if (value) next[id] = value as StreetMergeChoice;
		else delete next[id];
		setChoices(next);
		setBusy(true);
		try {
			const resolved = await resolveStreetSourceMerge(review, next);
			if (token.current === request) setResult(resolved);
		} catch (e) {
			if (token.current === request) {
				setResult(null);
				setMessage(e instanceof Error ? e.message : String(e));
			}
		} finally {
			if (token.current === request) setBusy(false);
		}
	};
	const stale =
		!!review && canonicalSourceJson(project) !== review.currentIdentity;
	return (
		<section
			aria-label="Source merge review"
			className="space-y-2 border-t border-border pt-3"
		>
			<h3>Merge refreshed source</h3>
			<p>
				Provide the original source resolution and the refreshed resolution as
				exported street project JSON. The original resolution must precede
				accepted corrections. Both must use the accepted coordinate frame.
			</p>
			<label>
				Original source resolution JSON
				<textarea
					aria-label="Original source resolution JSON"
					rows={3}
					value={original}
					disabled={busy}
					onChange={(e) => {
						cancel();
						setOriginal(e.target.value);
					}}
				/>
			</label>
			<label>
				Incoming source resolution JSON
				<textarea
					aria-label="Incoming source resolution JSON"
					rows={3}
					value={incoming}
					disabled={busy}
					onChange={(e) => {
						cancel();
						setIncoming(e.target.value);
					}}
				/>
			</label>
			<button
				disabled={busy || !original.trim() || !incoming.trim()}
				onClick={() => void prepare()}
			>
				Prepare source merge
			</button>
			<button onClick={cancel}>Cancel source merge</button>
			{message && <p role="status">{message}</p>}
			{stale && (
				<p role="alert">Accepted project changed. Prepare the merge again.</p>
			)}
			{result?.conflicts.map((c) => (
				<details key={c.id} open>
					<summary>{c.reason}</summary>
					<p className="break-all">{c.path.join(" / ")}</p>
					<select
						aria-label={`Merge choice ${c.id}`}
						disabled={busy || stale}
						value={choices[c.id] ?? ""}
						onChange={(e) => void choose(c.id, e.target.value)}
					>
						<option value="">Choose…</option>
						{c.choices.map((v) => (
							<option key={v} value={v}>
								{streetMergeChoiceLabel(v)}
							</option>
						))}
					</select>
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap">
						{JSON.stringify(
							{ current: c.current, incoming: c.incoming },
							null,
							2,
						)}
					</pre>
				</details>
			))}
			{result && <p>{result.unresolved.length} unresolved conflicts</p>}
			{result?.project && (
				<details>
					<summary>Review merged document</summary>
					<pre className="max-h-60 overflow-auto whitespace-pre-wrap">
						{JSON.stringify(result.project, null, 2)}
					</pre>
				</details>
			)}
			<button
				disabled={busy || stale || !result?.project}
				onClick={() => {
					try {
						acceptStreetSourceMerge(
							siteId,
							review!.currentIdentity,
							result!.project!,
						);
						cancel();
						setMessage(
							"Reviewed source merge accepted. Undo restores the previous document and geometry.",
						);
					} catch (e) {
						setMessage(e instanceof Error ? e.message : String(e));
					}
				}}
			>
				Accept reviewed source merge
			</button>
		</section>
	);
}
