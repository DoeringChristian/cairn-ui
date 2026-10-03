/** The point cloud / mesh / boxes kinds of the 3D viewer: how each builds, captions and is configured. */

import type { Scene3DKind } from "../viewers/Scene3DViewer";
import { Select, Slider, Switch } from "../settings/palette";
import { boxesCaption, boxesColorOptions, buildBoxes, type Boxes3DMeta, type BoxesView } from "./boxes3d";
import { buildMesh, meshCaption, meshColorOptions, type MeshMeta, type MeshView } from "./mesh";
import {
  buildPointCloud,
  pointCloudCaption,
  pointColorOptions,
  type PointCloudMeta,
  type PointCloudView,
} from "./pointcloud";

export const POINTCLOUD_SPEC: Scene3DKind<PointCloudView, PointCloudMeta> = {
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

export const MESH_SPEC: Scene3DKind<MeshView, MeshMeta> = {
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
      <Switch label="Wireframe" value={view.wireframe} onChange={(wireframe) => setView({ wireframe })} />
    </>
  ),
};

export const BOXES3D_SPEC: Scene3DKind<BoxesView, Boxes3DMeta> = {
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

export const SCENE_SPECS = { pointcloud: POINTCLOUD_SPEC, mesh: MESH_SPEC, boxes3d: BOXES3D_SPEC } as const;
