"use client";

import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { COLUMN_GAP } from "@/lib/topology/sizes";

const RADIUS = 10;
/** How far above (or below) the target the line runs before turning into it. It sits in the gap between stacked cards. */
const APPROACH = 16;

type Point = [number, number];

/** A polyline of horizontal and vertical segments with rounded corners. */
function rounded(points: Point[]): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(RADIUS, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    d += ` L ${x + Math.sign(px - x) * r} ${y + Math.sign(py - y) * r} Q ${x} ${y} ${x + Math.sign(nx - x) * r} ${y + Math.sign(ny - y) * r}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

/**
 * A link that goes back to something drawn to its left. It leaves the card's left edge, runs along the gutter
 * between two columns, then along the free space just above (or below) the target and drops into it, so it never
 * passes behind a card and its label sits in empty space.
 */
export function GutterEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius, data }: EdgeProps) {
  const fromBelow = data?.enter === "bottom";
  const gutter = sourceX - COLUMN_GAP / 2;
  const approach = fromBelow ? targetY + APPROACH : targetY - APPROACH;
  const path = rounded([[sourceX, sourceY], [gutter, sourceY], [gutter, approach], [targetX, approach], [targetX, targetY]]);
  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={(gutter + targetX) / 2}
      labelY={approach}
      labelStyle={labelStyle}
      labelShowBg
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  );
}
