import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { nextRoadElevationMode, ROAD_ELEVATION_OPTIONS } from './store'

describe('road drafting cursor', () => {
  test('uses the shared wall-style ground marker and vertical guide', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(/CursorSphere,\s+EDITOR_LAYER/)
    expect(source).toContain('const WALL_STYLE_CURSOR_HEIGHT = 2.5')
    expect(source).toContain('color={invalid ? "#ef4444" : color}')
    expect(source).toContain('height={WALL_STYLE_CURSOR_HEIGHT}')
    expect(source).not.toContain('<cylinderGeometry args={[0.16, 0.16, 0.08, 24]} />')
  })

  test('uses host angle-ray mode with a visible directional guide', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).toContain('import * as PascalEditor')
    expect(source).toContain('hostSnapApi.isAngleSnapActive?.()')
    expect(source).toContain('snapRoadPointAlongAngleRay(')
    expect(source).toContain('name="road-angle-snap-ray"')
    expect(source).toContain('draftSnapMode ===')
    expect(source).toContain('angle')
  })

  test('publishes host alignment guides and applies their pull only in Lines mode', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).toContain('collectAlignmentAnchors(')
    expect(source).toContain('roadEndpointAlignmentAnchors(graph, {')
    expect(source).toContain('hostSnapApi.useAlignmentGuides?.getState().set(guides)')
    expect(source).toContain('hostSnapApi.resolveAlignmentForActiveBuilding?.(input)')
    expect(source).toContain('if (mode === "lines" && alignment.snap')
    expect(source).toContain('clearRoadAlignmentGuides();')
  })

  test('blocks rejected commits with visual feedback but no floating error text', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('data-road-draft-error={invalid.code}')
    expect(source).not.toContain('role="alert"')
    expect(source).toContain('showTooltip={Boolean(showNumeric)}')
    expect(source).toContain('name="road-invalid-cursor"')
    expect(source).toContain('roadDraftInvalidState(')
    expect(source).toContain('setAttemptedInvalid(invalid)')
    expect(source).toContain('invalid={invalidDraft}')
  })

  test('supports exact keyboard entry for road dimensions while drafting', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).toContain('ROAD_DRAFT_NUMERIC_FIELDS')
    expect(source).toContain('applyRoadDraftDirectionConstraints(')
    expect(source).toContain('data-road-draft-numeric={numeric?.field ?? "constraints"}')
    expect(source).toContain('setRoadBendRadius(value)')
    expect(source).toContain('tangentLengthRef.current ?? undefined')
    expect(source).toContain('window.addEventListener("keydown", onKeyDown, true)')
    expect(source).toContain('} else if (startRef.current && cursorPointRef.current) {')
  })

  test('uses one continuous surface set for the sampled spline preview', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).toContain('<RoadDraftPreviewSurface')
    expect(source).toContain('points={previewPoints}')
    expect(source).not.toContain('previewPoints.slice(0, -1).map')
  })

  test('does not update a stale 3D cursor ref while switching floorplan tools', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).toContain('cursorRef.current?.position?.set(')
  })

  test('offers and cycles only ground and bridge drafting modes', () => {
    expect(ROAD_ELEVATION_OPTIONS.map((option) => option.value)).toEqual([
      'ground',
      'bridge',
    ])
    expect(nextRoadElevationMode('ground')).toBe('bridge')
    expect(nextRoadElevationMode('bridge')).toBe('ground')
  })

	test('does not expose tunnel conversion in the selected-road inspector', () => {
		const source = readFileSync(new URL('./road-network-parametrics.ts', import.meta.url), 'utf8')

		expect(source).not.toContain('label: "Tunnel"')
		expect(source).not.toContain('component: RoadTunnelEditor')
		expect(source).not.toContain('key: "tunnelPortalCutLength"')
	})
})

describe('road side-menu authoring controls', () => {
  test('exposes roadway dimensions and independent left/right components', () => {
    const source = readFileSync(new URL('./presets-panel.tsx', import.meta.url), 'utf8')

    expect(source).toContain('aria-label="Road preset"')
    expect(source).toContain("{ label: 'Roadway', value: 'roadway' }")
    expect(source).toContain("{ label: 'Left', value: 'left' }")
    expect(source).toContain("{ label: 'Right', value: 'right' }")
    expect(source).toContain('label="Lane count"')
    expect(source).toContain('label="Lane width"')
    expect(source).toContain("label: 'Parking lane'")
  })

  test('uses the complete draft style for previews and committed segments', () => {
    const source = readFileSync(new URL('./road-network-tool.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const draftStyle = buildRoadDraftStyle({')
    expect(source).toContain('graph.activeStyleId = draftStyle.id')
    expect(source).toMatch(/\(\) =>\s+buildRoadDraftStyle\(\{/)
    expect(source).toContain('current.activeStyleId === component.activeStyleId')
  })

  test('reviews road cleanup changes before applying them', () => {
    const source = readFileSync(new URL('./presets-panel.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Review cleanup')
    expect(source).toContain('data-road-cleanup-review')
    expect(source).toContain('data-road-cleanup-change={change.kind}')
    expect(source).toContain('Apply changes')
    expect(source.indexOf('planRoadGraphCleanup')).toBeLessThan(
      source.indexOf('updateNode(\n      selectedRoadNetwork.id'),
    )
  })
})
