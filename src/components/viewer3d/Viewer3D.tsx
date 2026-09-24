import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { readChartTheme } from "../../charts/theme";
import { CameraLink, copyCamera, type LinkedView } from "./camera-link";

interface Props {
  /** Scene content. The caller owns (and disposes) these objects; the viewer only adds/removes them. */
  objects: THREE.Object3D[];
  /** Panes of one card that should share a camera. */
  link?: CameraLink | null;
  /** Bump to re-frame the camera on the current content. */
  resetKey?: number;
  className?: string;
}

interface ViewerState extends LinkedView {
  renderer: THREE.WebGLRenderer;
  content: THREE.Group;
  fit: () => void;
  isFitted: boolean;
}

const FIT_DIRECTION = new THREE.Vector3(1, 0.8, 1.2).normalize();

/**
 * One three.js viewport: renderer, perspective camera, orbit controls, headlight.
 * Renders on demand (control changes, resizes, content changes), sizes itself to
 * its box via ResizeObserver, frames the camera on the first non-empty content,
 * and releases the GL context on unmount.
 */
export default function Viewer3D({ objects, link, resetKey = 0, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewerState | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.copy(FIT_DIRECTION).multiplyScalar(3);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const headlight = new THREE.DirectionalLight(0xffffff, 1.6);
    headlight.position.set(0.5, 1, 1);
    camera.add(headlight);
    const content = new THREE.Group();
    scene.add(content);

    const controls = new OrbitControls(camera, renderer.domElement);

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
      });
    };

    const fit = () => {
      const box = new THREE.Box3().setFromObject(content);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = sphere.radius > 0 ? sphere.radius : 1;
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const dist = (radius / Math.sin(Math.min(fov, fov * camera.aspect) / 2)) * 0.9;
      camera.near = dist / 1000;
      camera.far = dist + radius * 20;
      camera.updateProjectionMatrix();
      camera.position.copy(sphere.center).addScaledVector(FIT_DIRECTION, dist);
      controls.target.copy(sphere.center);
      controls.update();
      state.isFitted = true;
      render();
    };

    const state: ViewerState = {
      renderer, camera, controls, content, render, fit,
      isFitted: false,
      fitted: () => state.isFitted,
    };
    stateRef.current = state;

    const applyTheme = () => {
      scene.background = new THREE.Color(readChartTheme(host).bg);
      render();
    };
    applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    });
    ro.observe(host);

    controls.addEventListener("change", render);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      media.removeEventListener("change", applyTheme);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, []);

  // Camera link: publish user changes, follow peers.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !link) return;
    const leave = link.join(state);
    const onChange = () => link.publish(state);
    state.controls.addEventListener("change", onChange);
    return () => {
      state.controls.removeEventListener("change", onChange);
      leave();
    };
  }, [link]);

  // Content: swap objects in, frame once on the first non-empty content.
  useEffect(() => {
    const state = stateRef.current;
    if (!state || objects.length === 0) return;
    state.content.add(...objects);
    if (!state.isFitted) {
      const leader = link?.leader(state);
      if (leader) {
        copyCamera(leader, state);
        state.isFitted = true;
      } else {
        state.fit();
      }
    }
    state.render();
    return () => {
      state.content.remove(...objects);
    };
  }, [objects, link]);

  useEffect(() => {
    if (resetKey > 0) stateRef.current?.fit();
  }, [resetKey]);

  return <div ref={hostRef} className={className ?? "h-full w-full"} />;
}
