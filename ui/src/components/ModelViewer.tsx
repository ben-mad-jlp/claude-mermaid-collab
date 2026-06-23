/**
 * ModelViewer — renders a 3D model artifact (glb/gltf/stl/obj/ply) in an
 * interactive three.js canvas with orbit controls, neutral studio lighting, a
 * ground grid, and an auto-fit camera. Format is picked from the MIME type.
 *
 * Used by ImageViewer for media artifacts whose mimeType starts with "model/".
 */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface ModelViewerProps {
  url: string;
  mimeType: string;
  /** Reset signal — bump to recenter the camera (unused for now; reserved). */
  name?: string;
}

const STD_MATERIAL = () =>
  new THREE.MeshStandardMaterial({ color: 0x9aa6b2, metalness: 0.1, roughness: 0.75, flatShading: false });

/** Load a model as a THREE.Object3D, picking the loader by MIME. Geometry-only
 *  formats (stl/ply) get a neutral standard material; obj/gltf bring their own. */
async function loadModel(url: string, mimeType: string): Promise<THREE.Object3D> {
  if (mimeType === 'model/gltf-binary' || mimeType === 'model/gltf+json') {
    const gltf = await new GLTFLoader().loadAsync(url);
    return gltf.scene;
  }
  if (mimeType === 'model/stl') {
    const geom = await new STLLoader().loadAsync(url);
    geom.computeVertexNormals();
    return new THREE.Mesh(geom, STD_MATERIAL());
  }
  if (mimeType === 'model/ply') {
    const geom = await new PLYLoader().loadAsync(url);
    geom.computeVertexNormals();
    return new THREE.Mesh(geom, STD_MATERIAL());
  }
  if (mimeType === 'model/obj') {
    const obj = await new OBJLoader().loadAsync(url);
    // OBJ without an MTL renders black under lights — give bare meshes a material.
    obj.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && (!m.material || (m.material as THREE.Material).type === 'MeshBasicMaterial')) {
        m.material = STD_MATERIAL();
      }
    });
    return obj;
  }
  throw new Error(`Unsupported model type: ${mimeType}`);
}

export const ModelViewer: React.FC<ModelViewerProps> = ({ url, mimeType }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let raf = 0;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2b3038);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    // ACES tone mapping + sRGB output so PBR materials read at the right brightness
    // instead of looking crushed/dark.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Image-based lighting — the real fix for "too dark". A PBR MeshStandardMaterial
    // is mostly lit by its environment; without one its reflections are black. A soft
    // RoomEnvironment gives even studio illumination from every direction.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmrem.dispose();

    // A bright hemisphere + a key directional add directional definition on top of
    // the even IBL so edges and curvature read.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 1.5, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-1, -0.5, -1);
    scene.add(fill);

    const grid = new THREE.GridHelper(10, 20, 0x3a4250, 0x2a2f38);
    scene.add(grid);

    const fitCamera = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center); // center the model at the origin
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      // Scale the grid to the model so it reads at any unit (mm vs m).
      grid.scale.setScalar(maxDim / 5);
      grid.position.y = -size.y / 2;
      const dist = (maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360);
      camera.position.set(maxDim * 0.8, maxDim * 0.6, dist * 1.6);
      camera.near = maxDim / 1000;
      camera.far = maxDim * 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
    };

    loadModel(url, mimeType)
      .then((object) => {
        if (disposed) return;
        scene.add(object);
        fitCamera(object);
        setLoading(false);
      })
      .catch((e) => {
        if (disposed) return;
        setError(e instanceof Error ? e.message : 'Failed to load model');
        setLoading(false);
      });

    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      envTexture.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      });
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
  }, [url, mimeType]);

  return (
    <div className="relative w-full h-full min-h-[300px]">
      <div ref={containerRef} className="w-full h-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">loading model…</div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-danger-400">Failed to load model: {error}</div>
      )}
    </div>
  );
};

export default ModelViewer;
