"use client";
import type {
	MappedInventoryReport,
	MappedAssociationChoices,
} from "./domain/mapped-inventory";
export function MappedInventoryInspection({
	report,
	onChoose,
}: {
	report: MappedInventoryReport;
	onChoose?: (id: string, candidate: string | null) => void;
}) {
	const pending = report.items.filter(
		(i) => i.status === "pending" || i.status === "unmatched",
	);
	return (
		<section
			className="mt-3 rounded-lg border border-border p-3 text-xs"
			aria-label="Mapped inventory review"
		>
			<p className="font-medium">Mapped inventory review</p>
			<p>
				{report.items.length} mapped features · {pending.length} need review
			</p>
			<p>
				Only resolved associations shape the generated road. Uncertain matches
				retain source geometry for review.
			</p>
			<details className="mt-2">
				<summary>Inspect mapped feature candidates</summary>
				{report.items.slice(0, 30).map((item) => (
					<details className="mt-2" key={item.id}>
						<summary>
							{item.kind} {item.id} · {item.status} ({item.basis})
						</summary>
						{item.diagnostics.map((d, i) => (
							<p key={i}>{d}</p>
						))}
						{item.candidates.map((c) => (
							<div key={c.id} className="mt-1">
								<p>
									{c.edgeIds.join(", ")} · {c.distanceMeters.toFixed(1)} m ·
									score {c.score.toFixed(2)} · {c.side}
								</p>
								{onChoose && (
									<button
										type="button"
										className="rounded border p-1"
										onClick={() => onChoose(item.id, c.id)}
									>
										Accept corridor {c.id}
									</button>
								)}
							</div>
						))}
						{onChoose && item.kind !== "point-asset" && (
							<button
								type="button"
								className="mt-1 rounded border p-1"
								onClick={() => onChoose(item.id, null)}
							>
								Reject association {item.id}
							</button>
						)}
						<details>
							<summary>Original mapped feature</summary>
							<pre className="max-h-48 overflow-auto whitespace-pre-wrap">
								{JSON.stringify(item.source, null, 2)}
							</pre>
						</details>
					</details>
				))}
			</details>
			<button
				className="mt-2 rounded border p-1"
				type="button"
				onClick={() => {
					const url = URL.createObjectURL(
						new Blob([JSON.stringify(report, null, 2)], {
							type: "application/json",
						}),
					);
					const a = document.createElement("a");
					a.href = url;
					a.download = "streetscape-mapped-inventory-v1.json";
					a.click();
					setTimeout(() => URL.revokeObjectURL(url), 0);
				}}
			>
				Export mapped inventory report
			</button>
		</section>
	);
}
export function chooseMappedAssociation(
	report: MappedInventoryReport,
	choices: MappedAssociationChoices,
	id: string,
	candidate: string | null,
) {
	return {
		choices: { ...choices, [id]: candidate },
		report: {
			...report,
			items: report.items.map((item) =>
				item.id === id
					? {
							...item,
							status:
								candidate === null
									? ("rejected" as const)
									: ("resolved" as const),
							basis: "manual" as const,
							selectedCandidateId: candidate,
						}
					: item,
			),
		},
	};
}
