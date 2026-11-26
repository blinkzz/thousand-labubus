import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, Box3, BoxGeometry, CanvasTexture,
  Color, CylinderGeometry, DirectionalLight, Frustum, Group,
  HemisphereLight, InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Matrix4, Object3D, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, SphereGeometry, Spherical,
  SRGBColorSpace, TOUCH, Vector2, Vector3, WebGLRenderer,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ToyVariant } from '@/game';
import type { ToyModel } from '@/toy';

export type CameraAction = 'left' | 'right' | 'up' | 'down' | 'in' | 'out' | 'reset';
type Mark = 'wrong' | 'match';

const COLUMNS: Readonly<Partial<Record<number, number>>> = { 100: 10, 500: 25, 1000: 40 };
const CHUNK_COLUMNS = 8;
const CHUNK_ROWS = 5;
const DETAIL_ENTER = 6.5;
const DETAIL_EXIT = 7.5;
const HIT_HALF_WIDTH = 0.35;
const HIT_BOTTOM = -0.015;
const HIT_TOP = 1.055;
const HIT_BACK = -0.24;
const HIT_FRONT = 0.26;
const COLUMN_PITCH = 1.16;
const ROW_PITCH = 1.23;
const BOTTOM_TIER = 0.71;
const SHELF_EDGE = 0.42;
const ROOM = 1;
const PREVIEW = 2;
const FEEDBACK = 4;
const INITIAL_POLAR = Math.PI / 2 - 0.035;
const WINDOW_WIDTH = 3.90;
const WINDOW_HEIGHT = 3.04;
const WINDOW_OFFSET = 2.70;
const WINDOW_TRANSOM = 0.62;
const WING_ANGLE = 55 * Math.PI / 180;
const WING_COS = Math.cos(WING_ANGLE);
const WING_SIN = Math.sin(WING_ANGLE);
const SUN_X = 1.20;
const SUN_Y = 1.25;
const SUN_Z = -0.66;
const PREVIEW_ORIGIN = new Vector3();
const HOVER_Z = 0.33;
const FOCUS_Z = 0.36;
const MARK_Z = SHELF_EDGE + 0.016;
const CORNERS = corners();
const MARK_SHAPES = { wrong: markShape('wrong'), match: markShape('match') };

type ShelfChunk = {
  bounds: Box3;
  root: Group;
  placements: { toy: ToyVariant; position: Vector3 }[];
  low: Group;
  detail?: Group;
};

export class RoomView {
  readonly #room = new Scene();
  readonly #preview = new Scene();
  readonly #camera = new PerspectiveCamera(34, 1, 0.05, 180);
  readonly #previewCamera = new PerspectiveCamera(31, 1, 0.05, 12);
  readonly #furnishings = new CollectorSet();
  readonly #board = new Group();
  readonly #chunks: ShelfChunk[] = [];
  readonly #frustum = new Frustum();
  readonly #clipFromWorld = new Matrix4();
  readonly #renderer: WebGLRenderer;
  readonly #previewRenderer: WebGLRenderer;
  readonly #controls: OrbitControls;
  readonly #model: ToyModel;
  readonly #onPick: (index: number, event: PointerEvent) => void;

  readonly #overlay: HTMLCanvasElement;
  readonly #overlayContext: CanvasRenderingContext2D;
  readonly #marks = new Map<number, Mark>();
  readonly #projectedQuad = new Float64Array(8);
  readonly #roomSize = new Vector2();
  readonly #previewSize = new Vector2();
  readonly #raycaster = new Raycaster();
  readonly #pickBox = new Box3();
  readonly #pointer = new Vector2();
  readonly #hoverPoint = new Vector2();
  readonly #intersection = new Vector3();
  readonly #focusPoint = new Vector3();
  readonly #pointers = new Set<number>();
  readonly #offset = new Vector3();
  readonly #orbit = new Spherical();
  readonly #center = new Vector3();
  readonly #home = new Vector3();

  #positions: Vector3[] = [];
  #columns = 0;
  #previewBatch?: Group;
  #press?: { id: number; x: number; y: number; slop: number };
  #hasHoverPoint = false;
  #hoverIndex: number | null = null;
  #focusIndex: number | null = null;
  #homeDistance = 1;
  #shelfWidth = 0;
  #shelfHeight = 0;
  #dirty = 0;
  #frame = 0;

  constructor(roomHost: HTMLElement, previewHost: HTMLElement, model: ToyModel, onPick: (index: number, event: PointerEvent) => void) {
    this.#model = model;
    this.#onPick = onPick;
    this.#renderer = makeRenderer(false);
    this.#previewRenderer = makeRenderer(true);
    const canvas = this.#renderer.domElement;
    this.#overlay = roomHost.ownerDocument.createElement('canvas');
    this.#overlay.className = 'room-feedback';
    this.#overlay.setAttribute('aria-hidden', 'true');
    const context = this.#overlay.getContext('2d');
    if (!context) throw new Error('Could not create room feedback canvas');
    this.#overlayContext = context;
    roomHost.append(canvas, this.#overlay);
    previewHost.append(this.#previewRenderer.domElement);

    this.#room.background = new Color(0xcebaa4);
    this.#room.add(this.#furnishings.root, this.#board);
    displayLight(this.#room);
    displayLight(this.#preview);
    const sun = new DirectionalLight(0xffe4bf, 1.16);
    sun.position.set(SUN_X, SUN_Y, SUN_Z);
    this.#room.add(sun);

    const pedestal = new Mesh(
      new CylinderGeometry(0.36, 0.40, 0.065, 36),
      new MeshStandardMaterial({ color: 0xb27660, roughness: 0.78 }),
    );
    pedestal.position.y = -0.033;
    this.#preview.add(pedestal);

    this.#camera.position.set(0, 3, 12);
    this.#controls = new OrbitControls(this.#camera, canvas);
    this.#controls.minAzimuthAngle = -0.60;
    this.#controls.maxAzimuthAngle = 0.60;
    this.#controls.minPolarAngle = 1.28;
    this.#controls.maxPolarAngle = 1.69;
    this.#controls.zoomToCursor = true;
    this.#controls.touches.TWO = TOUCH.DOLLY_PAN;
    this.#controls.addEventListener('change', this.#cameraChanged);

    // A second touch anywhere in the viewport (even over a HUD) invalidates a room tap.
    canvas.ownerDocument.addEventListener('pointerdown', (event) => {
      if (event.pointerId !== this.#press?.id) this.#press = undefined;
    }, { capture: true });
    canvas.addEventListener('pointerdown', this.#pointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.#pointerMove, { capture: true });
    canvas.addEventListener('pointerup', this.#pointerUp, { capture: true });
    canvas.addEventListener('pointercancel', this.#pointerCancel, { capture: true });
    canvas.addEventListener('lostpointercapture', this.#pointerCancel, { capture: true });
    canvas.addEventListener('pointerleave', this.#pointerLeave);
    canvas.style.cursor = 'grab';

    this.#resize(ROOM, roomHost.clientWidth, roomHost.clientHeight);
    this.#resize(PREVIEW, previewHost.clientWidth, previewHost.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const { target, contentRect } of entries) {
        this.#resize(target === roomHost ? ROOM : PREVIEW, contentRect.width, contentRect.height);
      }
    });
    observer.observe(roomHost);
    observer.observe(previewHost);
    window.addEventListener('resize', () => {
      this.#resize(ROOM, this.#roomSize.x, this.#roomSize.y);
      this.#resize(PREVIEW, this.#previewSize.x, this.#previewSize.y);
    });
  }

  prepare(): void {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#render();
  }

  showRound(target: ToyVariant, tiles: readonly ToyVariant[]): void {
    const columns = COLUMNS[tiles.length];
    if (!columns) throw new RangeError(`Unsupported shelf size: ${tiles.length}`);
    if (tiles.length !== this.#positions.length) this.#setLayout(columns, tiles.length / columns);

    for (const chunk of this.#chunks) {
      this.#model.releaseBatch(chunk.low);
      if (chunk.detail) this.#model.releaseBatch(chunk.detail);
    }
    this.#chunks.length = 0;
    this.#board.clear();
    if (this.#previewBatch) {
      this.#previewBatch.removeFromParent();
      this.#model.releaseBatch(this.#previewBatch);
    }
    this.#fillShelf(tiles, columns, tiles.length / columns);
    this.#previewBatch = this.#model.createBatch([{ toy: target, position: PREVIEW_ORIGIN }], true);
    this.#preview.add(this.#previewBatch);
    this.#marks.clear();
    this.#focusIndex = null;
    this.#press = undefined;
    this.#pointerLeave();
    this.#frameShelf(true);
    this.#invalidate(ROOM | PREVIEW | FEEDBACK);
  }

  markTile(index: number, state: Mark): void {
    if (!this.#positions[index] || this.#marks.get(index) === state) return;
    this.#marks.set(index, state);
    this.#invalidate(FEEDBACK);
  }

  focusTile(index: number | null): void {
    const position = index === null ? undefined : this.#positions[index];
    const next = position ? index : null;
    if (this.#focusIndex !== next) {
      this.#focusIndex = next;
      this.#invalidate(FEEDBACK);
    }
    if (!position) return;
    const point = this.#focusPoint.copy(position);
    point.y += (HIT_BOTTOM + HIT_TOP) * 0.5;
    point.z = FOCUS_Z;
    point.project(this.#camera);
    if (Math.abs(point.x) <= 0.90 && Math.abs(point.y) <= 0.90 && Math.abs(point.z) <= 1) return;

    const target = this.#controls.target;
    this.#offset.subVectors(this.#camera.position, target);
    target.set(position.x, position.y + (HIT_BOTTOM + HIT_TOP) * 0.5, this.#center.z);
    this.#camera.position.copy(target).add(this.#offset);
    this.#controls.update();
  }

  setTouchMode(mode: 'orbit' | 'pan'): void {
    const action = mode === 'pan' ? TOUCH.PAN : TOUCH.ROTATE;
    if (this.#controls.touches.ONE === action) return;
    this.#controls.touches.ONE = action;
    this.#press = undefined;
  }

  moveCamera(action: CameraAction): void {
    if (this.#positions.length === 0) return;
    if (action === 'reset') {
      this.#frameShelf(true);
      return;
    }

    const camera = this.#camera;
    const target = this.#controls.target;
    const orbit = this.#orbit.setFromVector3(this.#offset.subVectors(camera.position, target));
    const zoomStep = 1.30 + 0.25 * MathUtils.smoothstep(orbit.radius, 8, 28);
    switch (action) {
      case 'left': orbit.theta -= 0.16; break;
      case 'right': orbit.theta += 0.16; break;
      case 'up': orbit.phi -= 0.11; break;
      case 'down': orbit.phi += 0.11; break;
      case 'in': orbit.radius /= zoomStep; break;
      case 'out': orbit.radius *= zoomStep; break;
    }
    camera.position.copy(target).add(this.#offset.setFromSpherical(orbit));
    this.#controls.update();
  }

  #setLayout(columns: number, rows: number): void {
    this.#columns = columns;
    this.#shelfWidth = columns * COLUMN_PITCH + 0.16;
    this.#shelfHeight = rows * ROW_PITCH + 0.13;
    this.#center.set(0, BOTTOM_TIER + rows * ROW_PITCH / 2 - 0.06, 0.10);
    this.#positions = [];
    for (let row = 0; row < rows; row++) {
      const y = BOTTOM_TIER + (rows - row - 1) * ROW_PITCH;
      for (let column = 0; column < columns; column++) {
        const x = (column - (columns - 1) * 0.5) * COLUMN_PITCH;
        this.#positions.push(new Vector3(x, y, 0));
      }
    }
    this.#furnishings.arrange(this.#shelfWidth, rows, columns);
  }

  #fillShelf(tiles: readonly ToyVariant[], columns: number, rows: number): void {
    for (let top = 0; top < rows; top += CHUNK_ROWS) {
      const bottom = Math.min(rows, top + CHUNK_ROWS);
      for (let left = 0; left < columns; left += CHUNK_COLUMNS) {
        const right = Math.min(columns, left + CHUNK_COLUMNS);
        const placements: ShelfChunk['placements'] = [];
        for (let row = top; row < bottom; row++) {
          for (let column = left; column < right; column++) {
            const index = row * columns + column;
            placements.push({ toy: tiles[index], position: this.#positions[index] });
          }
        }
        const topLeft = this.#positions[top * columns + left];
        const bottomRight = this.#positions[(bottom - 1) * columns + right - 1];
        const bounds = new Box3(
          new Vector3(topLeft.x - COLUMN_PITCH * 0.5, bottomRight.y - 0.12, -0.45),
          new Vector3(bottomRight.x + COLUMN_PITCH * 0.5, topLeft.y + ROW_PITCH, 0.45),
        );
        const low = this.#model.createBatch(placements);
        const root = new Group();
        root.add(low);
        this.#board.add(root);
        this.#chunks.push({ bounds, root, placements, low });
      }
    }
  }

  #updateShelfVisibility(): void {
    const camera = this.#camera;
    this.#frustum.setFromProjectionMatrix(this.#clipFromWorld.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let nearest: ShelfChunk | undefined;
    let next: ShelfChunk | undefined;
    let nearestScore = Infinity;
    let nextScore = Infinity;
    for (const chunk of this.#chunks) {
      chunk.root.visible = this.#frustum.intersectsBox(chunk.bounds);
      if (!chunk.root.visible || camera.position.z > DETAIL_EXIT + 0.45) continue;
      const distance = chunk.bounds.distanceToPoint(camera.position);
      if (distance > (chunk.detail ? DETAIL_EXIT : DETAIL_ENTER)) continue;
      const score = distance - (chunk.detail ? 0.45 : 0);
      if (score < nearestScore) {
        next = nearest;
        nextScore = nearestScore;
        nearest = chunk;
        nearestScore = score;
      } else if (score < nextScore) {
        next = chunk;
        nextScore = score;
      }
    }

    // Keep full geometry to at most two nearby chunks, with a wider exit band
    // so small zoom or pan changes don't continuously recreate the batches.
    for (const chunk of this.#chunks) {
      if (chunk === nearest || chunk === next) {
        if (!chunk.detail) {
          chunk.detail = this.#model.createBatch(chunk.placements, true);
          chunk.root.add(chunk.detail);
          chunk.low.visible = false;
        }
      } else if (chunk.detail) {
        chunk.detail.removeFromParent();
        this.#model.releaseBatch(chunk.detail);
        delete chunk.detail;
        chunk.low.visible = true;
      }
    }
  }

  #frameShelf(reset: boolean): void {
    const previousDistance = this.#homeDistance;
    const previousX = this.#home.x;
    const previousY = this.#home.y;
    const { aspect, fov } = this.#camera;
    const tangent = Math.tan(MathUtils.degToRad(fov * 0.5));
    // Favor the window on wider screens. On narrow screens a centered
    // panorama of the larger shelves is more readable than a full fit.
    const landscape = MathUtils.smoothstep(aspect, 0.95, 1.40);
    const overviewAspect = this.#columns <= 10 ? aspect : Math.max(aspect, 0.82);
    const horizontal = (this.#shelfWidth * 0.5 + 0.55 + 2.90 * landscape) / (tangent * overviewAspect);
    const vertical = (this.#shelfHeight * 0.54 + 0.68) / tangent;
    this.#homeDistance = 0.80 + Math.max(horizontal, vertical);
    this.#home.copy(this.#center);
    this.#home.x += 1.60 * landscape;
    this.#home.y -= 0.65 * landscape;
    this.#controls.minDistance = 2.65;
    const fullWidth = 0.80 + (this.#shelfWidth * 0.5 + 0.55) / (tangent * aspect);
    this.#controls.maxDistance = Math.max(this.#homeDistance * 1.45, fullWidth);
    this.#camera.far = Math.max(180, this.#controls.maxDistance + Math.hypot(this.#shelfWidth + 35, this.#shelfHeight + 15, 32));
    this.#camera.updateProjectionMatrix();
    const target = this.#controls.target;
    if (reset) {
      target.copy(this.#home);
      this.#orbit.set(this.#homeDistance, INITIAL_POLAR, 0);
      this.#camera.position.copy(target).add(this.#offset.setFromSpherical(this.#orbit));
    } else {
      this.#offset.subVectors(this.#camera.position, target).multiplyScalar(this.#homeDistance / previousDistance);
      target.x += this.#home.x - previousX;
      target.y += this.#home.y - previousY;
      this.#camera.position.copy(target).add(this.#offset);
    }
    this.#controls.update();
  }

  #cameraChanged = (): void => {
    const target = this.#controls.target;
    if (this.#positions.length !== 0) {
      this.#offset.set(
        MathUtils.clamp(target.x, -this.#shelfWidth * 0.53, this.#shelfWidth * 0.53) - target.x,
        MathUtils.clamp(target.y, BOTTOM_TIER, BOTTOM_TIER + this.#shelfHeight) - target.y,
        MathUtils.clamp(target.z, -0.20, 0.65) - target.z,
      );
      target.add(this.#offset);
      this.#camera.position.add(this.#offset);
    }
    this.#camera.updateMatrixWorld();
    this.#updateHover();
    this.#invalidate(ROOM | FEEDBACK);
  };

  #pick(clientX: number, clientY: number): number | null {
    if (!this.#positions.length) return null;
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;

    this.#raycaster.setFromCamera(this.#pointer.set(2 * x - 1, 1 - 2 * y), this.#camera);
    const ray = this.#raycaster.ray;
    const { origin, direction } = ray;
    if (direction.z >= 0 || origin.z <= HIT_FRONT) return null;

    // Only the grid cells crossed by the ray through the toys' depth can hit.
    const front = (HIT_FRONT - origin.z) / direction.z;
    const back = (HIT_BACK - origin.z) / direction.z;
    const frontX = origin.x + front * direction.x;
    const backX = origin.x + back * direction.x;
    const frontY = origin.y + front * direction.y;
    const backY = origin.y + back * direction.y;
    const { x: firstX, y: firstY } = this.#positions[0];
    const firstColumn = Math.max(0, Math.ceil((Math.min(frontX, backX) - firstX - HIT_HALF_WIDTH) / COLUMN_PITCH));
    const lastColumn = Math.min(this.#columns - 1, Math.floor((Math.max(frontX, backX) - firstX + HIT_HALF_WIDTH) / COLUMN_PITCH));
    const firstRow = Math.max(0, Math.ceil((firstY - Math.max(frontY, backY) + HIT_BOTTOM) / ROW_PITCH));
    const lastRow = Math.min(this.#positions.length / this.#columns - 1,
      Math.floor((firstY - Math.min(frontY, backY) + HIT_TOP) / ROW_PITCH));
    let closest = Infinity;
    let picked: number | null = null;
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const index = row * this.#columns + column;
        const { x, y } = this.#positions[index];
        const bounds = this.#pickBox;
        bounds.min.set(x - HIT_HALF_WIDTH, y + HIT_BOTTOM, HIT_BACK);
        bounds.max.set(x + HIT_HALF_WIDTH, y + HIT_TOP, HIT_FRONT);
        if (!ray.intersectBox(bounds, this.#intersection)) continue;
        const distance = origin.distanceToSquared(this.#intersection);
        if (distance >= closest) continue;
        closest = distance;
        picked = index;
      }
    }
    return picked;
  }

  #updateHover(): void {
    const index = this.#hasHoverPoint ? this.#pick(this.#hoverPoint.x, this.#hoverPoint.y) : null;
    if (this.#hoverIndex !== index) {
      this.#hoverIndex = index;
      this.#invalidate(FEEDBACK);
    }
    const canvas = this.#renderer.domElement;
    const cursor = this.#pointers.size ? 'grabbing' : index === null ? 'grab' : 'pointer';
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  #pointerDown = (event: PointerEvent): void => {
    this.#pointers.add(event.pointerId);
    this.#press = event.button === 0 && event.isPrimary && this.#pointers.size === 1
      && !event.ctrlKey && !event.metaKey && !event.shiftKey
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, slop: event.pointerType === 'touch' ? 8 : 4 }
      : undefined;
    // Keep every contact's move, end, and cancel events on the canvas.
    this.#renderer.domElement.setPointerCapture(event.pointerId);
    this.#pointerLeave();
  };

  #pointerMove = (event: PointerEvent): void => {
    if (this.#pointers.has(event.pointerId)) {
      if (this.#press) {
        // Keep OrbitControls from turning tap jitter into a small rotation.
        if (this.#isTap(event)) event.stopImmediatePropagation();
        else this.#press = undefined;
      }
    } else if (!this.#pointers.size && event.pointerType !== 'touch') {
      this.#hasHoverPoint = true;
      this.#hoverPoint.set(event.clientX, event.clientY);
      this.#updateHover();
    }
  };

  #isTap(event: PointerEvent): boolean {
    const press = this.#press;
    return press !== undefined && press.id === event.pointerId
      && (event.clientX - press.x) ** 2 + (event.clientY - press.y) ** 2 <= press.slop ** 2;
  }

  #pointerUp = (event: PointerEvent): void => {
    if (!this.#pointers.delete(event.pointerId)) return;
    const picked = !this.#pointers.size && event.button === 0 && this.#isTap(event)
      ? this.#pick(event.clientX, event.clientY) : null;
    this.#press = undefined;
    if (!this.#pointers.size && event.pointerType !== 'touch') {
      this.#hasHoverPoint = true;
      this.#hoverPoint.set(event.clientX, event.clientY);
    }
    this.#updateHover();
    if (picked !== null) this.#onPick(picked, event);
  };

  #pointerCancel = (event: PointerEvent): void => {
    if (!this.#pointers.delete(event.pointerId)) return;
    this.#press = undefined;
    this.#pointerLeave();
  };

  #pointerLeave = (): void => {
    this.#hasHoverPoint = false;
    this.#updateHover();
  };

  #resize(view: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const size = view === ROOM ? this.#roomSize : this.#previewSize;
    const renderer = view === ROOM ? this.#renderer : this.#previewRenderer;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
    const ratioChanged = renderer.getPixelRatio() !== ratio;
    if (!ratioChanged && size.x === width && size.y === height) return;
    renderer.setDrawingBufferSize(width, height, ratio);
    size.set(width, height);
    const aspect = width / height;
    if (view === ROOM) {
      this.#overlay.width = renderer.domElement.width;
      this.#overlay.height = renderer.domElement.height;
      const changed = aspect !== this.#camera.aspect;
      this.#camera.aspect = aspect;
      if (changed && this.#positions.length) this.#frameShelf(false);
      else this.#camera.updateProjectionMatrix();
      this.#updateHover();
    } else {
      const camera = this.#previewCamera;
      const tangent = Math.tan(MathUtils.degToRad(camera.fov * 0.5));
      const distance = 0.25 + Math.max(0.59, 0.44 / aspect) / tangent;
      camera.aspect = aspect;
      camera.position.set(0, 0.51, distance);
      camera.lookAt(0, 0.47, 0);
      camera.updateProjectionMatrix();
    }
    this.#invalidate(view === ROOM ? ROOM | FEEDBACK : PREVIEW);
  }

  #invalidate(view: number): void {
    this.#dirty |= view;
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#render);
  }

  #render = (): void => {
    this.#frame = 0;
    const dirty = this.#dirty;
    this.#dirty = 0;
    if (dirty & ROOM) {
      this.#updateShelfVisibility();
      this.#renderer.render(this.#room, this.#camera);
    }
    if (dirty & PREVIEW) this.#previewRenderer.render(this.#preview, this.#previewCamera);
    if (dirty & FEEDBACK) this.#renderFeedback();
  };

  #renderFeedback(): void {
    const { width, height } = this.#overlay;
    this.#overlayContext.clearRect(0, 0, width, height);
    if (this.#hoverIndex !== null) this.#drawFeedback(this.#hoverIndex, HOVER_Z, 1, CORNERS, '#ffdf9d');
    if (this.#focusIndex !== null) this.#drawFeedback(this.#focusIndex, FOCUS_Z, 1.045, CORNERS, '#fff4e1');
    for (const [index, mark] of this.#marks) {
      this.#drawFeedback(index, MARK_Z, 1, MARK_SHAPES[mark], mark === 'wrong' ? '#f18a73' : '#8ce1b8');
    }
  }

  #drawFeedback(index: number, z: number, scale: number, shape: readonly number[], color: string): void {
    if (this.#camera.position.z <= z) return;
    const { x, y } = this.#positions[index];
    const m = this.#clipFromWorld.elements;
    const baseX = m[0] * x + m[4] * y + m[8] * z + m[12];
    const baseY = m[1] * x + m[5] * y + m[9] * z + m[13];
    const baseZ = m[2] * x + m[6] * y + m[10] * z + m[14];
    const baseW = m[3] * x + m[7] * y + m[11] * z + m[15];
    const halfWidth = this.#overlay.width * 0.5;
    const halfHeight = this.#overlay.height * 0.5;
    const context = this.#overlayContext;
    const points = this.#projectedQuad;
    let visible = false;
    context.beginPath();
    for (let i = 0; i < shape.length; i += 8) {
      // If all four projected corners are outside the same viewport edge,
      // skip the quad. The canvas clips polygons that cross a viewport edge.
      let outside = 15;
      let j = 0;
      for (; j < 8; j += 2) {
        const ox = shape[i + j] * scale;
        const oy = shape[i + j + 1] * scale;
        const w = baseW + m[3] * ox + m[7] * oy;
        const depth = baseZ + m[2] * ox + m[6] * oy;
        if (!(w > 0 && Math.abs(depth) <= w)) break;
        const px = (baseX + m[0] * ox + m[4] * oy) / w;
        const py = (baseY + m[1] * ox + m[5] * oy) / w;
        outside &= (px < -1 ? 1 : 0) | (px > 1 ? 2 : 0) | (py < -1 ? 4 : 0) | (py > 1 ? 8 : 0);
        points[j] = (1 + px) * halfWidth;
        points[j + 1] = (1 - py) * halfHeight;
      }
      if (j !== 8 || outside) continue;
      context.moveTo(points[0], points[1]);
      context.lineTo(points[2], points[3]);
      context.lineTo(points[4], points[5]);
      context.lineTo(points[6], points[7]);
      context.closePath();
      visible = true;
    }
    if (visible) {
      context.fillStyle = color;
      context.fill();
    }
  }
}

class CollectorSet {
  readonly root = new Group();
  readonly #box = new BoxGeometry(1, 1, 1);
  readonly #plane = new PlaneGeometry(1, 1);
  readonly #shelf = new Group();
  readonly #finish = {
    plaster: paint(0xd7c2a9), wing: paint(0xd9c9b4), floor: paint(0xa4775b), darkWood: paint(0x6e4233),
    wood: paint(0xa26c4c), shelf: paint(0xc7986e), backing: paint(0xaa7458),
    recess: paint(0x98674e), inlay: paint(0xe0b481), brass: paint(0xb98953),
  };
  readonly #wall = new Mesh(this.#box, this.#finish.plaster);
  readonly #floor = new Mesh(this.#box, this.#finish.floor);
  readonly #skirting = new Mesh(this.#box, this.#finish.wood);
  readonly #rug = new Mesh(this.#plane, new MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
  readonly #plinthShade = new MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, toneMapped: false });
  readonly #plant = this.#makePlant();
  readonly #wing = new Group();
  readonly #wingPanels = Array.from({ length: 4 }, () => new Mesh(this.#box, this.#finish.wing));
  readonly #wingSkirting = new Mesh(this.#box, this.#finish.wood);
  readonly #window = this.#makeWindow();
  readonly #bench = this.#makeBench();
  readonly #sunPatch = new Mesh(this.#plane, new MeshBasicMaterial({
    map: sunTexture(), color: 0xffdcb5, opacity: 0.28, blending: AdditiveBlending,
    side: BackSide, transparent: true, depthWrite: false, toneMapped: false,
  }));

  constructor() {
    this.#wing.rotation.y = -WING_ANGLE;
    this.#wing.add(...this.#wingPanels, this.#wingSkirting, this.#window);
    this.#sunPatch.matrixAutoUpdate = false;
    this.root.add(this.#wall, this.#wing, this.#floor, this.#skirting, this.#rug, this.#shelf,
      this.#plant, this.#bench, this.#sunPatch);
    this.#rug.rotation.x = -Math.PI / 2;
  }

  arrange(width: number, rows: number, columns: number): void {
    const height = rows * ROW_PITCH;
    const end = width * 0.5;
    const wallHeight = height + 15;
    const left = -end - 17.5;
    const right = end + 0.52;
    this.#wall.position.set((left + right + 0.08) * 0.5, wallHeight * 0.5, -0.83);
    this.#wall.scale.set(right - left + 0.08, wallHeight, 0.20);
    this.#floor.position.set(0, -0.06, 15);
    this.#floor.scale.set(width + 35, 0.12, 32);
    this.#skirting.position.set((left + right) * 0.5, 0.105, -0.70);
    this.#skirting.scale.set(right - left, 0.21, 0.12);
    this.#arrangeWindow(right, wallHeight, 2.90 + height * 0.165, 1 + (rows - 10) * 0.02);
    this.#rug.scale.set(width * 0.87 + 0.45, 3.1, 1);
    this.#rug.position.set(0, 0.006, 2.44);
    this.#plant.position.set(-end - 2.25, 0, -0.01);
    this.#plant.scale.setScalar(1 + height * 0.036);
    this.#bench.position.set(-end - 1.14, 0, 0.27);

    const shelf = this.#shelf;
    for (const child of shelf.children) if (child instanceof InstancedMesh) child.dispose();
    shelf.clear();
    const finish = this.#finish;
    const pieces = new Map<Material, Matrix4[]>();
    const stamp = new Object3D();
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: Material) => {
      stamp.position.set(x, y, z);
      stamp.scale.set(w, h, d);
      stamp.updateMatrix();
      let matrices = pieces.get(material);
      if (!matrices) pieces.set(material, matrices = []);
      matrices.push(stamp.matrix.clone());
    };

    box(0, (height + BOTTOM_TIER) * 0.5, -0.57, width, height + BOTTOM_TIER, 0.16, finish.backing);
    for (let column = 1; column < columns; column++) {
      // Shallow seams suggest cubbies without hiding toys from an angled view.
      box((column - columns * 0.5) * COLUMN_PITCH, BOTTOM_TIER + height * 0.5, -0.482,
        0.028, height, 0.018, finish.recess);
    }
    for (const side of [-1, 1]) {
      box(side * end, BOTTOM_TIER + height * 0.5 - 0.04, -0.074, 0.13, height, 0.99, finish.wood);
      box(side * (end + 0.007), BOTTOM_TIER + height * 0.5 - 0.04, SHELF_EDGE, 0.075, height, 0.04, finish.inlay);
    }
    for (let row = 0; row <= rows; row++) {
      const y = BOTTOM_TIER + row * ROW_PITCH;
      box(0, y - 0.053, -0.073, width + 0.09, 0.106, 0.97, finish.shelf);
      box(0, y - 0.067, SHELF_EDGE, width + 0.11, 0.077, 0.024, finish.darkWood);
      box(0, y - 0.020, SHELF_EDGE, width + 0.11, 0.018, 0.022, finish.inlay);
    }
    box(0, BOTTOM_TIER + height + 0.05, -0.067, width + 0.35, 0.10, 1.04, finish.wood);
    box(0, 0.095, -0.066, width + 0.30, 0.19, 0.98, finish.darkWood);
    box(0, 0.383, -0.072, width + 0.20, 0.466, 0.93, finish.wood);
    for (let column = 0; column < columns; column += 2) {
      const x = (column - (columns - 2) * 0.5) * COLUMN_PITCH;
      box(x, 0.37, 0.40, COLUMN_PITCH * 1.87, 0.35, 0.045, finish.shelf);
      box(x, 0.43, SHELF_EDGE, 0.24, 0.039, 0.05, finish.brass);
    }
    for (const [material, matrices] of pieces) {
      const batch = new InstancedMesh(this.#box, material, matrices.length);
      for (let index = 0; index < matrices.length; index++) batch.setMatrixAt(index, matrices[index]);
      shelf.add(batch);
    }

    const shadows = new InstancedMesh(this.#plane, this.#plinthShade, columns * rows);
    stamp.rotation.x = -Math.PI / 2;
    stamp.scale.set(0.83, 0.67, 1);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        stamp.position.set((column - (columns - 1) * 0.5) * COLUMN_PITCH, BOTTOM_TIER + row * ROW_PITCH + 0.002, 0.003);
        stamp.updateMatrix();
        shadows.setMatrixAt(row * columns + column, stamp.matrix);
      }
    }
    shelf.add(shadows);
  }

  #arrangeWindow(hingeX: number, wallHeight: number, centerY: number, scale: number): void {
    const hingeZ = -0.73;
    const wingLength = 21;
    const width = WINDOW_WIDTH * scale;
    const height = WINDOW_HEIGHT * scale;
    const left = WINDOW_OFFSET - width * 0.5;
    const right = WINDOW_OFFSET + width * 0.5;
    const bottom = centerY - height * 0.5;
    const top = centerY + height * 0.5;
    this.#wing.position.set(hingeX, 0, hingeZ);
    this.#window.position.set(WINDOW_OFFSET, centerY, 0);
    this.#window.scale.setScalar(scale);
    const panels = [
      [left * 0.5, wallHeight * 0.5, left, wallHeight],
      [(right + wingLength) * 0.5, wallHeight * 0.5, wingLength - right, wallHeight],
      [WINDOW_OFFSET, bottom * 0.5, width, bottom],
      [WINDOW_OFFSET, (top + wallHeight) * 0.5, width, wallHeight - top],
    ];
    for (let i = 0; i < this.#wingPanels.length; i++) {
      const [x, y, width, height] = panels[i];
      this.#wingPanels[i].position.set(x, y, -0.10);
      this.#wingPanels[i].scale.set(width, height, 0.20);
    }
    this.#wingSkirting.position.set(wingLength * 0.5, 0.105, 0.03);
    this.#wingSkirting.scale.set(wingLength, 0.21, 0.12);

    // Project the opening along the sun rays onto the floor. The texture carries
    // the soft shadows of the jambs and muntins; no shadow maps or toy casters.
    const dropX = -SUN_X / SUN_Y;
    const dropZ = -SUN_Z / SUN_Y;
    const centerX = hingeX + WINDOW_OFFSET * WING_COS + centerY * dropX;
    const centerZ = hingeZ + WINDOW_OFFSET * WING_SIN + centerY * dropZ;
    this.#sunPatch.matrix.set(
      width * WING_COS, height * dropX, 0, centerX,
      0, 0, -1, 0.012,
      width * WING_SIN, height * dropZ, 0, centerZ,
      0, 0, 0, 1,
    );
    this.#sunPatch.matrixWorldNeedsUpdate = true;
  }

  #addBox(parent: Group, x: number, y: number, z: number, w: number, h: number, d: number, material: Material): void {
    const mesh = new Mesh(this.#box, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
  }

  #makePlant(): Group {
    const plant = new Group();
    const clay = paint(0xb56d56);
    const rim = paint(0xcf8f70);
    const vessel = new Mesh(new CylinderGeometry(0.33, 0.22, 0.51, 24), clay);
    const lip = new Mesh(new CylinderGeometry(0.355, 0.346, 0.075, 24), rim);
    const soil = new Mesh(new CylinderGeometry(0.306, 0.306, 0.025, 24), paint(0x573928));
    vessel.position.y = 0.255;
    lip.position.y = 0.515;
    soil.position.y = 0.553;
    plant.add(vessel, lip, soil);

    const leaves = new SphereGeometry(0.5, 14, 9);
    const stem = new CylinderGeometry(0.018, 0.023, 1, 6);
    const greens = [paint(0x526346), paint(0x657d4e), paint(0x7f8c56)];
    const panicles = [
      [-0.37, 1.14, -0.10], [0.36, 1.23, 0.04], [0.18, 1.48, 0.24],
      [-0.28, 1.67, 0.16], [0.42, 1.79, -0.10], [-0.42, 1.88, -0.14],
      [0.04, 2.11, 0],
    ];
    const up = new Vector3(0, 1, 0);
    const tip = new Vector3();
    for (let i = 0; i < panicles.length; i++) {
      const [x, y, z] = panicles[i];
      const branch = new Mesh(stem, greens[0]);
      tip.set(x, y - 0.53, z);
      branch.scale.y = tip.length();
      branch.quaternion.setFromUnitVectors(up, tip.normalize());
      branch.position.set(x * 0.5, (y + 0.53) * 0.5, z * 0.5);
      const leaf = new Mesh(leaves, greens[i % greens.length]);
      leaf.position.set(x * 1.23, y + 0.13, z);
      leaf.rotation.set(-0.31 + z, x * 0.8, -x * 2.29 + 0.08);
      leaf.scale.set(0.28, 0.53 - i * 0.018, 0.08);
      plant.add(branch, leaf);
    }
    return plant;
  }

  #makeWindow(): Group {
    const window = new Group();
    const casing = paint(0xe9d6bb);
    const jamb = paint(0xcbb08a);
    const sash = paint(0xe0c79f);
    const halfWidth = WINDOW_WIDTH * 0.5;
    const halfHeight = WINDOW_HEIGHT * 0.5;
    const sky = new Mesh(new PlaneGeometry(WINDOW_WIDTH, WINDOW_HEIGHT),
      new MeshBasicMaterial({ map: windowTexture(), toneMapped: false }));
    sky.position.z = -0.195;
    window.add(sky);
    for (const side of [-1, 1]) {
      this.#addBox(window, side * (halfWidth - 0.024), 0, -0.087, 0.078, WINDOW_HEIGHT, 0.21, jamb);
      this.#addBox(window, 0, side * (halfHeight - 0.024), -0.087, WINDOW_WIDTH, 0.078, 0.21, jamb);
      this.#addBox(window, side * (halfWidth + 0.046), 0, 0.037, 0.13, WINDOW_HEIGHT + 0.24, 0.077, casing);
      this.#addBox(window, side * WINDOW_WIDTH / 6, 0, -0.11, 0.067, WINDOW_HEIGHT, 0.087, sash);
    }
    this.#addBox(window, 0, halfHeight + 0.050, 0.037, WINDOW_WIDTH + 0.21, 0.13, 0.077, casing);
    this.#addBox(window, 0, WINDOW_TRANSOM, -0.11, WINDOW_WIDTH, 0.070, 0.087, sash);
    this.#addBox(window, 0, -halfHeight - 0.031, 0.060, WINDOW_WIDTH + 0.30, 0.090, 0.390, casing);
    this.#addBox(window, 0, -halfHeight - 0.119, 0.034, WINDOW_WIDTH + 0.10, 0.103, 0.09, jamb);
    return window;
  }

  #makeBench(): Group {
    const bench = new Group();
    const wood = this.#finish.wood;
    this.#addBox(bench, 0, 0.47, 0, 1.38, 0.11, 0.61, wood);
    for (const x of [-0.51, 0.51]) {
      for (const z of [-0.21, 0.21]) this.#addBox(bench, x, 0.217, z, 0.079, 0.434, 0.079, wood);
    }
    this.#addBox(bench, 0, 0.185, 0, 1.04, 0.064, 0.069, this.#finish.darkWood);
    const books = [paint(0x6d8376), paint(0xd5a66f), paint(0xa5554c)];
    for (let i = 0; i < books.length; i++) {
      const book = new Group();
      book.position.set(0.13 + i * 0.025, 0.53 + i * 0.083, 0.03);
      book.rotation.y = (i - 1) * 0.14;
      this.#addBox(book, 0, 0.041, 0, 0.55 - i * 0.045, 0.082, 0.38, books[i]);
      this.#addBox(book, 0, 0.041, 0.192, 0.49 - i * 0.045, 0.051, 0.008, this.#finish.inlay);
      bench.add(book);
    }
    return bench;
  }
}

function makeRenderer(transparent: boolean): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: transparent });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  return renderer;
}

function displayLight(scene: Scene): void {
  scene.add(new HemisphereLight(0xf7faff, 0xddd1c3, 1.85));
  const fill = new DirectionalLight(0xfffbf5, 2.04);
  fill.position.set(-2.6, 4.5, 8);
  const bounce = new DirectionalLight(0xe9f0ff, 0.52);
  bounce.position.set(4, 1.5, 5);
  scene.add(fill, bounce);
}

function paint(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.84 });
}

// Each shape is a list of quads in the toy's local XY plane.

function quad(vertices: number[], x1: number, y1: number, x2: number, y2: number): void {
  vertices.push(x1, y1, x2, y1, x2, y2, x1, y2);
}

function corners(): number[] {
  const vertices: number[] = [];
  const thickness = 0.039;
  const leg = 0.145;
  for (const x of [-0.41, 0.41 - thickness]) {
    for (const y of [-0.025, 1.055 - thickness]) {
      const bottom = y < 0;
      const start = x < 0 ? x : x + thickness - leg;
      quad(vertices, start, y, start + leg, y + thickness);
      quad(vertices, x, bottom ? y + thickness : y + thickness - leg, x + thickness, bottom ? y + leg : y);
    }
  }
  return vertices;
}

function stroke(vertices: number[], x1: number, y1: number, x2: number, y2: number): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const dx = (y2 - y1) * 0.021 / length;
  const dy = (x1 - x2) * 0.021 / length;
  vertices.push(x1 + dx, y1 + dy, x2 + dx, y2 + dy, x2 - dx, y2 - dy, x1 - dx, y1 - dy);
}

function markShape(mark: Mark): number[] {
  const vertices: number[] = [];
  quad(vertices, -0.39, -0.091, 0.39, -0.036);
  if (mark === 'wrong') {
    stroke(vertices, 0.32, 0.12, 0.46, 0.26);
    stroke(vertices, 0.32, 0.26, 0.46, 0.12);
  } else {
    stroke(vertices, 0.29, 0.18, 0.36, 0.11);
    stroke(vertices, 0.36, 0.11, 0.50, 0.28);
  }
  return vertices;
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create room textures');
  draw(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function contactTexture(): CanvasTexture {
  return canvasTexture(64, 64, (context) => {
    const shade = context.createRadialGradient(32, 32, 4, 32, 32, 32);
    shade.addColorStop(0, 'rgba(56, 27, 17, 0.56)');
    shade.addColorStop(0.55, 'rgba(56, 27, 17, 0.24)');
    shade.addColorStop(1, 'rgba(56, 27, 17, 0)');
    context.fillStyle = shade;
    context.fillRect(0, 0, 64, 64);
  });
}

function rugTexture(): CanvasTexture {
  return canvasTexture(512, 192, (context) => {
    context.fillStyle = '#5b6250';
    context.fillRect(0, 0, 512, 192);
    context.fillStyle = '#85886a';
    context.fillRect(8, 12, 496, 168);
    context.strokeStyle = '#d4bd94';
    context.lineWidth = 2;
    context.strokeRect(15, 23, 482, 146);
    context.strokeRect(20, 29, 472, 134);
    context.strokeStyle = '#b4ab84';
    for (let x = 43; x <= 470; x += 38) {
      context.beginPath();
      context.moveTo(x - 9, 96);
      context.lineTo(x, 78);
      context.lineTo(x + 9, 96);
      context.lineTo(x, 114);
      context.closePath();
      context.stroke();
    }
    for (let x = 5; x < 512; x += 6) {
      context.fillStyle = x % 4 === 1 ? '#cab38a' : '#a29d78';
      context.fillRect(x, 0, 2, 9);
      context.fillRect(x, 183, 2, 9);
    }
  });
}

function windowTexture(): CanvasTexture {
  return canvasTexture(512, 400, (context) => {
    const sky = context.createLinearGradient(28, 0, 275, 275);
    sky.addColorStop(0, '#86b9d4');
    sky.addColorStop(0.58, '#bbd9e1');
    sky.addColorStop(1, '#f7e9cf');
    context.fillStyle = sky;
    context.fillRect(0, 0, 512, 400);

    for (const [x, y, width, height] of [
      [75, 98, 103, 19], [131, 87, 46, 16], [230, 143, 92, 18],
      [326, 116, 92, 16], [393, 104, 65, 18], [510, 161, 82, 17],
    ]) {
      context.save();
      context.translate(x, y);
      context.scale(width, height);
      const cloud = context.createRadialGradient(0, 0, 0.12, 0, 0, 1);
      cloud.addColorStop(0, 'rgba(255, 251, 238, .85)');
      cloud.addColorStop(1, 'rgba(255, 251, 238, 0)');
      context.fillStyle = cloud;
      context.fillRect(-1, -1, 2, 2);
      context.restore();
    }

    const ridge = (color: string | CanvasGradient, y: number, curves: number[][]) => {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(0, y);
      for (const [x1, y1, x2, y2, x, endY] of curves) context.bezierCurveTo(x1, y1, x2, y2, x, endY);
      context.lineTo(512, 400);
      context.lineTo(0, 400);
      context.fill();
    };
    ridge('#b5c5b6', 239, [[51, 197, 102, 193, 178, 219], [331, 270, 388, 156, 512, 206]]);
    ridge('#90aa9c', 252, [[103, 203, 132, 246, 230, 255], [350, 261, 401, 224, 512, 234]]);
    ridge('#739785', 280, [[112, 235, 165, 271, 260, 270], [361, 269, 422, 242, 512, 264]]);
    const meadow = context.createLinearGradient(0, 259, 0, 400);
    meadow.addColorStop(0, '#8eaa79');
    meadow.addColorStop(1, '#57745c');
    ridge(meadow, 304, [[83, 271, 139, 288, 223, 313], [331, 344, 388, 275, 512, 280]]);
    ridge('#75916a', 329, [[89, 291, 157, 315, 247, 345], [343, 377, 410, 318, 512, 324]]);
    ridge('#5c7d63', 366, [[92, 354, 182, 367, 255, 378], [335, 390, 440, 362, 512, 356]]);
  });
}

function sunTexture(): CanvasTexture {
  const width = 256;
  const height = 192;
  return canvasTexture(width, height, (context) => {
    const image = context.createImageData(width, height);
    const { data } = image;
    for (let row = 0; row < height; row++) {
      const y = (0.5 - (row + 0.5) / height) * WINDOW_HEIGHT;
      const sash = Math.min(WINDOW_HEIGHT * 0.5 - Math.abs(y) - 0.045, Math.abs(y - WINDOW_TRANSOM) - 0.010);
      for (let column = 0; column < width; column++) {
        const x = ((column + 0.5) / width - 0.5) * WINDOW_WIDTH;
        const reveal = WINDOW_WIDTH * 0.5 - Math.abs(x) - 0.045;
        const muntin = Math.abs(Math.abs(x) - WINDOW_WIDTH / 6) - 0.010;
        const feather = MathUtils.smoothstep(Math.min(reveal, sash, muntin), 0, 0.085);
        const i = 4 * (row * width + column);
        data[i] = data[i + 1] = data[i + 2] = 255;
        data[i + 3] = 255 * feather;
      }
    }
    context.putImageData(image, 0, 0);
  });
}
