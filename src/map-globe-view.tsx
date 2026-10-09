"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { GeoJSONSource } from "maplibre-gl";
import type { GeoPoint } from "./osm-elevation";
import type { OsmStreetPreview } from "./osm-import";
import { Map as MapCn, MapControls, useMap } from "./mapcn-map";
import {
	clampMapZoom,
	GLOBE_FLAT_THRESHOLD_ZOOM,
	MAX_MAP_ZOOM,
	mapSelectionRadiusPixels,
	MIN_MAP_ZOOM,
} from "./map-tiles";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/bright";
const PREVIEW_SOURCE_ID = "streetscape-osm-preview";
const MAX_LAT = 85.05112878;
const PREVIEW_LINE_LAYERS = [
	["alley", "#94a3b8", 2],
	["highway", "#fb7185", 4.5],
	["arterial", "#fb923c", 4],
	["collector", "#facc15", 3.5],
	["local", "#38bdf8", 3],
	["service", "#cbd5e1", 2.25],
] as const;

function MapPreviewLayer({
	streetPreview,
}: {
	streetPreview: OsmStreetPreview | null;
}) {
	const { map, isLoaded } = useMap();

	useEffect(() => {
		if (!map || !isLoaded || map.getSource(PREVIEW_SOURCE_ID)) return;
		map.addSource(PREVIEW_SOURCE_ID, {
			type: "geojson",
			data: { type: "FeatureCollection", features: [] },
		});
		map.addLayer({
			id: `${PREVIEW_SOURCE_ID}-context`,
			type: "line",
			source: PREVIEW_SOURCE_ID,
			filter: ["==", ["get", "scope"], "context"],
			paint: {
				"line-color": "#94a3b8",
				"line-opacity": 0.75,
				"line-width": 2,
				"line-dasharray": [3, 3],
			},
		});
		for (const [roadClass, color, width] of PREVIEW_LINE_LAYERS) {
			map.addLayer({
				id: `${PREVIEW_SOURCE_ID}-${roadClass}`,
				type: "line",
				source: PREVIEW_SOURCE_ID,
				filter: [
					"all",
					["==", ["get", "roadClass"], roadClass],
					["==", ["get", "scope"], "selected"],
				],
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": color,
					"line-opacity": 0.95,
					"line-width": width,
				},
			});
		}
		map.addLayer({
			id: `${PREVIEW_SOURCE_ID}-objects`,
			type: "circle",
			source: PREVIEW_SOURCE_ID,
			filter: ["==", ["geometry-type"], "Point"],
			paint: {
				"circle-color": [
					"match",
					["get", "kind"],
					"road-sign",
					"#60a5fa",
					"street-lamp",
					"#fde047",
					"traffic-signal",
					"#f87171",
					"#ffffff",
				],
				"circle-radius": 4,
				"circle-stroke-color": "#0f172a",
				"circle-stroke-width": 1.5,
			},
		});
	}, [isLoaded, map]);

	useEffect(() => {
		if (!map || !isLoaded) return;
		const source = map.getSource(PREVIEW_SOURCE_ID) as
			| GeoJSONSource
			| undefined;
		if (!source) return;
		source.setData({
			type: "FeatureCollection",
			features: [
				...(streetPreview?.contextPaths ?? []).map((path) => ({
					type: "Feature" as const,
					properties: { roadClass: path.roadClass, scope: "context" },
					geometry: {
						type: "LineString" as const,
						coordinates: path.points.map((point) => [point.lon, point.lat]),
					},
				})),
				...(streetPreview?.paths ?? []).map((path) => ({
					type: "Feature" as const,
					properties: { roadClass: path.roadClass, scope: "selected" },
					geometry: {
						type: "LineString" as const,
						coordinates: path.points.map((point) => [point.lon, point.lat]),
					},
				})),
				...(streetPreview?.mappedObjects ?? []).map((object) => ({
					type: "Feature" as const,
					properties: { kind: object.kind },
					geometry: {
						type: "Point" as const,
						coordinates: [object.point.lon, object.point.lat],
					},
				})),
			],
		});
	}, [isLoaded, map, streetPreview]);

	return null;
}

export type MapGlobeViewProps = {
	center: GeoPoint;
	className?: string;
	style?: CSSProperties;
	disabled?: boolean;
	radiusMeters: number;
	zoom: number;
	onCenterChange: (center: GeoPoint) => void;
	onZoomChange: (zoom: number) => void;
	streetPreview?: OsmStreetPreview | null;
};

export function MapGlobeView({
	center,
	className = "",
	style,
	disabled = false,
	radiusMeters,
	zoom,
	onCenterChange,
	onZoomChange,
	streetPreview = null,
}: MapGlobeViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerSize, setContainerSize] = useState({ height: 0, width: 0 });

	useEffect(() => {
		const node = containerRef.current;
		if (!node) return;
		const updateSize = () =>
			setContainerSize({ height: node.clientHeight, width: node.clientWidth });
		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const selectionRadiusPixels =
		zoom >= GLOBE_FLAT_THRESHOLD_ZOOM && containerSize.height > 0
			? mapSelectionRadiusPixels(center.lat, zoom, radiusMeters)
			: 48;
	const isGlobeView = zoom < GLOBE_FLAT_THRESHOLD_ZOOM;
	// A decorative globe-scale ring would misrepresent a metre-scale selection.
	const showSelectionRadius = !isGlobeView && selectionRadiusPixels >= 3;

	return (
		<div
			ref={containerRef}
			aria-label="Interactive globe and street map. Drag to move and use the mouse wheel to zoom."
			aria-disabled={disabled}
			className={`relative min-h-[280px] w-full overflow-hidden rounded-lg border border-border bg-[#0b1a2b] ${disabled ? "cursor-wait" : "cursor-grab active:cursor-grabbing"} ${className}`}
			style={{ ...style, touchAction: "pan-x pan-y" }}
		>
			<MapCn
				className="absolute inset-0"
				interactive={!disabled}
				projection={{
					type: zoom < GLOBE_FLAT_THRESHOLD_ZOOM ? "globe" : "mercator",
				}}
				styles={{ light: MAP_STYLE, dark: MAP_STYLE }}
				viewport={{
					center: [center.lon, center.lat],
					zoom: clampMapZoom(zoom),
					bearing: 0,
					pitch: 0,
				}}
				onViewportChange={(viewport) => {
					const next = {
						lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, viewport.center[1])),
						lon: ((viewport.center[0] + 540) % 360) - 180,
					};
					// Zooming does not change the selected area or invalidate its preview.
					if (Math.abs(next.lat - center.lat) > 1e-9 || Math.abs(next.lon - center.lon) > 1e-9)
						onCenterChange(next);
					onZoomChange(clampMapZoom(viewport.zoom));
				}}
			>
				<MapPreviewLayer streetPreview={streetPreview} />
				<MapControls
					position="top-right"
					showCompass
					showFullscreen
					showLocate
					showZoom
				/>
			</MapCn>
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
				{showSelectionRadius && (
					<div
						aria-label={`${radiusMeters} metre import radius`}
						className={`map-radius-ring absolute rounded-full ${isGlobeView ? "is-globe" : ""}`}
						style={{
							height: selectionRadiusPixels * 2,
							width: selectionRadiusPixels * 2,
						}}
					/>
				)}
				<div className="relative h-4 w-4 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
				{showSelectionRadius && (
					<div
						className="absolute left-1/2 rounded bg-sky-950/85 px-2 py-1 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm"
						style={{
							top: `calc(50% + ${selectionRadiusPixels + 10}px)`,
							transform: "translateX(-50%)",
						}}
					>
						{radiusMeters} m
					</div>
				)}
			</div>
			{!showSelectionRadius && (
				<div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/45 px-2 py-1 text-[10px] text-white/80 backdrop-blur-sm">
					Zoom in to see the {radiusMeters} m
				</div>
			)}
		</div>
	);
}

export { MIN_MAP_ZOOM, MAX_MAP_ZOOM };
