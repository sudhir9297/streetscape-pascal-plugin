'use client'

import RoadNetworkTool from './road-network-tool'

/** The host's plan canvas emits the same grid events as the 3D grid. */
export default function RoadNetworkFloorplanTool() {
  return <RoadNetworkTool renderPreview={false} />
}
