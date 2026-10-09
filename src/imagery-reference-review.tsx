"use client";
import { useState } from "react";
import {
	createManualImageReference,
	MANUAL_IMAGERY_FALLBACK,
	StreetImageReference,
	type StreetImageryCoverage,
} from "./domain/street-imagery";
import { RecordedImageryObservations } from "./imagery-observation-review";
import { ImageryMapBrowser } from "./imagery-map-browser";
import { acquireMapillaryCoverage } from "./source/mapillary-imagery";

/** Preparation only: accepting observations/corrections uses later explicit commands. */
export function ImageryReferenceReview({
	accessToken,
	onReferences,
}: {
	accessToken?: string;
	onReferences?: (references: StreetImageReference[]) => void;
}) {
	const [url, setUrl] = useState("");
	const [imageUrl, setImageUrl] = useState("");
	const [heading, setHeading] = useState("");
	const [date, setDate] = useState("");
	const [author, setAuthor] = useState("");
	const [licenseUrl, setLicenseUrl] = useState("");
	const [license, setLicense] = useState("");
	const [lat, setLat] = useState("");
	const [lon, setLon] = useState("");
	const [references, setReferences] = useState<StreetImageReference[]>([]);
	const [coverage, setCoverage] = useState<StreetImageryCoverage | null>(null);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const update = (next: StreetImageReference[]) => {
		setReferences(next);
		onReferences?.(next);
	};
	const field = {
		width: "100%",
		padding: "6px 8px",
		border: "1px solid #666",
		borderRadius: 6,
		color: "inherit",
		background: "transparent",
	};
	const label = { display: "flex", flexDirection: "column" as const, gap: 4 };
	return (
		<details style={{ marginTop: 12, fontSize: 12 }}>
			<summary>Street imagery evidence</summary>
			<section
				aria-label="Imagery reference review"
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 8,
					paddingTop: 8,
				}}
			>
				<p>{MANUAL_IMAGERY_FALLBACK}</p>
				<p>
					References stay in this review until explicitly used as evidence. A
					photo is not a reliable width measurement without calibration.
				</p>
				<button
					type="button"
					style={field}
					disabled={busy}
					onClick={async () => {
						try {
							setBusy(true);
							const result = await acquireMapillaryCoverage({
								accessToken,
								bounds: {
									south: 37.7825,
									north: 37.7845,
									west: -122.41,
									east: -122.407,
								},
							});
							setCoverage(result);
							if (result.references.length) update(result.references);
						} finally {
							setBusy(false);
						}
					}}
				>
					Check Market Street imagery availability
				</button>
				{coverage && (
					<p role="status">
						{coverage.message}
						{coverage.truncated
							? " Results are limited; coverage is incomplete."
							: ""}
					</p>
				)}
				<label style={label}>
					Image reference URL
					<input
						style={field}
						aria-label="Image reference URL"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="https://…"
					/>
				</label>
				<label style={label}>
					Direct image URL (optional, only images you have permission to use)
					<input
						style={field}
						aria-label="Direct image URL"
						value={imageUrl}
						onChange={(event) => setImageUrl(event.target.value)}
					/>
				</label>
				<label style={label}>
					Heading in degrees (optional)
					<input
						style={field}
						aria-label="Image heading"
						type="number"
						min="0"
						max="359.999"
						step="any"
						value={heading}
						onChange={(event) => setHeading(event.target.value)}
					/>
				</label>
				<label style={label}>
					Capture date (leave empty if unknown)
					<input
						style={field}
						aria-label="Image capture date"
						type="text"
						placeholder="YYYY-MM-DD"
						value={date}
						onChange={(event) => setDate(event.target.value)}
					/>
				</label>
				<label style={label}>
					Photographer or author
					<input
						style={field}
						aria-label="Image author"
						value={author}
						onChange={(event) => setAuthor(event.target.value)}
					/>
				</label>
				<label style={label}>
					License or rights
					<input
						style={field}
						aria-label="Image license"
						value={license}
						onChange={(event) => setLicense(event.target.value)}
						placeholder="User-owned photo or published license"
					/>
				</label>
				<label style={label}>
					License URL (optional)
					<input
						style={field}
						aria-label="Image license URL"
						value={licenseUrl}
						onChange={(event) => setLicenseUrl(event.target.value)}
					/>
				</label>
				<label style={label}>
					Approximate latitude (optional)
					<input
						style={field}
						aria-label="Image latitude"
						type="number"
						step="any"
						value={lat}
						onChange={(event) => setLat(event.target.value)}
					/>
				</label>
				<label style={label}>
					Approximate longitude (optional)
					<input
						style={field}
						aria-label="Image longitude"
						type="number"
						step="any"
						value={lon}
						onChange={(event) => setLon(event.target.value)}
					/>
				</label>
				<button
					type="button"
					style={field}
					onClick={() => {
						try {
							if (Boolean(lat) !== Boolean(lon))
								throw Error("Enter both coordinates or leave both empty.");
							const pageUrl = new URL(url);
							const mapillaryId =
								pageUrl.hostname === "www.mapillary.com" ||
								pageUrl.hostname === "mapillary.com"
									? pageUrl.searchParams.get("pKey")
									: null;
							const input = {
								id: mapillaryId
									? `mapillary~${mapillaryId}`
									: `manual~${crypto.randomUUID()}`,
								pageUrl: pageUrl.toString(),
								imageUrl: imageUrl || null,
								capturedAt: date || null,
								location:
									lat && lon ? { lat: Number(lat), lon: Number(lon) } : null,
								locationBasis:
									lat && lon
										? ("user-positioned" as const)
										: ("unknown" as const),
								locationAccuracyMeters: null,
								headingDegrees: heading === "" ? null : Number(heading),
								panoramic: null,
								creator: { name: author, profileUrl: null },
								license: { name: license, url: licenseUrl || null },
								acquiredAt: new Date().toISOString(),
								availability: imageUrl
									? ("image-available" as const)
									: ("linked" as const),
								uncertainty:
									"User supplied date and approximate location. Accuracy is unknown; the image may show older conditions and does not establish metric dimensions.",
							};
							const reference = mapillaryId
								? StreetImageReference.parse({
										...input,
										format: "street-image-reference",
										schemaVersion: 1,
										provider: "mapillary",
										providerImageId: mapillaryId,
									})
								: createManualImageReference(input);
							if (
								references.some(
									(existing) => existing.pageUrl === reference.pageUrl,
								)
							)
								throw Error("This image reference is already in the review.");
							update([...references, reference]);
							setMessage("Image reference ready for evidence review.");
						} catch (error) {
							setMessage(
								error instanceof Error
									? error.message
									: "Image reference is invalid.",
							);
						}
					}}
				>
					Review image reference
				</button>
				{message && <p role="status">{message}</p>}
				<ImageryMapBrowser references={references} />
				{references.length === 0 && <RecordedImageryObservations />}
				{references.map((reference) => (
					<article
						key={reference.id}
						style={{ padding: 8, border: "1px solid #666", borderRadius: 6 }}
					>
						<a
							href={reference.pageUrl}
							target="_blank"
							rel="noopener noreferrer"
						>
							Open{" "}
							{reference.provider === "mapillary"
								? "Mapillary image"
								: "image reference"}
						</a>
						<p>Captured: {reference.capturedAt ?? "Unknown date"}</p>
						<p>
							By {reference.creator.name} · {reference.license.name}
						</p>
						<p>
							{reference.location
								? `Approximate location: ${reference.location.lat}, ${reference.location.lon}`
								: "Location unknown"}{" "}
							· Accuracy unknown
						</p>
						<p>{reference.uncertainty}</p>
					</article>
				))}
				{references.length > 0 && (
					<button
						type="button"
						style={field}
						onClick={() => {
							update([]);
							setMessage("Image review cleared.");
						}}
					>
						Clear image reference review
					</button>
				)}
			</section>
		</details>
	);
}
