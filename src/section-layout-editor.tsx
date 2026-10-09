import { redesignStreetSectionLayout } from "./host/street-scenario-command";
import { useState } from "react";
import { z } from "zod";
import { StreetSectionLayout } from "./domain/street-section-layout";
import { acceptStreetSectionLayout } from "./host/section-layout-command";

export function SectionLayoutEditor({
	siteId,
	scenarioId = null,
	locked = false,
	roadId,
	sectionId,
	revision,
	layout,
}: {
	siteId: string;
	scenarioId?: string | null;
	locked?: boolean;
	roadId: string;
	sectionId: string;
	revision: number;
	layout: StreetSectionLayout;
}) {
	const [operation, setOperation] = useState("width");
	const [intervalId, setIntervalId] = useState(layout.intervals[0]!.id);
	const interval =
		layout.intervals.find((item) => item.id === intervalId) ??
		layout.intervals[0]!;
	const items = [
		...interval.lanes.map((item) => ({ item, label: `Traffic ${item.id}` })),
		...interval.leftBands.map((item) => ({
			item,
			label: `Left ${item.kind} (${item.id})`,
		})),
		...interval.rightBands.map((item) => ({
			item,
			label: `Right ${item.kind} (${item.id})`,
		})),
	];
	const [itemId, setItemId] = useState("");
	const selected = items.find((entry) => entry.item.id === itemId) ?? items[0];
	const [width, setWidth] = useState(""),
		[start, setStart] = useState(""),
		[end, setEnd] = useState(""),
		[reason, setReason] = useState(""),
		[message, setMessage] = useState("");
	const [prepared, setPrepared] = useState<{
		layout: StreetSectionLayout;
		revision: number;
		reason: string;
	} | null>(null);
	const reset = () => {
		setWidth("");
		setStart("");
		setEnd("");
		setPrepared(null);
		setMessage("");
	};
	if (!selected) return null;
	if (locked)
		return (
			<p>Section locked. Unlock it in the scenario controls to redesign it.</p>
		);
	const review = () => {
		try {
			if (!reason.trim())
				throw Error(
					scenarioId
						? "Explain this design change."
						: "Explain this baseline correction.",
				);
			if (
				operation === "width" &&
				![width, start, end].some((value) => value.trim())
			)
				throw Error("Enter a width or taper endpoint to change.");
			const next = structuredClone(layout);
			const targetInterval = next.intervals.find(
				(item) => item.id === interval.id,
			)!;
			const target = [
				...targetInterval.lanes,
				...targetInterval.leftBands,
				...targetInterval.rightBands,
			].find((item) => item.id === selected.item.id)!;
			if (operation === "add-cycling")
				targetInterval.rightBands.push({
					id: `cycling:${crypto.randomUUID()}`,
					kind: "protected-cycling",
					width: 2,
				});
			if (operation === "remove-band") {
				if (targetInterval.lanes.some((lane) => lane.id === selected.item.id))
					throw Error("Select a surface band to remove");
				targetInterval.leftBands = targetInterval.leftBands.filter(
					(b) => b.id !== selected.item.id,
				);
				targetInterval.rightBands = targetInterval.rightBands.filter(
					(b) => b.id !== selected.item.id,
				);
			}
			for (const [text, key] of [
				[width, "width"],
				[start, "startWidth"],
				[end, "endWidth"],
			] as const) {
				if (!text.trim()) continue;
				const value = Number(text);
				if (!Number.isFinite(value))
					throw Error("Use finite widths in metres.");
				target[key] = value;
			}
			setPrepared({
				layout: StreetSectionLayout.parse(next),
				revision,
				reason: reason.trim(),
			});
			setMessage(
				scenarioId
					? "Ready to redesign this interval. Accepted baseline will be retained."
					: "Ready to correct this interval. Review widths before applying.",
			);
		} catch (error) {
			setPrepared(null);
			setMessage(
				error instanceof z.ZodError
					? error.issues.map((issue) => issue.message).join("; ")
					: String(error),
			);
		}
	};
	return (
		<section aria-label={`Edit section layout: ${sectionId}`}>
			<h4>{scenarioId ? "Redesign section" : "Edit station widths"}</h4>
			{scenarioId && (
				<label>
					Design operation
					<select
						aria-label="Section design operation"
						value={operation}
						onChange={(e) => {
							setOperation(e.target.value);
							reset();
						}}
					>
						<option value="width">Change widths</option>
						<option value="add-cycling">
							Add right protected cycling (2 m)
						</option>
						<option value="remove-band">Remove selected surface band</option>
					</select>
				</label>
			)}
			<label>
				Station interval
				<select
					aria-label="Layout station interval"
					value={interval.id}
					onChange={(event) => {
						setIntervalId(event.target.value);
						setItemId("");
						reset();
					}}
				>
					{layout.intervals.map((item) => (
						<option key={item.id} value={item.id}>
							{item.start.toFixed(2)}–{item.end.toFixed(2)} m ({item.id})
						</option>
					))}
				</select>
			</label>
			<label>
				Lane or surface band
				<select
					aria-label="Layout physical entry"
					value={selected.item.id}
					onChange={(event) => {
						setItemId(event.target.value);
						reset();
					}}
				>
					{items.map((entry) => (
						<option key={entry.item.id} value={entry.item.id}>
							{entry.label}
						</option>
					))}
				</select>
			</label>
			<p>
				Current nominal width {selected.item.width} m; start{" "}
				{selected.item.startWidth ?? selected.item.width} m; end{" "}
				{selected.item.endWidth ?? selected.item.width} m.
			</p>
			<label>
				Nominal width (m)
				<input
					aria-label="Layout nominal width"
					type="number"
					step="0.1"
					value={width}
					onChange={(event) => {
						setWidth(event.target.value);
						setPrepared(null);
					}}
				/>
			</label>
			<label>
				Width at interval start (m)
				<input
					aria-label="Layout start width"
					type="number"
					step="0.1"
					value={start}
					onChange={(event) => {
						setStart(event.target.value);
						setPrepared(null);
					}}
				/>
			</label>
			<label>
				Width at interval end (m)
				<input
					aria-label="Layout end width"
					type="number"
					step="0.1"
					value={end}
					onChange={(event) => {
						setEnd(event.target.value);
						setPrepared(null);
					}}
				/>
			</label>
			<label>
				{scenarioId ? "Design reason" : "Correction reason"}
				<input
					aria-label="Layout correction reason"
					value={reason}
					onChange={(event) => {
						setReason(event.target.value);
						setPrepared(null);
					}}
				/>
			</label>
			<p>
				Blank fields retain current values. Nominal lane widths and taper
				endpoints are separate.
			</p>
			<button onClick={review}>
				{scenarioId ? "Review interval redesign" : "Review interval correction"}
			</button>
			{prepared && (
				<>
					<button
						onClick={() => {
							try {
								(scenarioId
									? redesignStreetSectionLayout
									: (
											site: string,
											rev: number,
											road: string,
											section: string,
											data: unknown,
											why: string,
										) =>
											acceptStreetSectionLayout(
												site,
												rev,
												section,
												data,
												why,
												road,
											))(
									siteId,
									prepared.revision,
									roadId,
									sectionId,
									prepared.layout,
									prepared.reason,
								);
								setPrepared(null);
								setMessage(
									scenarioId
										? "Design saved in this scenario. Accepted baseline retained."
										: "Interval corrected. Previous baseline retained; one Undo restores it.",
								);
							} catch (error) {
								setPrepared(null);
								setMessage(
									error instanceof z.ZodError
										? error.issues.map((issue) => issue.message).join("; ")
										: String(error),
								);
							}
						}}
					>
						{scenarioId
							? "Apply interval redesign"
							: "Apply interval correction"}
					</button>
					<button
						onClick={() => {
							setPrepared(null);
							setMessage("Review cancelled. Street unchanged.");
						}}
					>
						Cancel interval correction
					</button>
				</>
			)}
			{message && <p role="status">{message}</p>}
		</section>
	);
}
