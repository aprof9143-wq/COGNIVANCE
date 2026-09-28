/**
 * fusion  — raymarched MRI with every layer.
 * fibres  — opaque MRI slice planes cutting through the tractogram, the way
 *           diffusion tractography is conventionally shown.
 * tumour  — glass brain with the segmentation drawn as a particle field.
 */
export type Scene = "fusion" | "fibres" | "tumour";

/**
 * Streamlines drawn per scene. The fibre scene shows the whole tractogram;
 * elsewhere it shares the frame with the volume, electrodes and lesion, and a
 * tenth of it keeps the anatomy readable.
 */
export const tractStride = (scene: Scene) => (scene === "fibres" ? 1 : 10);
