import { useEffect, useRef } from "react";
import type { NiftiVolume } from "@/lib/nifti";

export type Plane = "axial" | "coronal" | "sagittal";

/**
 * One orthogonal slice, drawn straight from the normalised volume.
 *
 * Crosshairs mark where the other two planes cut this one, so the three views
 * read as one position in the head rather than three unrelated pictures.
 */
export function SliceView({
  volume,
  plane,
  position,
  crosshair,
  onPick,
}: {
  volume: NiftiVolume;
  plane: Plane;
  /** 0–1 position of this plane through the volume. */
  position: number;
  /** The other two plane positions, 0–1, as [horizontal, vertical]. */
  crosshair: [number, number];
  onPick?: (u: number, v: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [nx, ny, nz] = volume.size;
    // Width/height of this slice in voxels.
    const [w, h] = plane === "axial" ? [nx, ny] : plane === "coronal" ? [nx, nz] : [ny, nz];
    canvas.width = w;
    canvas.height = h;

    const img = ctx.createImageData(w, h);
    const fixed = Math.round(
      position * ((plane === "axial" ? nz : plane === "coronal" ? ny : nx) - 1),
    );

    for (let py = 0; py < h; py++) {
      // Superior / anterior at the top of the image, as radiologists read them.
      const row = h - 1 - py;
      for (let px = 0; px < w; px++) {
        let x: number;
        let y: number;
        let z: number;
        if (plane === "axial") {
          x = px;
          y = row;
          z = fixed;
        } else if (plane === "coronal") {
          x = px;
          y = fixed;
          z = row;
        } else {
          x = fixed;
          y = px;
          z = row;
        }
        const v = volume.data[x + nx * (y + ny * z)]! / 255;
        const o = (py * w + px) * 4;
        // A gentle gamma lifts mid-grey tissue without clipping white matter,
        // and a faint blue tint ties the slices to the rendered volume.
        const g = Math.pow(v, 0.78);
        img.data[o] = Math.round(g * 232);
        img.data[o + 1] = Math.round(g * 244);
        img.data[o + 2] = Math.round(Math.min(255, g * 255 + 14 * v));
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Crosshairs, drawn in voxel space so they stay aligned at any zoom.
    ctx.strokeStyle = "rgba(127,216,255,0.55)";
    ctx.lineWidth = Math.max(1, w / 220);
    ctx.setLineDash([w / 60, w / 90]);
    const cx = crosshair[0] * (w - 1);
    const cy = (1 - crosshair[1]) * (h - 1);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [volume, plane, position, crosshair]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onPick((e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height);
  };

  return (
    <canvas
      ref={ref}
      onClick={handleClick}
      className="h-full w-full cursor-crosshair object-contain [image-rendering:auto]"
      aria-label={`${plane} slice at ${Math.round(position * 100)}%`}
    />
  );
}
