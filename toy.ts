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
import type { ToyVariant } from './game.js';

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
  const varyings = `
    varying vec3 vToyPosition;
    flat varying vec3 vToyFur;
    flat varying vec3 vToyInk;
    flat varying int vToyEars;
    flat varying int vToyPattern;
  `;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.toyFurPalette = { value: FURS };
    shader.uniforms.toyInkPalette = { value: INKS };
    shader.uniforms.toyEarColors = { value: EAR_COLORS };
    shader.uniforms.toyEarInks = { value: EAR_INKS };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${varyings}
        uniform vec3 toyFurPalette[${FURS.length}];
        uniform vec3 toyInkPalette[${INKS.length}];
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vToyPosition = position;
        vToyFur = toyFurPalette[int(instanceColor.x)];
        vToyInk = toyInkPalette[int(instanceColor.y)];
        int style = int(instanceColor.z);
        vToyEars = style / ${PATTERN_COUNT};
        vToyPattern = style % ${PATTERN_COUNT};
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${varyings}
        uniform vec3 toyEarColors[${EAR_COLORS.length}];
        uniform vec3 toyEarInks[${EAR_INKS.length}];
        const vec3 TOY_LUMA = vec3(0.2126, 0.7152, 0.0722);

        float toyEarMark(vec2 p) {
          if (vToyEars == 0) return 0.0;
          p.x += p.x < 0.0 ? 0.105 : -0.066;
          if (vToyEars == 1) {
            float stripe = abs(fract((p.y + p.x * 0.38) * 24.0) - 0.5);
            return 1.0 - smoothstep(0.105, 0.17, stripe);
          }
          float spot = min(length(p - vec2(-0.019, 0.802)), length(p - vec2(0.015, 0.845)));
          spot = min(spot, length(p - vec2(-0.009, 0.892)));
          return 1.0 - smoothstep(0.009, 0.014, spot);
        }

        float toyCoatField(vec2 p) {
          if (vToyPattern == 0) { // Tapered, swept tiger stripes
            float bend = 0.34 * cos(PI * p.x) + 0.11 * sin(1.5 * PI * p.x + 1.1);
            float taper = 0.5 + 0.5 * sin(PI * p.x + 1.6 * p.y);
            return abs(fract(p.y + bend) - 0.5) - mix(0.016, 0.23, taper);
          }
          if (vToyPattern == 1) { // Angular chevrons
            float zig = abs(fract(p.x * 0.5 + 0.5) - 0.5);
            return abs(fract(p.y - 1.5 * zig) - 0.5) - 0.15;
          }
          if (vToyPattern == 2) { // Staggered, broken leopard rosettes
            vec2 tile = p * vec2(1.0, 0.9);
            tile.x += 0.45 * mod(floor(tile.y), 2.0);
            float shift = mod(floor(tile.x) + 2.0 * floor(tile.y), 3.0) - 1.0;
            vec2 q = fract(tile) - 0.5 - shift * vec2(0.06, -0.05);
            q = vec2(q.x + 0.28 * q.y, 1.27 * q.y);
            float ring = abs(length(q) - 0.225 + 0.039 * sin(13.0 * q.x) * sin(11.0 * q.y)) - 0.080;
            return max(ring, min(q.x - 0.08, 0.060 - abs(q.y)));
          }
          if (vToyPattern == 3) { // Regular round polka dots
            return length(fract(p * vec2(1.0, 0.93)) - 0.5) - 0.265;
          }
          if (vToyPattern == 4) { // Large offset patches
            vec2 tile = p * vec2(2.0 / 3.0, 0.68);
            tile += vec2(0.11 * sin(5.4 * tile.y), 0.13 * cos(0.5 * PI * tile.x));
            float row = floor(tile.y);
            tile.x += 0.34 * mod(row, 2.0);
            vec2 edge = abs(fract(tile) - 0.5) - 0.5;
            return max(edge.x, edge.y) * (1.0 - 2.0 * mod(floor(tile.x) + row, 2.0));
          }
          if (vToyPattern == 5) { // Small, sparse freckle clusters
            vec2 tile = p * vec2(2.0 / 3.0, 0.74);
            tile.x += 0.38 * mod(floor(tile.y), 2.0);
            vec2 q = fract(tile) - 0.5;
            float dots = min(length(q - vec2(-0.18, 0.10)) - 0.13, length(q - vec2(0.17, 0.14)) - 0.10);
            return min(dots, length(q - vec2(0.065, -0.18)) - 0.115);
          }
          if (vToyPattern == 6) { // Offset diamonds
            vec2 tile = p * vec2(1.0, 0.97);
            tile.x += 0.5 * mod(floor(tile.y), 2.0);
            vec2 q = abs(fract(tile) - 0.5);
            return q.x + q.y - 0.355;
          }
          // Smooth waves running vertically, unlike the tiger stripes and chevrons.
          float wave = p.x * 0.5 + 0.25 * sin(PI * p.y);
          return abs(fract(wave) - 0.5) - 0.17;
        }

        float toyChestStamp(vec3 p) {
          // The source atlas also contains a small pendant and its hanging loop.
          vec2 disk = (p.xy - vec2(0.067, 0.319)) / vec2(0.027, 0.031);
          vec2 loop = (p.xy - vec2(0.059, 0.360)) / vec2(0.015, 0.022);
          float footprint = min(length(disk), length(loop));
          return (1.0 - smoothstep(0.94, 1.26, footprint)) * smoothstep(0.097, 0.128, p.z);
        }
      `)
      .replace('#include <color_fragment>', `
        vec3 toySurface = texture2D(roughnessMap, vRoughnessMapUv).rgb;
        float toyChest = toyChestStamp(vToyPosition);
        float bakedDetail = sqrt(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
        float coatDetail = min(0.34 + 1.18 * bakedDetail, 1.0);
        float chestDetail = clamp(0.59 - 1.9 * (vToyPosition.y - 0.32), 0.49, 0.64);
        coatDetail = mix(coatDetail, chestDetail, 0.83 * toyChest);

        // Wrap a twelve-cell domain around the toy. The fields repeat at its rear seam.
        vec2 coatPosition = vec2(atan(vToyPosition.x, vToyPosition.z) * (6.0 / PI),
                                 vToyPosition.y * 11.0 + 0.24);
        float field = toyCoatField(coatPosition);
        float edge = clamp(0.5 * fwidth(field), 0.018, 0.16);
        float marking = 1.0 - smoothstep(-edge, edge, field);
        float furLuma = dot(vToyFur, TOY_LUMA);
        float inkLuma = dot(vToyInk, TOY_LUMA);
        float closeShade = 1.0 - smoothstep(0.035, 0.16, abs(furLuma - inkLuma));
        vec3 ink = inkLuma < furLuma
          ? vToyInk * (1.0 - 0.42 * closeShade)
          : mix(vToyInk, vec3(1.0), 0.20 * closeShade);
        vec3 coat = mix(vToyFur, ink, marking) * coatDetail;
        float furMask = smoothstep(0.18, 0.79, mix(toySurface.r, 1.0, toyChest));
        diffuseColor.rgb = mix(diffuseColor.rgb, coat, furMask);

        vec3 lining = mix(toyEarColors[vToyEars], toyEarInks[vToyEars], toyEarMark(vToyPosition.xy));
        float earMask = smoothstep(0.12, 0.85, toySurface.b);
        diffuseColor.rgb = mix(diffuseColor.rgb, lining * min(0.42 + bakedDetail, 1.0), earMask);
      `)
      .replace('#include <roughnessmap_fragment>',
        'float roughnessFactor = roughness * mix(toySurface.g, 0.64, toyChest);')
      .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.replace(
        'mapN.xy *= normalScale;',
        'mapN = mix(mapN, vec3(0.0, 0.0, 1.0), toyChest);\nmapN.xy *= normalScale;',
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
