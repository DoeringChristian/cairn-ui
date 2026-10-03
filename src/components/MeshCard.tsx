import Scene3DCard, { type Scene3DCardProps } from "./viewer3d/Scene3DCard";
import { MESH_SPEC } from "./viewer3d/specs";

export default function MeshCard(props: Scene3DCardProps) {
  return <Scene3DCard {...props} spec={MESH_SPEC} />;
}
