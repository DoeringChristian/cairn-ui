import Scene3DCard, { type Scene3DCardProps, type Scene3DKind } from "./viewer3d/Scene3DCard";
import { buildMesh, meshCaption, meshColorOptions, type MeshMeta, type MeshView } from "./viewer3d/mesh";
import Select from "./settings/Select";
import Toggle from "./settings/Toggle";

const SPEC: Scene3DKind<MeshView, MeshMeta> = {
  kind: "mesh",
  noun: "mesh",
  defaultView: { colorBy: "auto", wireframe: false },
  build: buildMesh,
  caption: meshCaption,
  viewSettings: ({ view, setView, meta, properties }) => (
    <>
      <Select
        label="Color by"
        value={view.colorBy}
        onChange={(colorBy) => setView({ colorBy })}
        options={meshColorOptions(meta, properties)}
      />
      <Toggle label="Wireframe" checked={view.wireframe} onChange={(wireframe) => setView({ wireframe })} />
    </>
  ),
};

export default function MeshCard(props: Scene3DCardProps) {
  return <Scene3DCard {...props} spec={SPEC} />;
}
