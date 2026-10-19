/**
 * Plain-language content for the eye simulation: what each part is, the story
 * of how seeing works, and where RPE65 fits. Written for people without a
 * science background; the technical line under each part is for those who
 * want it.
 *
 * Everything here is established textbook or published knowledge (evidence
 * kind "reference") except where a line says it describes this model.
 */

/** Light from the top and bottom of the object, in the 3D eye and its legend. */
export const RAY_COLOURS = { top: "#ff9f1c", bottom: "#2bb3e6" };

export type PartKey =
  | "cornea"
  | "iris"
  | "lens"
  | "ciliary"
  | "aqueous"
  | "vitreous"
  | "retina"
  | "macula"
  | "rpe"
  | "choroid"
  | "sclera"
  | "disc"
  | "nerve";

export type Part = {
  key: PartKey;
  name: string;
  /** Three to six words, for the label in the 3D view. */
  tag: string;
  what: string;
  technical: string;
  rpe65?: string;
};

export const PARTS: Part[] = [
  {
    key: "cornea",
    name: "Cornea",
    tag: "Clear front window",
    what: "The clear dome at the front of the eye. Light enters here, and its curve does most of the focusing.",
    technical:
      "Front radius 7.8 mm, back 6.5 mm, refractive index 1.3771 in this model. About 42 D of the eye's ~60 D.",
  },
  {
    key: "iris",
    name: "Iris and pupil",
    tag: "Coloured ring · adjustable opening",
    what: "The coloured ring is a muscle. It widens or narrows the black opening in its centre, the pupil, to let in more or less light.",
    technical:
      "The pupil is the aperture stop. Typical diameter 2 mm in bright light to 8 mm in the dark. Here it sits at the front of the lens.",
  },
  {
    key: "lens",
    name: "Lens",
    tag: "Fine-focus lens",
    what: "A flexible lens behind the pupil. It changes shape to focus on things near or far.",
    technical:
      "Changing shape is accommodation. In this model the lens goes from 10.2/−6.0 mm radii (relaxed) to 6.0/−5.5 mm (focused near), adding about 7.7 D.",
  },
  {
    key: "ciliary",
    name: "Ciliary muscle",
    tag: "Focusing muscle",
    what: "A ring of muscle around the lens, holding it by fine fibres. When it tightens, the lens rounds up to focus close.",
    technical: "Drawn approximately; it is not part of the optical calculation.",
  },
  {
    key: "aqueous",
    name: "Aqueous humour",
    tag: "Clear fluid in front",
    what: "Watery fluid between the cornea and the lens. It nourishes the front of the eye and keeps its shape.",
    technical: "Refractive index 1.3374 in this model.",
  },
  {
    key: "vitreous",
    name: "Vitreous",
    tag: "Clear gel filling the eye",
    what: "A clear gel that fills the large space behind the lens. Light passes straight through it to the retina.",
    technical: "Refractive index 1.336 in this model.",
  },
  {
    key: "retina",
    name: "Retina",
    tag: "Light-sensing layer",
    what: "A thin layer lining the back of the eye, like the sensor in a camera. Its rods and cones turn light into electrical signals.",
    technical:
      "Roughly 92 million rods (dim light) and 4.6 million cones (colour, detail) (Curcio et al. 1990). Drawn as a 12 mm-radius sphere, an assumption of this model.",
    rpe65:
      "Rods and cones need a fresh supply of a light-catching molecule, 11-cis-retinal. Without it they cannot respond to light.",
  },
  {
    key: "macula",
    name: "Macula and fovea",
    tag: "Sharpest vision",
    what: "A small spot at the centre of the retina packed with cones. It gives the sharp, detailed vision used for reading and faces.",
    technical:
      "The fovea lies about 5° from the optical axis in a real eye; this symmetric model places it approximately.",
  },
  {
    key: "rpe",
    name: "Retinal pigment epithelium (RPE)",
    tag: "Support layer · where RPE65 works",
    what: "A single layer of dark cells just behind the retina. It looks after the rods and cones and recycles the molecule they use to catch light.",
    technical:
      "One cell thick (about 10–14 µm); drawn much thicker here so it can be seen. RPE65 is an enzyme made in these cells.",
    rpe65:
      "RPE65 does the key recycling step. When both copies of the RPE65 gene are faulty, recycling stops: this is RPE65-associated retinal dystrophy.",
  },
  {
    key: "choroid",
    name: "Choroid",
    tag: "Blood supply",
    what: "A layer of blood vessels behind the RPE. It brings oxygen and nutrients to the outer retina.",
    technical: "Drawn approximately.",
  },
  {
    key: "sclera",
    name: "Sclera",
    tag: "Tough white outer wall",
    what: "The white of the eye: a tough outer wall that protects the eye and gives it its shape.",
    technical: "Drawn approximately, about 1 mm thick.",
  },
  {
    key: "disc",
    name: "Optic disc",
    tag: "Blind spot",
    what: "Where the nerve fibres leave the eye. There are no rods or cones here, so it is the blind spot.",
    technical: "About 15° to the nose side of the fovea; placed approximately.",
  },
  {
    key: "nerve",
    name: "Optic nerve",
    tag: "Cable to the brain",
    what: "A cable of about a million nerve fibres carrying the retina's signals to the brain, which builds what we see.",
    technical: "Drawn approximately.",
  },
];

export const partByKey = (k: PartKey) => PARTS.find((p) => p.key === k)!;

export type Step = { n: number; title: string; text: string; parts: PartKey[] };

export const STEPS: Step[] = [
  {
    n: 1,
    title: "Light comes in",
    text: "Light from what you look at reaches the cornea, the clear front window. Its curve bends the light and does most of the focusing.",
    parts: ["cornea"],
  },
  {
    n: 2,
    title: "The iris sets the opening",
    text: "The coloured iris widens or narrows the pupil. A small pupil lets in less light but gives a sharper image.",
    parts: ["iris"],
  },
  {
    n: 3,
    title: "The lens fine-tunes focus",
    text: "The lens changes shape so near and far things both land sharply on the retina. Try moving the object closer.",
    parts: ["lens", "ciliary"],
  },
  {
    n: 4,
    title: "An upside-down image forms",
    text: "The light crosses over inside the eye, so the image on the retina is upside down. The brain turns it the right way up.",
    parts: ["retina", "vitreous"],
  },
  {
    n: 5,
    title: "Rods and cones catch the light",
    text: "In the retina, rods and cones each hold a light-catching molecule. When light hits it, it changes shape and the cell sends a signal.",
    parts: ["retina", "macula"],
  },
  {
    n: 6,
    title: "The RPE recycles: RPE65's job",
    text: "After catching light, the molecule is used up. The RPE layer behind the retina resets it so it can catch light again. RPE65 does the key step.",
    parts: ["rpe"],
  },
  {
    n: 7,
    title: "The signal goes to the brain",
    text: "Signals leave through the optic disc and travel along the optic nerve to the brain, which turns them into what we see.",
    parts: ["disc", "nerve"],
  },
];

export type CycleMode = "healthy" | "missing" | "therapy";

export const CYCLE_STATIONS = [
  {
    key: "catch",
    where: "Rod or cone",
    label: "Catches light",
    detail:
      "11-cis-retinal sits in rhodopsin. Light flips it to all-trans-retinal and the cell signals.",
  },
  {
    key: "travel",
    where: "Rod or cone → RPE",
    label: "Used molecule leaves",
    detail: "The used molecule (as all-trans-retinol) moves into the RPE cell.",
  },
  {
    key: "store",
    where: "RPE cell",
    label: "Stored",
    detail: "LRAT turns it into a retinyl ester, the form RPE65 works on.",
  },
  {
    key: "rpe65",
    where: "RPE cell",
    label: "RPE65 resets it",
    detail: "RPE65 turns the ester into 11-cis-retinol: the reset.",
  },
  {
    key: "return",
    where: "RPE → rod or cone",
    label: "Ready again",
    detail: "RDH5 makes 11-cis-retinal, which goes back to the rods and cones.",
  },
] as const;

export const CYCLE_TEXT: Record<
  CycleMode,
  { title: string; text: string; kind: "reference" | "hypothetical" }
> = {
  healthy: {
    title: "Healthy eye",
    text: "The light-catching molecule goes round this loop continuously, so rods and cones keep working.",
    kind: "reference",
  },
  missing: {
    title: "RPE65 not working",
    text: "The loop stops at the reset step and the stored form builds up in the RPE. Rods and cones run out of the light-catching molecule. People notice poor night vision first; over years, rods and cones are lost.",
    kind: "reference",
  },
  therapy: {
    title: "Gene therapy: how it is meant to work",
    text: "Voretigene neparvovec (Luxturna) is injected under the retina. A harmless virus shell (AAV2) carries a working copy of the RPE65 gene into RPE cells, which can then make RPE65 again. It requires enough living retinal cells to work.",
    kind: "reference",
  },
};

export type Citation = { id: string; text: string };

export const CITATIONS: Citation[] = [
  {
    id: "legrand",
    text: "Le Grand Y, El Hage SG. Physiological Optics. Springer; 1980. (Full theoretical eye.)",
  },
  {
    id: "atchison",
    text: "Atchison DA, Smith G. Optics of the Human Eye. Butterworth-Heinemann; 2000.",
  },
  {
    id: "curcio",
    text: "Curcio CA, Sloan KR, Kalina RE, Hendrickson AE. Human photoreceptor topography. J Comp Neurol. 1990;292:497–523.",
  },
  {
    id: "redmond",
    text: "Redmond TM, et al. Rpe65 is necessary for production of 11-cis-vitamin A in the retinal visual cycle. Nat Genet. 1998;20:344–351.",
  },
  {
    id: "moiseyev",
    text: "Moiseyev G, Chen Y, Takahashi Y, Wu BX, Ma JX. RPE65 is the isomerohydrolase in the retinoid visual cycle. PNAS. 2005;102:12413–12418.",
  },
  {
    id: "russell",
    text: "Russell S, et al. Efficacy and safety of voretigene neparvovec (AAV2-hRPE65v2) in patients with RPE65-mediated inherited retinal dystrophy: a randomised, controlled, open-label, phase 3 trial. Lancet. 2017;390:849–860.",
  },
  {
    id: "fda",
    text: "US FDA. FDA approves novel gene therapy to treat patients with a rare form of inherited vision loss. News release, 19 December 2017.",
  },
];

/** Shown with the reference list. */
export const CITATION_NOTE =
  "Entered from the developers' knowledge and not yet checked against the publications in this build. Verify before relying on them.";
