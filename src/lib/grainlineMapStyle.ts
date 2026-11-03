// Grainline's colors on the stock OpenFreeMap "liberty" map. Painted over the
// loaded style, so a layer that is missing or renamed upstream is skipped and
// the map still works in its original colors.
const LAND = "#EFEAE0";
const WATER = "#C4D3DA";
const PARK = "#DCE1C9";
const WOOD = "#D3D9BE";
const BUILDING = "#E3DCCB";
const ROAD = "#FBF8F3";
const ROAD_MAJOR = "#F5EFE6";
const ROAD_CASING = "#D9D0BF";
const BOUNDARY = "#B7AB97";
const LABEL = "#4A3F37";
const LABEL_HALO = "#F7F5F0";

export type MapPaintChange = Readonly<{ property: string; value: string }>;

type MapLayerShape = Readonly<{ id: string; type: string }>;

// Which paints a layer gets, from its id and type. Empty means leave it alone.
export function grainlineLayerPaint(layer: MapLayerShape): MapPaintChange[] {
  const { id, type } = layer;
  if (type === "background") return [{ property: "background-color", value: LAND }];
  if (type === "symbol") {
    if (/shield|icon|poi/.test(id)) return [];
    return [
      { property: "text-color", value: LABEL },
      { property: "text-halo-color", value: LABEL_HALO },
    ];
  }
  if (type === "fill") {
    if (/water/.test(id)) return [{ property: "fill-color", value: WATER }];
    if (/wood|forest/.test(id)) return [{ property: "fill-color", value: WOOD }];
    if (/park|grass|landcover|landuse|cemetery|pitch|golf/.test(id)) return [{ property: "fill-color", value: PARK }];
    if (/building/.test(id)) return [{ property: "fill-color", value: BUILDING }];
    return [];
  }
  if (type === "fill-extrusion") {
    return /building/.test(id) ? [{ property: "fill-extrusion-color", value: BUILDING }] : [];
  }
  if (type === "line") {
    if (/waterway|water/.test(id)) return [{ property: "line-color", value: WATER }];
    if (/boundary|admin/.test(id)) return [{ property: "line-color", value: BOUNDARY }];
    if (/rail/.test(id)) return [];
    if (/casing/.test(id)) return [{ property: "line-color", value: ROAD_CASING }];
    if (/motorway|trunk|primary/.test(id)) return [{ property: "line-color", value: ROAD_MAJOR }];
    if (/road|highway|street|bridge|tunnel|path|minor|service|secondary|tertiary/.test(id)) {
      return [{ property: "line-color", value: ROAD }];
    }
  }
  return [];
}

type PaintableMap = {
  getStyle: () => { layers?: readonly MapLayerShape[] } | undefined;
  setPaintProperty: (layerId: string, property: string, value: string) => unknown;
};

// Never throws: colors are decoration, and the map must not fail over them.
export function applyGrainlineMapColors(map: PaintableMap): void {
  let layers: readonly MapLayerShape[] = [];
  try {
    layers = map.getStyle()?.layers ?? [];
  } catch {
    return;
  }
  for (const layer of layers) {
    for (const change of grainlineLayerPaint(layer)) {
      try {
        map.setPaintProperty(layer.id, change.property, change.value);
      } catch {
        // Leave this layer as the style drew it.
      }
    }
  }
}
