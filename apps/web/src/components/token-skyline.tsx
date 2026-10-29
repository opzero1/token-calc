import * as React from 'react'

import { formatCompactTokens, formatNumber, formatUsd, totalTokens } from '@/lib/format'
import type { WebSnapshot } from '@/lib/snapshot'
import { cn } from '@/lib/utils'

type Cell = { date: string; column: number; row: number; cost: number; tokens: number; requests: number }
type Label = { index: number; label: string }
type Rgb = readonly [number, number, number]

type Skyline = {
  key: string
  cells: Cell[]
  columns: number
  rows: number
  maxCost: number
  peak: number
  columnLabels: Label[]
  rowLabels: Label[]
  placeholder: boolean
}

type View = { cosYaw: number; sinYaw: number; cosPitch: number; sinPitch: number; scale: number; cx: number; cy: number }

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const FOOTPRINT = 0.72
const SLAB_DEPTH = 0.34
const SLAB_PAD = 0.6
const BASE_YAW = 0.46
const BASE_PITCH = 0.62
const YAW_LIMITS = [-0.25, 1.2] as const
const PITCH_LIMITS = [0.3, 1.05] as const
const LIGHT = normalize([-0.45, 0.8, 0.4])
const PALETTE: ReadonlyArray<readonly [number, Rgb]> = [
  [0, [88, 64, 196]],
  [0.38, [70, 120, 220]],
  [0.68, [45, 212, 191]],
  [1, [217, 255, 99]],
]
const LEGEND_STOPS = [0.08, 0.3, 0.55, 0.8, 1]

function normalize([x, y, z]: Rgb): Rgb {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function utcTime(key: string) {
  return Date.parse(`${key}T00:00:00.000Z`)
}

function formatDate(key: string, options: Intl.DateTimeFormatOptions) {
  return new Date(utcTime(key)).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

function paletteColor(t: number): Rgb {
  for (let index = 1; index < PALETTE.length; index++) {
    const [stop, color] = PALETTE[index]
    if (t <= stop) {
      const [previousStop, previous] = PALETTE[index - 1]
      const mix = (t - previousStop) / (stop - previousStop)
      return [
        previous[0] + (color[0] - previous[0]) * mix,
        previous[1] + (color[1] - previous[1]) * mix,
        previous[2] + (color[2] - previous[2]) * mix,
      ]
    }
  }
  return PALETTE[PALETTE.length - 1][1]
}

function intensityColor(cost: number, maxCost: number) {
  return paletteColor(maxCost > 0 ? Math.pow(cost / maxCost, 0.55) : 0)
}

function rgb([r, g, b]: Rgb, shade = 1, alpha = 1) {
  return `rgba(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)},${alpha})`
}

function lighten([r, g, b]: Rgb, amount: number): Rgb {
  return [r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]
}

function shadeOf(nx: number, ny: number, nz: number) {
  const dot = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
  return 0.3 + (0.7 * Math.max(0, dot)) / LIGHT[1]
}

function buildSkyline(snapshot: WebSnapshot): Skyline {
  const today = utcTime(snapshot.generated.slice(0, 10))
  const first = snapshot.daily[0]?.date
  const span =
    snapshot.range === 'all'
      ? Math.max(7, first ? Math.round((today - utcTime(first)) / DAY_MS) + 1 : 7)
      : Number(snapshot.range)
  const start = today - (span - 1) * DAY_MS
  const offset = (new Date(start).getUTCDay() + 6) % 7
  const weeks = Math.ceil((span + offset) / 7)
  const linear = span <= 7
  const transposed = !linear && weeks <= 7
  const byDate = new Map(snapshot.daily.map((day) => [day.date, day]))

  const cells: Cell[] = []
  const weekLabels: Label[] = []
  const dayLabels: Label[] = []
  let peak = -1
  let maxCost = 0
  for (let index = 0; index < span; index++) {
    const date = new Date(start + index * DAY_MS).toISOString().slice(0, 10)
    const day = byDate.get(date)
    const week = Math.floor((index + offset) / 7)
    const weekday = (index + offset) % 7
    const cost = day?.costUSD ?? 0
    cells.push({
      date,
      column: linear ? index : transposed ? weekday : week,
      row: linear ? 0 : transposed ? week : weekday,
      cost,
      tokens: day ? totalTokens(day.tokens) : 0,
      requests: day?.eventCount ?? 0,
    })
    if (cost > maxCost) {
      maxCost = cost
      peak = index
    }
    if (linear) {
      dayLabels.push({ index, label: `${WEEKDAYS[weekday]} ${Number(date.slice(8))}` })
    } else if (transposed && (weekday === 0 || index === 0)) {
      weekLabels.push({ index: week, label: formatDate(date, { month: 'short', day: 'numeric' }) })
    } else if (!transposed && (index === 0 || date.endsWith('-01'))) {
      const month = formatDate(date, { month: 'short' })
      const label = index === 0 || date.slice(5, 7) === '01' ? `${month} ’${date.slice(2, 4)}` : month
      weekLabels.push({ index: week, label })
    }
  }

  const weekdayLabels = (transposed ? [0, 1, 2, 3, 4, 5, 6] : [0, 2, 4]).map((index) => ({ index, label: WEEKDAYS[index] }))
  return {
    key: `${snapshot.range}:${cells[0]?.date}:${span}`,
    cells,
    columns: linear ? span : transposed ? 7 : weeks,
    rows: linear ? 1 : transposed ? weeks : 7,
    maxCost,
    peak,
    columnLabels: linear ? dayLabels : transposed ? weekdayLabels : weekLabels,
    rowLabels: linear ? [] : transposed ? weekLabels : weekdayLabels,
    placeholder: false,
  }
}

const PLACEHOLDER: Skyline = (() => {
  const columns = 26
  const cells: Cell[] = []
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < 7; row++) {
      const wave = 0.5 + 0.5 * Math.sin(column * 0.55 + row * 0.9)
      const swell = 0.55 + 0.45 * Math.cos(column * 0.21 - 1)
      cells.push({ date: '', column, row, cost: 0.12 + 0.88 * wave * swell, tokens: 0, requests: 0 })
    }
  }
  return { key: 'placeholder', cells, columns, rows: 7, maxCost: 1, peak: -1, columnLabels: [], rowLabels: [], placeholder: true }
})()

function project(view: View, x: number, y: number, z: number): [number, number] {
  const depth = x * view.sinYaw + z * view.cosYaw
  return [
    view.cx + (x * view.cosYaw - z * view.sinYaw) * view.scale,
    view.cy - (y * view.cosPitch - depth * view.sinPitch) * view.scale,
  ]
}

// Corner index = xi * 4 + yi * 2 + zi, where each bit picks the low or high bound on that axis.
function projectBox(view: View, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, out: Float64Array) {
  for (let corner = 0; corner < 8; corner++) {
    const [px, py] = project(view, corner & 4 ? x1 : x0, corner & 2 ? y1 : y0, corner & 1 ? z1 : z0)
    out[corner * 2] = px
    out[corner * 2 + 1] = py
  }
}

function boxFaces(view: View) {
  const xi = view.sinYaw >= 0 ? 1 : 0
  const zi = view.cosYaw >= 0 ? 1 : 0
  return {
    top: [2, 6, 7, 3],
    sideX: [xi * 4, xi * 4 + 1, xi * 4 + 3, xi * 4 + 2],
    sideZ: [zi, 4 + zi, 6 + zi, 2 + zi],
    shadeX: shadeOf(xi ? 1 : -1, 0, 0),
    shadeZ: shadeOf(0, 0, zi ? 1 : -1),
  }
}

function tracePolygon(context: CanvasRenderingContext2D, points: Float64Array, face: number[]) {
  context.beginPath()
  context.moveTo(points[face[0] * 2], points[face[0] * 2 + 1])
  for (let index = 1; index < face.length; index++) context.lineTo(points[face[index] * 2], points[face[index] * 2 + 1])
  context.closePath()
}

function insidePolygon(points: Float64Array, face: number[], x: number, y: number) {
  let sign = 0
  for (let index = 0; index < face.length; index++) {
    const a = face[index]
    const b = face[(index + 1) % face.length]
    const cross =
      (points[b * 2] - points[a * 2]) * (y - points[a * 2 + 1]) - (points[b * 2 + 1] - points[a * 2 + 1]) * (x - points[a * 2])
    if (cross === 0) continue
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

type Particle = { born: number; drift: number; speed: number }

function createSkylineScene(canvas: HTMLCanvasElement, onFocus: (index: number) => void) {
  const context = canvas.getContext('2d')
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const scratch = new Float64Array(16)
  let skyline: Skyline | null = null
  let towerHeight = 4
  let current = new Float32Array(0)
  let from = new Float32Array(0)
  let target = new Float32Array(0)
  let delays = new Float32Array(0)
  let transitionStart = 0
  let transitionMs = 0
  let transitionEnd = 0
  let width = 0
  let height = 0
  let ratio = 1
  let userYaw = 0
  let userPitch = 0
  let swayTime = 0
  let scale = 0
  let centerX = 0
  let centerY = 0
  let view: View | null = null
  let order: number[] = []
  let drag: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null
  let hovered = -1
  let inside = false
  let syncing = false
  let particles: Particle[] = []
  let lastSpawn = 0
  let frame = 0
  let lastPaint = 0
  let onScreen = true
  let destroyed = false

  const isAnimating = (now: number) =>
    now < transitionEnd ||
    particles.length > 0 ||
    (!motion.matches && (syncing || skyline?.placeholder === true)) ||
    drag !== null

  function schedule() {
    if (!frame && !destroyed && onScreen && !document.hidden && width > 0) frame = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    frame = 0
    const idle = !motion.matches && !inside && drag === null
    const animating = isAnimating(now)
    if (!animating && idle && now - lastPaint < 32) {
      schedule()
      return
    }
    const elapsed = lastPaint ? Math.min(0.05, (now - lastPaint) / 1000) : 0
    lastPaint = now
    if (idle) swayTime += elapsed
    const settling = step(now, elapsed)
    draw(now)
    if (animating || idle || settling) schedule()
    else lastPaint = 0
  }

  function drawArea() {
    const compact = width < 520
    return { left: compact ? 34 : 54, right: width - (compact ? 18 : 30), top: compact ? 104 : 112, bottom: height - (compact ? 92 : 96) }
  }

  function fit(yaw: number, pitch: number) {
    if (!skyline) return { scale: 1, cx: 0, cy: 0 }
    const cosYaw = Math.cos(yaw)
    const sinYaw = Math.sin(yaw)
    const halfX = skyline.columns / 2 + SLAB_PAD
    const halfZ = skyline.rows / 2 + SLAB_PAD
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const sx of [-halfX, halfX]) {
      for (const sz of [-halfZ, halfZ]) {
        for (const y of [-SLAB_DEPTH, towerHeight]) {
          const x = sx * cosYaw - sz * sinYaw
          const screenY = -(y * Math.cos(pitch) - (sx * sinYaw + sz * cosYaw) * Math.sin(pitch))
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, screenY)
          maxY = Math.max(maxY, screenY)
        }
      }
    }
    const area = drawArea()
    const nextScale = Math.max(1, Math.min((area.right - area.left) / (maxX - minX), (area.bottom - area.top) / (maxY - minY)))
    return {
      scale: nextScale,
      cx: (area.left + area.right) / 2 - ((minX + maxX) / 2) * nextScale,
      cy: (area.top + area.bottom) / 2 - ((minY + maxY) / 2) * nextScale,
    }
  }

  function step(now: number, elapsed: number) {
    if (!skyline) return false
    const reduced = motion.matches
    for (let index = 0; index < current.length; index++) {
      const progress = transitionMs <= 0 ? 1 : clamp((now - transitionStart - delays[index]) / transitionMs, 0, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      current[index] = from[index] + (target[index] - from[index]) * eased
      if (skyline.placeholder && !reduced) {
        const cell = skyline.cells[index]
        current[index] = target[index] * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(now / 480 - cell.column * 0.42 - cell.row * 0.2)))
      }
    }

    const sway = reduced ? 0 : Math.sin(swayTime * 0.21)
    const maxYaw = skyline.columns > 20 ? 0.78 : YAW_LIMITS[1]
    const yaw = clamp(BASE_YAW + userYaw + 0.17 * sway, YAW_LIMITS[0], maxYaw)
    const pitch = clamp(BASE_PITCH + userPitch + (reduced ? 0 : 0.035 * Math.sin(swayTime * 0.17)), PITCH_LIMITS[0], PITCH_LIMITS[1])
    const next = fit(yaw, pitch)
    const follow = scale === 0 || reduced ? 1 : 1 - Math.exp(-elapsed * 5)
    scale += (next.scale - scale) * follow
    centerX += (next.cx - centerX) * follow
    centerY += (next.cy - centerY) * follow
    view = { cosYaw: Math.cos(yaw), sinYaw: Math.sin(yaw), cosPitch: Math.cos(pitch), sinPitch: Math.sin(pitch), scale, cx: centerX, cy: centerY }

    const sinYaw = view.sinYaw
    const cosYaw = view.cosYaw
    const cells = skyline.cells
    const offsetX = (skyline.columns - 1) / 2
    const offsetZ = (skyline.rows - 1) / 2
    order = cells.map((_, index) => index)
    order.sort((a, b) => {
      const depthA = (cells[a].column - offsetX) * sinYaw + (cells[a].row - offsetZ) * cosYaw
      const depthB = (cells[b].column - offsetX) * sinYaw + (cells[b].row - offsetZ) * cosYaw
      return depthA - depthB
    })

    particles = particles.filter((particle) => now - particle.born < 1400)
    if (syncing && !reduced && skyline && !skyline.placeholder && now - lastSpawn > 110) {
      lastSpawn = now
      particles.push({ born: now, drift: (Math.random() - 0.5) * 16, speed: 34 + Math.random() * 30 })
    }
    return Math.abs(next.scale - scale) > 0.01 || Math.abs(next.cx - centerX) > 0.1 || Math.abs(next.cy - centerY) > 0.1
  }

  function towerBounds(index: number) {
    const cell = skyline!.cells[index]
    const x = cell.column - (skyline!.columns - 1) / 2
    const z = cell.row - (skyline!.rows - 1) / 2
    const half = FOOTPRINT / 2
    const raw = current[index] * towerHeight
    const top = cell.cost > 0 ? Math.max(raw, 0.06) : 0.015
    return { x0: x - half, x1: x + half, z0: z - half, z1: z + half, top, x, z }
  }

  function draw(now: number) {
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    if (!skyline || !view) return
    const v = view
    const faces = boxFaces(v)
    const placeholder = skyline.placeholder
    const halfX = skyline.columns / 2 + SLAB_PAD
    const halfZ = skyline.rows / 2 + SLAB_PAD

    const [glowX, glowY] = project(v, 0, 0, 0)
    const glow = context.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(width, height) * 0.6)
    glow.addColorStop(0, placeholder ? 'rgba(255,255,255,0.05)' : 'rgba(124,92,255,0.2)')
    glow.addColorStop(1, 'rgba(124,92,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, width, height)

    projectBox(v, -halfX, halfX, -SLAB_DEPTH, 0, -halfZ, halfZ, scratch)
    const slab: Rgb = [24, 25, 32]
    context.fillStyle = rgb(slab, faces.shadeX * 0.8)
    tracePolygon(context, scratch, faces.sideX)
    context.fill()
    context.fillStyle = rgb(slab, faces.shadeZ * 0.8)
    tracePolygon(context, scratch, faces.sideZ)
    context.fill()
    context.fillStyle = rgb(slab, 1.05)
    tracePolygon(context, scratch, faces.top)
    context.fill()
    context.strokeStyle = 'rgba(255,255,255,0.09)'
    context.lineWidth = 1
    context.stroke()

    const showEdges = v.scale * FOOTPRINT > 7
    for (const index of order) {
      const cell = skyline.cells[index]
      const bounds = towerBounds(index)
      projectBox(v, bounds.x0, bounds.x1, 0, bounds.top, bounds.z0, bounds.z1, scratch)

      if (cell.cost <= 0) {
        context.fillStyle = index === hovered ? 'rgba(217,255,99,0.35)' : 'rgba(255,255,255,0.045)'
        tracePolygon(context, scratch, faces.top)
        context.fill()
        continue
      }

      const intensity = placeholder ? 0 : cell.cost / skyline.maxCost
      let color: Rgb = placeholder ? [92, 94, 106] : intensityColor(cell.cost, skyline.maxCost)
      if (index === hovered) color = lighten(color, 0.35)
      const alpha = placeholder ? 0.55 : 1

      context.fillStyle = rgb(color, faces.shadeX, alpha)
      tracePolygon(context, scratch, faces.sideX)
      context.fill()
      context.fillStyle = rgb(color, faces.shadeZ, alpha)
      tracePolygon(context, scratch, faces.sideZ)
      context.fill()

      const glowing = !placeholder && (intensity > 0.82 || index === hovered)
      if (glowing) {
        context.shadowColor = rgb(color, 1, 0.65)
        context.shadowBlur = 16
      }
      context.fillStyle = rgb(lighten(color, 0.08), 1, alpha)
      tracePolygon(context, scratch, faces.top)
      context.fill()
      if (glowing) {
        context.shadowBlur = 0
        context.shadowColor = 'transparent'
      }
      if (showEdges || index === hovered) {
        context.strokeStyle = index === hovered ? 'rgba(255,255,255,0.9)' : `rgba(255,255,255,${0.08 + intensity * 0.22})`
        context.lineWidth = index === hovered ? 1.4 : 0.8
        context.stroke()
      }
    }

    drawLabels(v, halfX, halfZ)
    drawParticles(v, now)

    const focus = hovered >= 0 ? hovered : skyline.peak
    if (!placeholder && focus >= 0 && skyline.cells[focus].cost > 0) drawCallout(v, focus, hovered >= 0)
  }

  function drawLabels(v: View, halfX: number, halfZ: number) {
    if (!context || !skyline) return
    context.font = '600 10px Inter, ui-sans-serif, system-ui, sans-serif'
    context.fillStyle = 'rgba(148,150,159,0.85)'
    context.textBaseline = 'middle'
    context.textAlign = 'center'
    let previous: { x: number; y: number; width: number } | null = null
    for (const { index, label } of skyline.columnLabels) {
      const [x, y] = project(v, index - (skyline.columns - 1) / 2, -SLAB_DEPTH, halfZ + 0.55)
      const labelWidth = context.measureText(label).width
      if (previous && Math.abs(x - previous.x) < (labelWidth + previous.width) / 2 + 8 && Math.abs(y - previous.y) < 13) continue
      context.fillText(label, x, y + 8)
      previous = { x, y, width: labelWidth }
    }
    context.textAlign = 'right'
    let lastY = -Infinity
    for (const { index, label } of skyline.rowLabels) {
      const [x, y] = project(v, -halfX - 0.35, 0, index - (skyline.rows - 1) / 2)
      if (Math.abs(y - lastY) < 12) continue
      context.fillText(label, x, y)
      lastY = y
    }
  }

  function drawParticles(v: View, now: number) {
    if (!context || !skyline || particles.length === 0) return
    const latest = towerBounds(skyline.cells.length - 1)
    const [baseX, baseY] = project(v, latest.x, latest.top, latest.z)
    for (const particle of particles) {
      const age = (now - particle.born) / 1000
      const life = age / 1.4
      context.fillStyle = `rgba(217,255,99,${(1 - life) * 0.9})`
      context.beginPath()
      context.arc(baseX + particle.drift * age, baseY - particle.speed * age, 1.8 * (1 - life * 0.5), 0, Math.PI * 2)
      context.fill()
    }
  }

  function drawCallout(v: View, index: number, selected: boolean) {
    if (!context || !skyline) return
    const bounds = towerBounds(index)
    const [x, y] = project(v, bounds.x, bounds.top, bounds.z)
    const text = selected ? formatUsd(skyline.cells[index].cost) : `Peak · ${formatUsd(skyline.cells[index].cost)}`
    context.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif'
    const pillWidth = context.measureText(text).width + 18
    const pillHeight = 22
    const lift = 26
    const left = clamp(x - pillWidth / 2, 6, width - pillWidth - 6)
    const top = Math.max(6, y - lift - pillHeight)

    context.strokeStyle = selected ? 'rgba(255,255,255,0.7)' : 'rgba(217,255,99,0.55)'
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(x, y - 2)
    context.lineTo(x, top + pillHeight)
    context.stroke()
    context.fillStyle = 'rgba(9,10,13,0.88)'
    context.beginPath()
    context.roundRect(left, top, pillWidth, pillHeight, 11)
    context.fill()
    context.stroke()
    context.fillStyle = selected ? '#f4f4ef' : '#d9ff63'
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillText(text, left + 9, top + pillHeight / 2 + 0.5)
  }

  function hitTest(x: number, y: number) {
    if (!skyline || skyline.placeholder || !view) return -1
    const faces = boxFaces(view)
    for (let position = order.length - 1; position >= 0; position--) {
      const index = order[position]
      const bounds = towerBounds(index)
      projectBox(view, bounds.x0, bounds.x1, 0, bounds.top, bounds.z0, bounds.z1, scratch)
      if (
        insidePolygon(scratch, faces.top, x, y) ||
        insidePolygon(scratch, faces.sideX, x, y) ||
        insidePolygon(scratch, faces.sideZ, x, y)
      ) {
        return index
      }
    }
    return -1
  }

  function setHovered(index: number) {
    if (index === hovered) return
    hovered = index
    onFocus(index)
    schedule()
  }

  function localPoint(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top] as const
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: userYaw, pitch: userPitch }
    canvas.setPointerCapture(event.pointerId)
    canvas.style.cursor = 'grabbing'
    const [x, y] = localPoint(event)
    setHovered(hitTest(x, y))
    schedule()
  }

  function onPointerMove(event: PointerEvent) {
    if (drag && drag.id === event.pointerId) {
      userYaw = clamp(drag.yaw + (event.clientX - drag.x) * 0.006, -0.75, 0.75)
      userPitch = clamp(drag.pitch - (event.clientY - drag.y) * 0.004, -0.32, 0.42)
      schedule()
      return
    }
    const [x, y] = localPoint(event)
    setHovered(hitTest(x, y))
  }

  function onPointerUp(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return
    drag = null
    canvas.style.cursor = ''
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    schedule()
  }

  function onPointerEnter() {
    inside = true
  }

  function onPointerLeave() {
    inside = false
    if (!drag) setHovered(-1)
    schedule()
  }

  function resize() {
    ratio = Math.min(window.devicePixelRatio || 1, 2)
    width = canvas.clientWidth
    height = canvas.clientHeight
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    scale = 0
    lastPaint = 0
    schedule()
  }

  function onVisibilityChange() {
    if (!document.hidden) schedule()
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  const intersection = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1]?.isIntersecting ?? true
    if (onScreen) {
      lastPaint = 0
      schedule()
    }
  })
  intersection.observe(canvas)
  document.addEventListener('visibilitychange', onVisibilityChange)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerenter', onPointerEnter)
  canvas.addEventListener('pointerleave', onPointerLeave)

  return {
    setSkyline(next: Skyline) {
      const now = performance.now()
      const sameShape = skyline !== null && !skyline.placeholder && !next.placeholder && skyline.key === next.key
      const count = next.cells.length
      from = sameShape ? current.slice() : new Float32Array(count)
      target = new Float32Array(count)
      delays = new Float32Array(count)
      let longestDelay = 0
      for (let index = 0; index < count; index++) {
        const cell = next.cells[index]
        target[index] = next.maxCost > 0 ? cell.cost / next.maxCost : 0
        if (!sameShape && !next.placeholder) {
          delays[index] = (cell.column / Math.max(1, next.columns - 1)) * 520 + cell.row * 18
          longestDelay = Math.max(longestDelay, delays[index])
        }
      }
      current = from.slice()
      transitionMs = motion.matches || next.placeholder ? 0 : sameShape ? 650 : 950
      transitionStart = now
      transitionEnd = transitionMs > 0 ? now + transitionMs + longestDelay : now
      towerHeight = clamp(Math.max(next.columns, next.rows) * 0.11 + 2.6, 3.2, 7.5)
      skyline = next
      if (!sameShape) setHovered(-1)
      lastPaint = 0
      schedule()
    },
    setSyncing(value: boolean) {
      syncing = value
      schedule()
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerenter', onPointerEnter)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    },
  }
}

type SkylineScene = ReturnType<typeof createSkylineScene>

export function TokenSkyline({ snapshot, syncing, className }: { snapshot: WebSnapshot | null; syncing: boolean; className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const sceneRef = React.useRef<SkylineScene | null>(null)
  const skyline = React.useMemo(() => (snapshot ? buildSkyline(snapshot) : PLACEHOLDER), [snapshot])
  const [focusIndex, setFocusIndex] = React.useState(-1)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = createSkylineScene(canvas, setFocusIndex)
    sceneRef.current = scene
    return () => {
      scene.destroy()
      sceneRef.current = null
    }
  }, [])

  React.useEffect(() => {
    sceneRef.current?.setSkyline(skyline)
  }, [skyline])

  React.useEffect(() => {
    sceneRef.current?.setSyncing(syncing)
  }, [syncing])

  const focus = skyline.placeholder ? null : (skyline.cells[focusIndex] ?? skyline.cells[skyline.peak] ?? null)
  const selected = focusIndex >= 0 && skyline.cells[focusIndex] !== undefined
  const peak = skyline.cells[skyline.peak]

  return (
    <div className={cn('skyline-case', className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          skyline.placeholder
            ? 'Daily spend skyline, loading'
            : `Daily spend skyline for ${skyline.cells.length} days${peak ? `, peaking at ${formatUsd(peak.cost)} on ${formatDate(peak.date, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}`
        }
        className="absolute inset-0 size-full cursor-grab touch-pan-y select-none"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <div className="eyebrow">
            <span className={cn('status-dot is-active', syncing && 'animate-pulse')} />
            Spend skyline
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {skyline.placeholder ? 'Raising your skyline…' : `${skyline.cells.length} days · one tower per day`}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:flex">
          Less
          {LEGEND_STOPS.map((stop) => (
            <span key={stop} className="size-2.5 rounded-[3px]" style={{ backgroundColor: rgb(paletteColor(stop)) }} />
          ))}
          More
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-6">
        {focus ? (
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {selected ? 'Selected day' : 'Peak day'}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-heading text-base font-medium tracking-[-0.02em]">
                {formatDate(focus.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span className="font-heading text-base font-medium text-main">{formatUsd(focus.cost)}</span>
              <span className="text-xs text-muted-foreground">
                {focus.cost > 0
                  ? `${formatCompactTokens(focus.tokens)} tokens · ${formatNumber(focus.requests)} requests`
                  : 'No recorded usage'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {skyline.placeholder ? 'Reading local model activity…' : 'No spend recorded in this window'}
          </div>
        )}
        <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:block">
          Drag to orbit
        </span>
      </div>
    </div>
  )
}
