"use client";
import {
	confirmStreetRegionalPolicy,
	type StreetSectionReport,
	type StreetRegionalPolicy,
} from "./domain/street-sections";
export function StreetSectionInspection({
	report,
	onConfirm,
}: {
	report: StreetSectionReport;
	onConfirm?: (policy: StreetRegionalPolicy) => void;
}) {
	return (
		<section
			aria-label="Street section evidence"
			className="mt-3 rounded-lg border border-border p-3 text-xs"
		>
			<p className="font-medium">Street section evidence</p>
			<p>
				{report.sections.length} section intervals · regional policy v
				{report.policy.version} · {report.policy.id} ({report.policy.status})
			</p>
			<p>
				{report.policy.evidence ??
					(report.policy.status === "confirmed"
						? "Driving policy confirmed by the user."
						: "No location evidence for driving side; choose and confirm a policy.")}
			</p>
			{onConfirm && (
				<div className="mt-2 flex gap-2">
					{(["right-driving", "left-driving"] as const).map((id) => (
						<button
							key={id}
							type="button"
							className="rounded border p-2"
							onClick={() =>
								onConfirm(confirmStreetRegionalPolicy(report.policy, id))
							}
						>
							Confirm {id}
						</button>
					))}
				</div>
			)}
			<details className="mt-2">
				<summary>Inspect section values and origins</summary>
				{report.sections.slice(0, 20).map((s) => (
					<details className="mt-2" key={s.id}>
						<summary>
							OSM way {s.wayId} · {s.interval.end.toFixed(1)} m
						</summary>
						<p>
							{
								Object.values(s.values).filter((v) => v.origin === "estimate")
									.length
							}{" "}
							estimated properties ·{" "}
							{
								Object.entries(s.values).filter(
									([key, v]) =>
										/width/i.test(key) &&
										(v.value === null || v.origin === "estimate"),
								).length
							}{" "}
							widths missing or estimated
						</p>
						<ul>
							{Object.entries(s.values).map(([key, v]) => (
								<li key={key}>
									<details>
										<summary>
											<strong>{key}</strong>: {JSON.stringify(v.value)} ·{" "}
											{v.origin === "mapped"
												? "OSM value"
												: v.origin === "estimate"
													? "Estimate"
													: v.origin}
										</summary>
										<p>{v.reason}</p>
										{Object.keys(v.rawClaims).length > 0 && (
											<pre className="whitespace-pre-wrap">
												{JSON.stringify(v.rawClaims)}
											</pre>
										)}
									</details>
								</li>
							))}
						</ul>
						{s.diagnostics.map((d, i) => (
							<p key={i}>{d}</p>
						))}
					</details>
				))}
			</details>
		</section>
	);
}
