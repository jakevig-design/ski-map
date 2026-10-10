import { useEffect, useRef, type ReactNode } from 'react'
import { geoConicConformal, geoPath } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom'
import 'd3-transition'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Area, Mountain, Target } from '../lib/types'
import { tripCount } from '../lib/format'

// The map is drawn imperatively with d3 into one <svg>; React owns the data and
// the selection, this component owns geometry, zoom and label placement.
// Layers, bottom to top: water (background), land, admin-1, lakes, country
// borders, background ski areas, Jake's pins. Strokes don't scale with zoom.

type AdminProps = { iso_a2: string; name: string; postal: string }
type Geo = {
  land: FeatureCollection
  admin: FeatureCollection<Geometry, AdminProps>
  lakes: FeatureCollection
  borders: ReturnType<typeof mesh>
}

interface Props {
  mountains: Mountain[]
  areas: Area[] // background ski areas, already minus Jake's
  selected: Target | null
  /** Bumped (with a pick) whenever the map should fly to the selection. */
  flyNonce: number
  onSelect: (pick: Target | null, fly: boolean) => void
  children?: ReactNode // the card, positioned over the map
}

type Pt = { key: string; kind: 'mine' | 'area'; id: number | string; name: string; lon: number; lat: number; x: number; y: number }

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
// The mockup's frame: lower 48 plus Whistler and Tremblant.
const FRAME = { type: 'MultiPoint' as const, coordinates: [[-125, 32], [-66, 46], [-123, 51], [-70, 44.5], [-112, 33.5]] }
const LABEL_ZOOM_AREAS = 5

async function loadGeo(): Promise<Geo> {
  const get = (f: string) => fetch(`${import.meta.env.BASE_URL}data/${f}.json`).then((r) => r.json() as Promise<Topology>)
  const [land, admin, lakes] = await Promise.all([get('land'), get('admin'), get('lakes')])
  const adminObj = admin.objects.admin as GeometryCollection<AdminProps>
  return {
    land: feature(land, land.objects.land) as unknown as FeatureCollection,
    admin: feature(admin, adminObj) as unknown as FeatureCollection<Geometry, AdminProps>,
    lakes: feature(lakes, lakes.objects.lakes) as unknown as FeatureCollection,
    borders: mesh(admin, adminObj, (a, b) => a !== b && (a.properties as AdminProps).iso_a2 !== (b.properties as AdminProps).iso_a2),
  }
}

export default function MapView({ mountains, areas, selected, flyNonce, onSelect, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  // Live view of props for the d3 callbacks, which are bound once.
  const props = useRef({ mountains, areas, selected, onSelect })
  const api = useRef<{ draw: () => void; flyTo: (p: Target) => void; zoomBy: (f: number) => void; home: () => void } | null>(null)

  useEffect(() => {
    const svgEl = svgRef.current!, wrap = wrapRef.current!
    const svg = select(svgEl)
    const g = svg.append('g')
    const gBase = g.append('g')
    const gAreas = g.append('g').attr('class', 'areas')
    const gPins = g.append('g')
    const proj = geoConicConformal().rotate([96, 0]).parallels([33, 60])
    const path = geoPath(proj)
    let geo: Geo | null = null
    let k = 1
    let disposed = false

    const size = () => { const r = wrap.getBoundingClientRect(); return [r.width, r.height] as const }

    function fit() {
      const [w, h] = size()
      if (!w || !h) return
      svg.attr('viewBox', `0 0 ${w} ${h}`)
      proj.fitExtent([[40, 50], [w - 30, h - 110]], FRAME)
      gBase.selectAll('*').remove()
      if (!geo) return
      gBase.append('path').datum(geo.land).attr('class', 'land').attr('d', path)
      gBase.selectAll('.a').data(geo.admin.features).join('path')
        .attr('class', (d) => (d.properties.iso_a2 === 'US' ? 'admin-us' : 'admin-out')).attr('d', path)
      gBase.append('path').datum(geo.lakes).attr('class', 'lake').attr('d', path)
      gBase.append("path").datum(geo.borders as unknown as Feature).attr('class', 'country').attr('d', path)
    }

    const project = (lon: number, lat: number) => proj([lon, lat]) ?? [0, 0]

    function points(): { mine: (Pt & { m: Mountain })[]; bg: Pt[] } {
      const { mountains, areas } = props.current
      return {
        mine: mountains.map((m) => { const [x, y] = project(m.lon, m.lat); return { key: `m${m.id}`, kind: 'mine', id: m.id, name: m.name, lon: m.lon, lat: m.lat, x, y, m } }),
        bg: areas.map((a) => { const [x, y] = project(a.lon, a.lat); return { key: `a${a.id}`, kind: 'area', id: a.id, name: a.name, lon: a.lon, lat: a.lat, x, y } }),
      }
    }

    function draw() {
      if (disposed) return
      const { selected } = props.current
      const isSel = (p: Pt) => !!selected && selected.kind === p.kind && selected.id === p.id
      const t = zoomTransform(svgEl)
      const [VW, VH] = size()
      const { mine, bg } = points()

      // Sizes follow the mockup's curve: triangles ~ k^0.25, labels ~ k^0.2 on screen.
      const sz = (9 / k) * Math.pow(k, 0.25)
      const fs = (12.5 / k) * Math.pow(k, 0.2)
      const fsScreen = 12.5 * Math.pow(k, 0.2)
      const bsz = sz * 0.55
      const tri = (s: number) => `M0,${-s}L${s * 1.15},${s * 0.75}L${-s * 1.15},${s * 0.75}Z`

      // Background areas: small hollow triangles; muted labels from zoom 5.
      const bgSel = gAreas.selectAll<SVGGElement, Pt>('g.bg').data(bg, (d) => d.key).join((enter) => {
        const e = enter.append('g').attr('class', 'bg')
        e.append('circle').attr('class', 'hit')
        e.append('path').attr('class', 'tri-bg')
        e.append('text').attr('class', 'lbl-bg')
        e.on('click', (ev: MouseEvent, d) => { ev.stopPropagation(); props.current.onSelect({ kind: 'area', id: d.id as string }, true) })
        return e
      })
      bgSel.attr('transform', (d) => `translate(${d.x},${d.y})`).classed('sel', isSel)
      bgSel.select('.tri-bg').attr('d', tri(bsz))
      bgSel.select('.hit').attr('r', Math.max(bsz * 1.6, 7 / k))

      // Jake's pins, southern first so northern ones draw on top.
      const pins = mine.slice().sort((a, b) => a.lat - b.lat)
      const pinSel = gPins.selectAll<SVGGElement, (typeof pins)[number]>('g.mtn').data(pins, (d) => d.key).join((enter) => {
        const e = enter.append('g')
        e.append('circle').attr('class', 'hit')
        e.append('path').attr('class', 'tri')
        e.append('circle').attr('class', 'head')
        e.append('text').attr('class', 'lbl')
        e.on('click', (ev: MouseEvent, d) => { ev.stopPropagation(); props.current.onSelect({ kind: 'mine', id: d.id as number }, true) })
        return e
      })
      pinSel.attr('class', (d) => `mtn ${d.m.status}${isSel(d) ? ' sel' : ''}`).attr('transform', (d) => `translate(${d.x},${d.y})`)
      pinSel.select('.tri').attr('d', tri(sz)).attr('stroke-width', (1.3 / k) * Math.pow(k, 0.2))
      pinSel.select('.head').attr('cx', sz * 0.35).attr('cy', -sz * 0.85).attr('r', sz * 0.38)
        .attr('display', (d) => (d.m.status === 'wishlist' ? 'none' : null))
      pinSel.select('.hit').attr('r', Math.max(sz * 1.4, 9 / k))

      // Greedy label placement in screen space: selected first, then most
      // trips, then shorter names; right side, else left, else hidden. Every
      // pin's own triangle is an obstacle; background labels come last.
      const boxes: number[][] = []
      const inView = (sx: number, sy: number) => sx > -20 && sx < VW + 20 && sy > -20 && sy < VH + 20
      for (const d of pins) {
        const [sx, sy] = t.apply([d.x, d.y]); const q = sz * k * 1.15
        if (inView(sx, sy)) boxes.push([sx - q, sy - q, sx + q, sy + q * 0.75])
      }
      const hit = (b: number[]) =>
        b[0] < 4 || b[2] > VW - 4 || b[1] < 4 || b[3] > VH - 4 ||
        boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))
      const side = new Map<string, 1 | -1>()
      const place = (d: Pt, chars: number, fsS: number, off: number) => {
        const [sx, sy] = t.apply([d.x, d.y])
        if (!inView(sx, sy)) return
        const w = chars * fsS * 0.56, h = fsS * 1.2
        const R = [sx + off, sy - h * 0.6, sx + off + w, sy + h * 0.4]
        const L = [sx - off - w, sy - h * 0.6, sx - off, sy + h * 0.4]
        if (!hit(R)) { boxes.push(R); side.set(d.key, 1) }
        else if (!hit(L)) { boxes.push(L); side.set(d.key, -1) }
      }
      const order = pins.slice().sort((a, b) =>
        Number(isSel(b)) - Number(isSel(a)) || tripCount(b.m) - tripCount(a.m) || a.name.length - b.name.length)
      for (const d of order) { const n = tripCount(d.m); place(d, d.name.length + (n > 1 ? 3 : 0), fsScreen, sz * 1.35 * k) }

      pinSel.select<SVGTextElement>('.lbl')
        .attr('x', (d) => sz * 1.35 * (side.get(d.key) ?? 1))
        .attr('text-anchor', (d) => (side.get(d.key) === -1 ? 'end' : 'start'))
        .attr('y', sz * 0.45).attr('font-size', fs)
        .style('stroke-width', `${(3 / k) * Math.pow(k, 0.2)}px`)
        .attr('display', (d) => (side.has(d.key) ? null : 'none'))
        .each(function (d) {
          // Built as DOM, not HTML: names come from OpenStreetMap.
          const el = select(this); const n = tripCount(d.m)
          const sig = `${d.name}|${n}`
          if (el.attr('data-sig') === sig) return
          el.attr('data-sig', sig).text(d.name)
          if (n > 1) el.append('tspan').attr('class', 'x').text(` ${n}×`)
        })

      const showBgLabels = k >= LABEL_ZOOM_AREAS
      if (showBgLabels) {
        const bfs = fsScreen * 0.82
        const bgOrder = bg.slice().sort((a, b) => Number(isSel(b)) - Number(isSel(a)) || a.name.length - b.name.length)
        for (const d of bgOrder) place(d, d.name.length, bfs, bsz * 1.5 * k)
      }
      bgSel.select<SVGTextElement>('.lbl-bg')
        .attr('x', (d) => bsz * 1.5 * (side.get(d.key) ?? 1))
        .attr('text-anchor', (d) => (side.get(d.key) === -1 ? 'end' : 'start'))
        .attr('y', bsz * 0.5).attr('font-size', fs * 0.82)
        .style('stroke-width', `${(2.5 / k) * Math.pow(k, 0.2)}px`)
        .attr('display', (d) => (showBgLabels && side.has(d.key) ? null : 'none'))
        .text((d) => d.name)
    }

    const zoom: ZoomBehavior<SVGSVGElement, unknown> = d3zoom<SVGSVGElement, unknown>().scaleExtent([1, 40])
      .on('zoom', (e) => {
        k = e.transform.k
        g.attr('transform', e.transform.toString())
        if (titleRef.current) titleRef.current.style.opacity = k > 1.6 ? '0' : '1'
        draw()
      })
    svg.call(zoom).on('dblclick.zoom', null)
    svg.on('click', () => { if (props.current.selected) props.current.onSelect(null, false) })

    function flyTo(p: Target) {
      const { mountains, areas } = props.current
      const target = p.kind === 'mine' ? mountains.find((m) => m.id === p.id) : areas.find((a) => a.id === p.id)
      if (!target) return
      const [x, y] = project(target.lon, target.lat)
      const [w, h] = size()
      const kk = Math.max(zoomTransform(svgEl).k, 6)
      const narrow = w < 520
      svg.transition().duration(reduceMotion() ? 0 : 750)
        .call(zoom.transform, zoomIdentity.translate(w * (narrow ? 0.5 : 0.6) - x * kk, h * (narrow ? 0.62 : 0.55) - y * kk).scale(kk))
    }
    api.current = {
      draw,
      flyTo,
      zoomBy: (f) => { svg.transition().duration(reduceMotion() ? 0 : 250).call(zoom.scaleBy, f) },
      home: () => { svg.transition().duration(reduceMotion() ? 0 : 600).call(zoom.transform, zoomIdentity) },
    }

    loadGeo().then((data) => { if (disposed) return; geo = data; fit(); draw() })
    fit(); draw()

    let rt = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(rt)
      rt = window.setTimeout(() => { fit(); svg.call(zoom.transform, zoomIdentity); draw() }, 150)
    })
    ro.observe(wrap)
    return () => { disposed = true; ro.disconnect(); clearTimeout(rt); svg.selectAll('*').remove(); svg.on('.zoom', null).on('click', null) }
  }, [])

  // Redraw on any data or selection change; fly when asked.
  useEffect(() => {
    props.current = { mountains, areas, selected, onSelect }
    api.current?.draw()
  }, [mountains, areas, selected, onSelect])
  useEffect(() => { if (flyNonce && selected) api.current?.flyTo(selected) }, [flyNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mapwrap" ref={wrapRef}>
      <svg id="map" ref={svgRef} role="img" aria-label="Map of North America with a pin on every ski area Jake has skied" />
      <div className="title" ref={titleRef}><h1>SKI AREAS</h1><p>every mountain Jake has skied</p></div>
      <div className="zoom">
        <button aria-label="Zoom in" onClick={() => api.current?.zoomBy(1.8)}>+</button>
        <button aria-label="Zoom out" onClick={() => api.current?.zoomBy(1 / 1.8)}>&minus;</button>
        <button aria-label="Reset view" className="home" onClick={() => { props.current.onSelect(null, false); api.current?.home() }}>&#8962;</button>
      </div>
      {children}
    </div>
  )
}

