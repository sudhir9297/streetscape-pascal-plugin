import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { roadNetworkEditingControlsState } from './road-network-editing-controls'

describe('road editing control visibility', () => {
  test('keeps endpoint arrows on selection but requires explicit spline editing for shape handles', () => {
    expect(roadNetworkEditingControlsState({
      networkSelected: false,
      roadToolActive: false,
      splineEditing: false,
    })).toEqual({ lengthArrows: false, splineHandles: false })

    expect(roadNetworkEditingControlsState({
      networkSelected: true,
      roadToolActive: false,
      splineEditing: false,
    })).toEqual({ lengthArrows: true, splineHandles: false })

    expect(roadNetworkEditingControlsState({
      networkSelected: true,
      roadToolActive: false,
      splineEditing: true,
    })).toEqual({ lengthArrows: true, splineHandles: true })
  })

  test('uses the shared amber anchor and violet hover colors', () => {
    const source = readFileSync(
      new URL('./road-network-spline-controls.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('<sphereGeometry')
    expect(source).not.toContain('<coneGeometry')
    expect(source).toContain('const HANDLE_COLOR = "#d6a56a"')
    expect(source).toContain('const HANDLE_HOVER_COLOR = "#a5b4fc"')
  })

  test('reveals a blue vertical elevation grip for the selected spline point', () => {
    const source = readFileSync(
      new URL('./road-network-spline-controls.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('const ELEVATION_HANDLE_COLOR = "#38bdf8"')
    expect(source).toContain('beginDrag(event, "elevation")')
    expect(source).toContain('<cylinderGeometry')
    expect(source).toContain('road-elevation-hit:')
  })

  test('uses free XZ plan dragging without side-axis grips', () => {
    const source = readFileSync(
      new URL('./road-network-spline-controls.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('onPointerDown={(event) => beginDrag(event, "plan")}')
    expect(source).toContain('new Plane(new Vector3(0, 1, 0), -point[1])')
    expect(source).not.toContain('road-x-axis-hit:')
    expect(source).not.toContain('road-z-axis-hit:')
    expect(source).not.toContain('nextPoint.z = originalPoint.z')
    expect(source).not.toContain('nextPoint.x = originalPoint.x')
  })

  test('provides insertion handles, modifier multi-selection, and deletion', () => {
    const source = readFileSync(
      new URL('./road-network-spline-controls.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('road-insert-point-hit:')
    expect(source).toContain('nativeEvent.ctrlKey || nativeEvent.metaKey')
    expect(source).toContain('event.key !== "Delete"')
    expect(source).toContain('moveRoadSplinePoints')
  })

  test('routes graph-node moves and edge deletion through localized topology updates', () => {
    const affordanceSource = readFileSync(
      new URL('./road-network-affordances.ts', import.meta.url),
      'utf8',
    )
    const rendererSource = readFileSync(
      new URL('./plugin-lifecycle.ts', import.meta.url),
      'utf8',
    )
    const extensionSource = readFileSync(
      new URL('./road-network-extension-handles.ts', import.meta.url),
      'utf8',
    )
    expect(affordanceSource).toContain('moveRoadGraphNode(node, graphNodeId')
    expect(rendererSource).toContain('commitRoadEdgeDeletion(parsed.data, selection.id)')
    expect(rendererSource).toMatch(/window\.addEventListener\(["']keydown["'], onDeleteEdge, true\)/)
    expect(rendererSource).toContain('event.stopImmediatePropagation()')
    expect(extensionSource).toContain('moveRoadGraphNode(node, graphNodeId')
  })
})
