import Scene3DCard, { type Scene3DCardProps, type Scene3DKind } from "./viewer3d/Scene3DCard";
import {
  buildPointCloud,
  pointCloudCaption,
  pointColorOptions,
  type PointCloudMeta,
  type PointCloudView,
} from "./viewer3d/pointcloud";
import Select from "./settings/Select";
import Slider from "./settings/Slider";

const SPEC: Scene3DKind<PointCloudView, PointCloudMeta> = {
  kind: "pointcloud",
  noun: "point cloud",
  defaultView: { pointSize: 2, colorBy: "auto" },
  build: buildPointCloud,
  caption: pointCloudCaption,
  viewSettings: ({ view, setView, meta, properties }) => (
    <>
      <Slider
        label="Point size"
        value={view.pointSize}
        onChange={(pointSize) => setView({ pointSize })}
        min={1}
        max={10}
        step={0.5}
        format={(v) => `${v}px`}
      />
      <Select
        label="Color by"
        value={view.colorBy}
        onChange={(colorBy) => setView({ colorBy })}
        options={pointColorOptions(meta, properties)}
      />
    </>
  ),
};

export default function PointCloudCard(props: Scene3DCardProps) {
  return <Scene3DCard {...props} spec={SPEC} />;
}
