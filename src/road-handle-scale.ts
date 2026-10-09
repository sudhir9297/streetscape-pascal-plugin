'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import type { Camera, Group, OrthographicCamera } from 'three'

/** CameraControls mutates zoom without a React render, so update each frame. */
export function useRoadHandleScale(baseScale: number) {
  const ref = useRef<Group>(null)
  const camera = useThree(state => state.camera)
  const update = (camera: Camera) => {
    const zoom = 'isOrthographicCamera' in camera && camera.isOrthographicCamera
      ? (camera as OrthographicCamera).zoom : 1
    ref.current?.scale.setScalar(baseScale / zoom)
  }
  useLayoutEffect(() => update(camera), [camera, baseScale])
  useFrame(({ camera }) => update(camera))
  return ref
}
