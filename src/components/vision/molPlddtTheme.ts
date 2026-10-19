/**
 * A Mol* colour theme for AlphaFold models read from PDB files: the B-factor
 * column holds pLDDT, coloured in AlphaFold DB's own four bands.
 *
 * Imported only dynamically, from MolViewer, so Mol* stays out of the server
 * bundle and out of every page but the one that shows a structure.
 */
import { Bond, StructureElement, Unit } from "molstar/lib/mol-model/structure";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import type { ThemeDataContext } from "molstar/lib/mol-theme/theme";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import { Color } from "molstar/lib/mol-util/color";
import type { Location } from "molstar/lib/mol-model/location";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { PLDDT_BANDS, plddtBand } from "@/lib/vision/pdb";

export const PLDDT_THEME = "cognivance-plddt";

const BAND = Object.fromEntries(
  PLDDT_BANDS.map((b) => [b.band, Color.fromHexStyle(b.colour)]),
) as Record<(typeof PLDDT_BANDS)[number]["band"], Color>;
const NO_VALUE = Color(0xb9b6c6);

function bFactor(unit: Unit, element: number): number {
  return Unit.isAtomic(unit)
    ? unit.model.atomicConformation.B_iso_or_equiv.value(element as never)
    : NaN;
}

const Params = {};
type Params = typeof Params;

function PlddtBandsTheme(_ctx: ThemeDataContext, props: PD.Values<Params>): ColorTheme<Params> {
  const color = (location: Location): Color => {
    let b = NaN;
    if (StructureElement.Location.is(location)) b = bFactor(location.unit, location.element);
    else if (Bond.isLocation(location))
      b = bFactor(location.aUnit, location.aUnit.elements[location.aIndex]!);
    return Number.isFinite(b) ? BAND[plddtBand(b)] : NO_VALUE;
  };
  return {
    factory: PlddtBandsTheme,
    granularity: "group",
    preferSmoothing: false,
    color,
    props,
    description: "AlphaFold per-residue confidence (pLDDT), in AlphaFold DB's four bands.",
  };
}

export const PlddtBandsThemeProvider: ColorTheme.Provider<Params, typeof PLDDT_THEME> = {
  name: PLDDT_THEME,
  label: "pLDDT (AlphaFold bands)",
  category: ColorThemeCategory.Validation,
  factory: PlddtBandsTheme,
  getParams: () => Params,
  defaultValues: PD.getDefaultValues(Params),
  isApplicable: (ctx: ThemeDataContext) => !!ctx.structure,
};
