"use client";
import { ImageryObservationReview } from "./imagery-observation-review";
import { useEffect, useState } from "react";
import { useMemo } from "react";
import { useScene } from "@pascal-app/core";
import { readStreetProjectView } from "./host/street-project-persistence";
import { imageryRoadSections } from "./host/imagery-road-sections";
import type { StreetImageReference } from "./domain/street-imagery";
import {
	Map,
	MapControls,
	MapMarker,
	MapRoute,
	MarkerContent,
} from "./mapcn-map";

/** Transient evidence navigation: never changes a baseline or scene node. */
export function ImageryMapBrowser({
	references,
}: {
	references: StreetImageReference[];
}) {
	const nodes = useScene((state) => state.nodes);
	const sections = useMemo(
		() =>
			Object.values(nodes).flatMap((node) => {
				if (node.type !== "site") return [];
				const stored = readStreetProjectView(node);
				return stored ? imageryRoadSections(stored) : [];
			}),
		[nodes],
	);
	const [sectionId, setSectionId] = useState<string>("");
	const section = sections.find((item) => item.id === sectionId) ?? sections[0];
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const selected =
		references.find((reference) => reference.id === selectedId) ??
		references[0];
	const location = selected?.location;
	const [viewport, setViewport] = useState({
		center: [-122.408588, 37.783539] as [number, number],
		zoom: 17,
		bearing: 0,
		pitch: 0,
	});
	useEffect(() => {
		if (selected?.location)
			setViewport((current) => ({
				...current,
				center: [selected.location!.lon, selected.location!.lat],
			}));
	}, [selected?.id, selected?.location?.lat, selected?.location?.lon]);
	const select = (reference: StreetImageReference) => {
		setSelectedId(reference.id);
		if (reference.location)
			setViewport((current) => ({
				...current,
				center: [reference.location!.lon, reference.location!.lat],
			}));
	};
	if (!selected) return null;
	return (
		<section
			aria-label="Map and imagery browser"
			style={{ display: "grid", gap: 8 }}
		>
			<style>{`.streetscape-image-controls { position: absolute; right: 8px; top: 8px; bottom: auto; z-index: 2; } .streetscape-imagery-map { height: 100%; overflow: hidden; } .streetscape-imagery-map .maplibregl-marker { position: absolute; top: 0; left: 0; width: max-content; } .streetscape-imagery-map .maplibregl-control-container { position: absolute; inset: 0; pointer-events: none; } .streetscape-imagery-map .maplibregl-ctrl { pointer-events: auto; } .streetscape-imagery-map .maplibregl-ctrl-bottom-right { position: absolute; bottom: 0; right: 0; } .streetscape-imagery-map .maplibregl-ctrl-bottom-left { position: absolute; bottom: 0; left: 0; } .streetscape-imagery-map .maplibregl-ctrl-attrib { font-size: 9px; background: rgba(255,255,255,.9); color: #222; max-width: 255px; }`}</style>
			<h4>Compare street imagery</h4>
			<label>
				Road section to compare
				<select
					style={{
						width: "100%",
						padding: 6,
						border: "1px solid #666",
						borderRadius: 6,
					}}
					aria-label="Road section to compare"
					value={section?.id ?? ""}
					onChange={(event) => {
						setSectionId(event.target.value);
						const next = sections.find(
							(item) => item.id === event.target.value,
						);
						if (next)
							setViewport((current) => ({
								...current,
								center: next.coordinates[0]!,
							}));
					}}
				>
					{sections.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label}
						</option>
					))}
				</select>
			</label>
			{!section && (
				<p>
					Import a geographically located street to compare its road section.
					Imagery remains optional.
				</p>
			)}
			<p>
				Choose a view on the map or in the list. Locations are approximate;
				capture dates may describe older conditions.
			</p>
			<div style={{ height: 260, width: "100%" }}>
				<Map
					styles={{
						light: "https://tiles.openfreemap.org/styles/bright",
						dark: "https://tiles.openfreemap.org/styles/bright",
					}}
					viewport={viewport}
					onViewportChange={setViewport}
					className="streetscape-imagery-map h-full w-full"
				>
					<MapControls className="streetscape-image-controls" />
					{section && (
						<MapRoute
							coordinates={section.coordinates}
							color="#a855f7"
							width={6}
							interactive={false}
						/>
					)}
					{references
						.filter((reference) => reference.location)
						.map((reference, index) => (
							<MapMarker
								key={reference.id}
								longitude={reference.location!.lon}
								latitude={reference.location!.lat}
								onClick={() => select(reference)}
							>
								<MarkerContent>
									<button
										type="button"
										onClick={(event) => {
											event.stopPropagation();
											select(reference);
										}}
										aria-label={`Select image ${index + 1} on map`}
										aria-pressed={selected.id === reference.id}
										style={{
											background:
												selected.id === reference.id ? "#1765d1" : "#444",
											color: "white",
											padding: 8,
											borderRadius: 20,
										}}
									>
										{reference.headingDegrees === null ? (
											"●"
										) : (
											<span
												style={{
													display: "inline-block",
													transform: `rotate(${reference.headingDegrees}deg)`,
												}}
											>
												↑
											</span>
										)}{" "}
										{index + 1}
									</button>
								</MarkerContent>
							</MapMarker>
						))}
				</Map>
			</div>
			<div
				aria-label="Available imagery views"
				style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
			>
				{references.map((reference, index) => (
					<button
						key={reference.id}
						type="button"
						style={{ padding: 6, border: "1px solid #666", borderRadius: 6 }}
						aria-pressed={selected.id === reference.id}
						onClick={() => select(reference)}
					>
						View {index + 1} · {reference.capturedAt ?? "Unknown date"}
					</button>
				))}
			</div>
			<article aria-label="Selected street image">
				{selected.imageUrl && failedUrl !== selected.imageUrl ? (
					<img
						src={selected.imageUrl}
						alt={`Street reference by ${selected.creator.name}, captured ${selected.capturedAt ?? "on an unknown date"}`}
						referrerPolicy="no-referrer"
						style={{ width: "100%", maxHeight: 380, objectFit: "contain" }}
						onError={() => setFailedUrl(selected.imageUrl)}
					/>
				) : (
					<p>
						{selected.imageUrl
							? "Image could not load. Open its source below."
							: "This reference links to its provider; no inline image was supplied."}
					</p>
				)}
				<a href={selected.pageUrl} target="_blank" rel="noopener noreferrer">
					Open selected image source
				</a>
				<p>
					Captured: {selected.capturedAt ?? "Unknown date"} · By{" "}
					{selected.creator.name} ·{" "}
					{selected.license.url ? (
						<a
							href={selected.license.url}
							target="_blank"
							rel="noopener noreferrer"
						>
							{selected.license.name}
						</a>
					) : (
						selected.license.name
					)}
				</p>
				<p>
					{location
						? `Location: ${location.lat}, ${location.lon} (${selected.locationBasis})`
						: "Location unknown"}{" "}
					· Accuracy:{" "}
					{selected.locationAccuracyMeters === null
						? "Unknown"
						: `${selected.locationAccuracyMeters} m`}{" "}
					· Heading:{" "}
					{selected.headingDegrees === null
						? "Unknown"
						: `${selected.headingDegrees}°`}
				</p>
				<p>{selected.uncertainty}</p>
			</article>
			<ImageryObservationReview image={selected} section={section} />
		</section>
	);
}
