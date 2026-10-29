import * as React from 'react'

export type Point = readonly [x: number, y: number]

// Monotone cubic interpolation (Fritsch–Carlson) keeps the curve from overshooting below zero.
export function monotonePath(points: readonly Point[]): string {
  const count = points.length
  if (count === 0) return ''
  if (count === 1) return `M${points[0][0]},${points[0][1]}`

  const slopes: number[] = []
  for (let index = 0; index < count - 1; index++) {
    const dx = points[index + 1][0] - points[index][0]
    slopes.push(dx === 0 ? 0 : (points[index + 1][1] - points[index][1]) / dx)
  }

  const tangents = [slopes[0]]
  for (let index = 1; index < count - 1; index++) {
    const before = slopes[index - 1]
    const after = slopes[index]
    if (before * after <= 0) {
      tangents.push(0)
      continue
    }
    const dxBefore = points[index][0] - points[index - 1][0]
    const dxAfter = points[index + 1][0] - points[index][0]
    tangents.push((3 * (dxBefore + dxAfter)) / ((2 * dxAfter + dxBefore) / before + (dxAfter + 2 * dxBefore) / after))
  }
  tangents.push(slopes[count - 2])

  let path = `M${points[0][0]},${points[0][1]}`
  for (let index = 0; index < count - 1; index++) {
    const [x0, y0] = points[index]
    const [x1, y1] = points[index + 1]
    const third = (x1 - x0) / 3
    path += `C${x0 + third},${y0 + tangents[index] * third},${x1 - third},${y1 - tangents[index + 1] * third},${x1},${y1}`
  }
  return path
}

export function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidate) => candidate * magnitude >= value) ?? 10
  return step * magnitude
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
