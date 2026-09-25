import Scene3DCard, { type Scene3DCardProps, type Scene3DKind } from "./viewer3d/Scene3DCard";
import { boxesCaption, boxesColorOptions, buildBoxes, type Boxes3DMeta, type BoxesView } from "./viewer3d/boxes3d";
import { Select } from "./settings/palette";

const SPEC: Scene3DKind<BoxesView, Boxes3DMeta> = {
  kind: "boxes3d",
  noun: "boxes",
  defaultView: { colorBy: "depth" },
  build: buildBoxes,
  caption: boxesCaption,
  viewSettings: ({ view, setView, properties }) => (
    <Select
      label="Color by"
      value={view.colorBy}
      onChange={(colorBy) => setView({ colorBy })}
      options={boxesColorOptions(properties)}
    />
  ),
};

export default function Boxes3DCard(props: Scene3DCardProps) {
  return <Scene3DCard {...props} spec={SPEC} />;
}
