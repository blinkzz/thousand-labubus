import {
  Color,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  ShaderChunk,
  type BufferGeometry,
  type Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ToyVariant } from '@/game';
import coatBegin from '@/shaders/coat-begin.vert?raw';
import coatFragmentCommon from '@/shaders/coat-common.frag?raw';
import coatVertexCommon from '@/shaders/coat-common.vert?raw';
import coatColor from '@/shaders/coat-color.frag?raw';
import coatNormal from '@/shaders/coat-normal.frag?raw';
import coatRoughness from '@/shaders/coat-roughness.frag?raw';
import coatVaryings from '@/shaders/coat-varyings.glsl?raw';

const FURS = [
  new Color('#a57861'),
  new Color('#f3ab46'),
  new Color('#e9749f'),
  new Color('#c09eeb'),
  new Color('#9abb6a'),
  new Color('#77b7f4'),
];

const INKS = [
  new Color('#fff1cf'),
  new Color('#36313a'),
  new Color('#e86650'),
  new Color('#238d7d'),
  new Color('#8758b9'),
];

const EAR_COLORS = [new Color('#f092a5'), new Color('#fff0cb'), new Color('#f7d954')];
const EAR_INKS = [EAR_COLORS[0], new Color('#b8433c'), new Color('#604032')];
const PATTERN_COUNT = 8;

const GLASSES = [
  null,
  { color: '#20877c', angular: false },
  { color: '#8d337b', angular: true },
];

type Placement = { toy: ToyVariant; position: Vector3 };
type Part = {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
};

export class ToyModel {
  private constructor(
    private readonly highGeometry: BufferGeometry,
    private readonly lowGeometry: BufferGeometry,
    private readonly bodyMaterial: MeshStandardMaterial,
    private readonly glasses: readonly (Part | null)[],
  ) {}

  static async load(): Promise<ToyModel> {
    const loader = new GLTFLoader();
    const [{ scene }, { scene: lowScene }] = await Promise.all([
      loader.loadAsync(new URL('./assets/labubu-model.glb', import.meta.url).href),
      loader.loadAsync(new URL('./assets/labubu-low.glb', import.meta.url).href),
    ]);
    const [lowMesh] = lowScene.children;
    if (!(lowMesh instanceof Mesh)) throw new Error('Expected one low-detail Labubu model mesh.');
    const [mesh] = scene.children;
    if (!(mesh instanceof Mesh)) throw new Error('Expected one Labubu model mesh.');
    const { geometry, material } = mesh;
    if (!(material instanceof MeshStandardMaterial) ||
      !material.map || !material.roughnessMap || !material.normalMap) {
      throw new Error('Expected the Labubu model with baked color, surface, and normal maps.');
    }

    return new ToyModel(
      geometry,
      lowMesh.geometry,
      makeBodyMaterial(material),
      GLASSES.map((glasses) => glasses ? {
        geometry: makeGlasses(glasses.angular),
        material: new MeshStandardMaterial({ color: glasses.color, roughness: 0.32 }),
      } : null),
    );
  }

  createBatch(placements: readonly Placement[], detailed = false): Group {
    const group = new Group();

    const eyeCounts = new Array<number>(this.glasses.length).fill(0);
    for (const { toy } of placements) eyeCounts[toy.eyes]++;
    const glasses = this.glasses.map((part, index) => part && eyeCounts[index] > 0
      ? new InstancedMesh(part.geometry, part.material, eyeCounts[index])
      : null);

    const geometry = detailed ? this.highGeometry : this.lowGeometry;
    const body = new InstancedMesh(geometry, this.bodyMaterial, placements.length);
    // The body shader treats Three's mesh-owned instanceColor as three unnormalized
    // selector bytes. InstancedMesh.dispose() then releases it along with the matrices.
    const selectors = new Uint8Array(placements.length * 3);
    body.instanceColor = new InstancedBufferAttribute(selectors, 3);

    const matrix = new Matrix4();
    const eyeSlots = eyeCounts.fill(0);
    for (let instance = 0; instance < placements.length; instance++) {
      const { position, toy } = placements[instance];
      matrix.setPosition(position);
      body.setMatrixAt(instance, matrix);
      const offset = instance * 3;
      selectors[offset] = toy.fur;
      selectors[offset + 1] = toy.ink;
      selectors[offset + 2] = toy.ears * PATTERN_COUNT + toy.pattern;
      glasses[toy.eyes]?.setMatrixAt(eyeSlots[toy.eyes]++, matrix);
    }

    group.add(body);
    for (const mesh of glasses) {
      if (!mesh) continue;
      group.add(mesh);
    }
    return group;
  }

  releaseBatch(group: Group): void {
    for (const child of group.children) {
      if (child instanceof InstancedMesh) child.dispose();
    }
    group.clear();
  }
}

function makeBodyMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
  const material = source.clone();
  // The baked atlas packs fur coverage, roughness, and ear lining coverage into RGB.
  material.metalnessMap = null;
  material.defines = {
    ...material.defines,
    TOY_FUR_PALETTE_LENGTH: FURS.length,
    TOY_INK_PALETTE_LENGTH: INKS.length,
    TOY_EAR_COLORS_LENGTH: EAR_COLORS.length,
    TOY_EAR_INKS_LENGTH: EAR_INKS.length,
    TOY_PATTERN_COUNT: PATTERN_COUNT,
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.toyFurPalette = { value: FURS };
    shader.uniforms.toyInkPalette = { value: INKS };
    shader.uniforms.toyEarColors = { value: EAR_COLORS };
    shader.uniforms.toyEarInks = { value: EAR_INKS };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${coatVaryings}\n${coatVertexCommon}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${coatBegin}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${coatVaryings}\n${coatFragmentCommon}`)
      .replace('#include <color_fragment>', coatColor)
      .replace('#include <roughnessmap_fragment>', coatRoughness)
      .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.replace(
        'mapN.xy *= normalScale;',
        `${coatNormal}\nmapN.xy *= normalScale;`,
      ));
  };
  material.customProgramCacheKey = () => 'labubu-coat';
  return material;
}

function embossed(shape: Shape, depth: number, bevelSize: number): ExtrudeGeometry {
  return new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize,
    bevelThickness: bevelSize,
    bevelSegments: 1,
    curveSegments: 8,
  });
}

function outline(path: Path, points: readonly (readonly [number, number])[], mirror: number): void {
  const [x, y] = points[0];
  path.moveTo(x * mirror, y);
  for (let index = 1; index < points.length; index++) {
    const [nextX, nextY] = points[index];
    path.lineTo(nextX * mirror, nextY);
  }
  path.closePath();
}

function makeGlasses(angular: boolean): BufferGeometry {
  const rims = ([-1, 1] as const).map((side) => {
    const shape = new Shape();
    const hole = new Path();
    if (angular) {
      outline(shape, [[-0.055, 0.016], [-0.031, 0.034], [0.064, 0.052], [0.053, -0.014],
        [0.021, -0.048], [-0.029, -0.046], [-0.052, -0.026]], side);
      outline(hole, [[-0.041, 0.011], [-0.038, -0.019], [-0.022, -0.033], [0.016, -0.034],
        [0.04, -0.009], [0.047, 0.037], [-0.026, 0.023]], side);
    } else {
      shape.absellipse(0, 0, 0.056, 0.055, 0, Math.PI * 2, false);
      hole.absellipse(0, 0, 0.041, 0.041, 0, Math.PI * 2, true);
    }
    shape.holes.push(hole);
    // Follow the baked eyes and the curved face, keeping the lenses open.
    return embossed(shape, 0.009, 0.0016).rotateY(side * 0.36)
      .translate(side < 0 ? -0.083 : 0.066, 0.532, 0.216);
  });

  const bridge = new Shape();
  bridge.moveTo(-0.034, 0.006);
  bridge.quadraticCurveTo(-0.009, 0.027, 0.016, 0.006);
  bridge.lineTo(0.016, -0.003);
  bridge.quadraticCurveTo(-0.009, 0.015, -0.034, -0.003);
  bridge.closePath();
  rims.push(embossed(bridge, 0.009, 0.0016).translate(0, 0.532, 0.227));
  // All three pieces are extrusions with the same vertex attributes.
  return mergeGeometries(rims)!;
}
