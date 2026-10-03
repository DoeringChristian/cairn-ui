import Scene3DCard, { type Scene3DCardProps } from "./viewer3d/Scene3DCard";
import { BOXES3D_SPEC } from "./viewer3d/specs";

export default function Boxes3DCard(props: Scene3DCardProps) {
  return <Scene3DCard {...props} spec={BOXES3D_SPEC} />;
}
