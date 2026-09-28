/**
 * TEST-ONLY writers for DICOM and NIfTI with known ground truth.
 *
 * Fixtures are generated, never copied from real studies: they contain no
 * patient data, and every expected value in the tests follows from how the
 * bytes were written here.
 */

export type Tag = [number, number];
export type DicomElement =
  | { tag: Tag; vr: string; value: string }
  | { tag: Tag; vr: "US" | "SS" | "UL" | "FL" | "FD"; value: number[] }
  | { tag: Tag; vr: "OB" | "OW"; value: Uint8Array }
  | { tag: Tag; vr: "SQ"; items: DicomElement[][] };

export type Syntax = "implicit-le" | "explicit-le" | "explicit-be";

const LONG_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN", "UC", "UR", "OD", "OL", "OV"]);

class Writer {
  bytes: number[] = [];
  constructor(private little: boolean) {}
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  u16(v: number) {
    if (this.little) this.bytes.push(v & 0xff, (v >> 8) & 0xff);
    else this.bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  u32(v: number) {
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    this.bytes.push(...(this.little ? b : b.reverse()));
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]!);
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i));
  }
}

function valueBytes(el: DicomElement, little: boolean): number[] {
  if ("items" in el) return [];
  if (el.vr === "OB" || el.vr === "OW") {
    const out = Array.from(el.value as Uint8Array);
    if (out.length % 2) out.push(0);
    return out;
  }
  if (typeof el.value === "string") {
    const out = Array.from(el.value, (c) => c.charCodeAt(0));
    if (out.length % 2) out.push(el.vr === "UI" ? 0 : 0x20);
    return out;
  }
  const w = new Writer(little);
  for (const v of el.value as number[]) {
    if (el.vr === "US") w.u16(v);
    else if (el.vr === "SS") w.u16(v & 0xffff);
    else if (el.vr === "UL") w.u32(v);
    else {
      const size = el.vr === "FL" ? 4 : 8;
      const dv = new DataView(new ArrayBuffer(size));
      if (size === 4) dv.setFloat32(0, v, little);
      else dv.setFloat64(0, v, little);
      for (let i = 0; i < size; i++) w.u8(dv.getUint8(i));
    }
  }
  return w.bytes;
}

function writeElement(w: Writer, el: DicomElement, syntax: Syntax) {
  const little = syntax !== "explicit-be";
  w.u16(el.tag[0]);
  w.u16(el.tag[1]);
  if ("items" in el) {
    if (syntax !== "implicit-le") {
      w.ascii("SQ");
      w.u16(0);
    }
    w.u32(0xffffffff);
    for (const item of el.items) {
      w.u16(0xfffe);
      w.u16(0xe000);
      w.u32(0xffffffff);
      for (const child of item) writeElement(w, child, syntax);
      w.u16(0xfffe);
      w.u16(0xe00d);
      w.u32(0);
    }
    w.u16(0xfffe);
    w.u16(0xe0dd);
    w.u32(0);
    return;
  }
  const v = valueBytes(el, little);
  if (syntax === "implicit-le") {
    w.u32(v.length);
  } else {
    w.ascii(el.vr);
    if (LONG_VR.has(el.vr)) {
      w.u16(0);
      w.u32(v.length);
    } else {
      w.u16(v.length);
    }
  }
  w.raw(v);
}

const TS_UID: Record<Syntax, string> = {
  "implicit-le": "1.2.840.10008.1.2",
  "explicit-le": "1.2.840.10008.1.2.1",
  "explicit-be": "1.2.840.10008.1.2.2",
};

/** A Part 10 file: preamble, meta group (always explicit LE), then the dataset. */
export function writeDicom(
  elements: DicomElement[],
  opts: { syntax?: Syntax; transferSyntaxUid?: string; encapsulatedFrames?: Uint8Array[] } = {},
): ArrayBuffer {
  const syntax = opts.syntax ?? "explicit-le";
  const tsUid = opts.transferSyntaxUid ?? TS_UID[syntax];
  const meta = new Writer(true);
  const metaEls: DicomElement[] = [
    { tag: [0x0002, 0x0001], vr: "OB", value: new Uint8Array([0, 1]) },
    { tag: [0x0002, 0x0002], vr: "UI", value: "1.2.840.10008.5.1.4.1.1.4" },
    { tag: [0x0002, 0x0003], vr: "UI", value: "1.2.3.4.5" },
    { tag: [0x0002, 0x0010], vr: "UI", value: tsUid },
  ];
  const body = new Writer(true);
  for (const el of metaEls) writeElement(body, el, "explicit-le");
  writeElement(
    meta,
    { tag: [0x0002, 0x0000], vr: "UL", value: [body.bytes.length] },
    "explicit-le",
  );
  meta.raw(body.bytes);

  const ds = new Writer(syntax !== "explicit-be");
  const sorted = [...elements].sort((a, b) => a.tag[0] - b.tag[0] || a.tag[1] - b.tag[1]);
  for (const el of sorted) writeElement(ds, el, syntax);
  if (opts.encapsulatedFrames) {
    // Encapsulated pixel data: undefined length, empty basic offset table,
    // one fragment per frame, sequence delimiter. Always little endian.
    ds.u16(0x7fe0);
    ds.u16(0x0010);
    ds.ascii("OB");
    ds.u16(0);
    ds.u32(0xffffffff);
    ds.u16(0xfffe);
    ds.u16(0xe000);
    ds.u32(0);
    for (const f of opts.encapsulatedFrames) {
      const data = Array.from(f);
      if (data.length % 2) data.push(0);
      ds.u16(0xfffe);
      ds.u16(0xe000);
      ds.u32(data.length);
      ds.raw(data);
    }
    ds.u16(0xfffe);
    ds.u16(0xe0dd);
    ds.u32(0);
  }

  const out = new Uint8Array(128 + 4 + meta.bytes.length + ds.bytes.length);
  out.set([0x44, 0x49, 0x43, 0x4d], 128);
  out.set(meta.bytes, 132);
  out.set(ds.bytes, 132 + meta.bytes.length);
  return out.buffer;
}

/** Pack 16-bit samples into OW bytes in the given byte order. */
export function samples16(values: number[], little = true): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => dv.setUint16(i * 2, v & 0xffff, little));
  return out;
}

/**
 * RLE Lossless encoder for tests (PS3.5 Annex G). Uses both literal and
 * replicate runs so the decoder's two branches are exercised.
 */
export function encodeRle(values: number[], bytesPer: 1 | 2): Uint8Array {
  const planes: number[][] = [];
  for (let s = 0; s < bytesPer; s++) {
    const shift = (bytesPer - 1 - s) * 8;
    planes.push(values.map((v) => (v >> shift) & 0xff));
  }
  const segments = planes.map((plane) => {
    const out: number[] = [];
    let i = 0;
    while (i < plane.length) {
      let run = 1;
      while (i + run < plane.length && plane[i + run] === plane[i] && run < 128) run++;
      if (run >= 3) {
        out.push((1 - run) & 0xff, plane[i]!);
        i += run;
      } else {
        const start = i;
        while (i < plane.length && i - start < 128) {
          let r = 1;
          while (i + r < plane.length && plane[i + r] === plane[i] && r < 3) r++;
          if (r >= 3) break;
          i++;
        }
        out.push(i - start - 1, ...plane.slice(start, i));
      }
    }
    if (out.length % 2) out.push(0x80); // -128 is a no-op, used as padding
    return out;
  });
  const header = new Uint8Array(64);
  const dv = new DataView(header.buffer);
  dv.setUint32(0, segments.length, true);
  let offset = 64;
  segments.forEach((seg, s) => {
    dv.setUint32(4 + s * 4, offset, true);
    offset += seg.length;
  });
  const out = new Uint8Array(offset);
  out.set(header);
  let p = 64;
  for (const seg of segments) {
    out.set(seg, p);
    p += seg.length;
  }
  return out;
}

/** Common tags for a grayscale MR/CT slice. */
export function sliceElements(o: {
  rows: number;
  columns: number;
  ipp: [number, number, number] | null;
  iop?: number[] | null;
  spacing?: [number, number] | null;
  modality?: string;
  bits?: { allocated: number; stored: number; signed: boolean };
  photometric?: string;
  series?: string;
  instance?: string;
  extra?: DicomElement[];
}): DicomElement[] {
  const bits = o.bits ?? { allocated: 16, stored: 16, signed: false };
  const els: DicomElement[] = [
    {
      tag: [0x0008, 0x0018],
      vr: "UI",
      value: o.instance ?? `1.2.3.${Math.floor(Math.random() * 1e9)}`,
    },
    { tag: [0x0008, 0x0060], vr: "CS", value: o.modality ?? "MR" },
    { tag: [0x0020, 0x000e], vr: "UI", value: o.series ?? "1.2.3.100" },
    { tag: [0x0028, 0x0002], vr: "US", value: [1] },
    { tag: [0x0028, 0x0004], vr: "CS", value: o.photometric ?? "MONOCHROME2" },
    { tag: [0x0028, 0x0010], vr: "US", value: [o.rows] },
    { tag: [0x0028, 0x0011], vr: "US", value: [o.columns] },
    { tag: [0x0028, 0x0100], vr: "US", value: [bits.allocated] },
    { tag: [0x0028, 0x0101], vr: "US", value: [bits.stored] },
    { tag: [0x0028, 0x0102], vr: "US", value: [bits.stored - 1] },
    { tag: [0x0028, 0x0103], vr: "US", value: [bits.signed ? 1 : 0] },
  ];
  if (o.ipp) els.push({ tag: [0x0020, 0x0032], vr: "DS", value: o.ipp.join("\\") });
  const iop = o.iop === undefined ? [1, 0, 0, 0, 1, 0] : o.iop;
  if (iop) els.push({ tag: [0x0020, 0x0037], vr: "DS", value: iop.join("\\") });
  const spacing = o.spacing === undefined ? [1, 1] : o.spacing;
  if (spacing) els.push({ tag: [0x0028, 0x0030], vr: "DS", value: spacing.join("\\") });
  return [...els, ...(o.extra ?? [])];
}

/* ------------------------------------------------------------------ NIfTI */

/**
 * A NIfTI-1 (.nii) buffer with an sform. `srow` is the RAS affine's top three
 * rows, row-major. Data is int16 unless `datatype` says otherwise.
 */
export function writeNifti(o: {
  dims: [number, number, number];
  values: number[];
  srow?: number[];
  qform?: { b: number; c: number; d: number; offset: [number, number, number]; qfac: number };
  pixdim?: [number, number, number];
  slope?: number;
  intercept?: number;
  datatype?: 2 | 4 | 16;
}): ArrayBuffer {
  const bytesPer = o.datatype === 2 ? 1 : o.datatype === 16 ? 4 : 2;
  const n = o.dims[0] * o.dims[1] * o.dims[2];
  const buf = new ArrayBuffer(352 + n * bytesPer);
  const dv = new DataView(buf);
  dv.setInt32(0, 348, true);
  dv.setInt16(40, 3, true);
  dv.setInt16(42, o.dims[0], true);
  dv.setInt16(44, o.dims[1], true);
  dv.setInt16(46, o.dims[2], true);
  dv.setInt16(48, 1, true);
  const datatype = o.datatype ?? 4;
  dv.setInt16(70, datatype, true);
  dv.setInt16(72, bytesPer * 8, true);
  const pd = o.pixdim ?? [1, 1, 1];
  dv.setFloat32(76, o.qform?.qfac ?? 1, true);
  dv.setFloat32(80, pd[0], true);
  dv.setFloat32(84, pd[1], true);
  dv.setFloat32(88, pd[2], true);
  dv.setFloat32(108, 352, true);
  dv.setFloat32(112, o.slope ?? 1, true);
  dv.setFloat32(116, o.intercept ?? 0, true);
  dv.setUint8(123, 2); // mm
  if (o.srow) {
    dv.setInt16(254, 1, true);
    o.srow.forEach((v, i) => dv.setFloat32(280 + i * 4, v, true));
  }
  if (o.qform) {
    dv.setInt16(252, 1, true);
    dv.setFloat32(256, o.qform.b, true);
    dv.setFloat32(260, o.qform.c, true);
    dv.setFloat32(264, o.qform.d, true);
    dv.setFloat32(268, o.qform.offset[0], true);
    dv.setFloat32(272, o.qform.offset[1], true);
    dv.setFloat32(276, o.qform.offset[2], true);
  }
  dv.setUint8(344, 0x6e);
  dv.setUint8(345, 0x2b);
  dv.setUint8(346, 0x31);
  for (let i = 0; i < n; i++) {
    if (datatype === 2) dv.setUint8(352 + i, o.values[i]!);
    else if (datatype === 16) dv.setFloat32(352 + i * 4, o.values[i]!, true);
    else dv.setInt16(352 + i * 2, o.values[i]!, true);
  }
  return buf;
}
