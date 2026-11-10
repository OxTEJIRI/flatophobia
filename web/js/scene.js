// The flat world: a disc balanced on a pin, drawn with three.js.
import * as THREE from "../vendor/three.module.min.js";
import {
  SECTORS, RINGS, ringInner, ringOuter, sectorAngle, cellAt, cellCenter, ringOf,
  tiltOf, tiltDegrees, fallsOn, sectorOf, slideLine, RING_STEP,
} from "./rules.js";

const R = 5; // disc radius in world units
const LIME = 0xcfef5b, CREAM = 0xede4cf, DANGER = 0xff5a36, ICE = 0xbfe3ff;
const OTHER_COLORS = [0xede4cf, 0x9fd3ff, 0xff9b73, 0xc5a3ff, 0xffd166, 0x7fe0c4, 0xf7a1c4, 0xb8c4a0];

const boardToLocal = (x, y, h = 0) => new THREE.Vector3(x * R, h, -y * R);

function colorFor(owner) {
  let h = 0;
  for (let i = 2; i < owner.length; i++) h = (h * 31 + owner.charCodeAt(i)) >>> 0;
  return OTHER_COLORS[h % OTHER_COLORS.length];
}

function drawMap(land, size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const H = size / 2;
  const P = (x, y) => [H + x * H, H + y * H]; // land data: y points down
  const B = (r, a) => [H + Math.cos(a) * r * H, H - Math.sin(a) * r * H]; // board: angle ccw from east

  const ocean = g.createRadialGradient(H, H, 0, H, H, H);
  ocean.addColorStop(0, "#1d1f15");
  ocean.addColorStop(0.75, "#15160f");
  ocean.addColorStop(1, "#0f100b");
  g.fillStyle = ocean;
  g.beginPath(); g.arc(H, H, H, 0, Math.PI * 2); g.fill();

  // faint latitude/longitude graticule
  g.strokeStyle = "rgba(237,228,207,0.05)";
  g.lineWidth = 1.5;
  for (let lat = 60; lat > -90; lat -= 30) { g.beginPath(); g.arc(H, H, ((90 - lat) / 180) * H, 0, Math.PI * 2); g.stroke(); }

  // ice wall band
  g.fillStyle = "rgba(191,227,255,0.07)";
  g.beginPath(); g.arc(H, H, ringOuter(RINGS) * H, 0, Math.PI * 2); g.arc(H, H, ringInner(RINGS) * H, 0, Math.PI * 2, true); g.fill();

  // land
  g.lineJoin = "round";
  for (const ring of land) {
    g.beginPath();
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = P(ring[i], ring[i + 1]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    const far = Math.hypot(ring[0], ring[1]) > 0.8;
    g.fillStyle = far ? "rgba(214,236,255,0.22)" : "rgba(237,228,207,0.15)";
    g.fill("evenodd"); // antarctica wraps the pole: even-odd keeps the fill to the rim band
    g.strokeStyle = far ? "rgba(214,236,255,0.6)" : "rgba(237,228,207,0.5)";
    g.lineWidth = 2;
    g.stroke();
  }

  // the board: ring bands and sector spokes
  g.strokeStyle = "rgba(237,228,207,0.22)";
  g.lineWidth = 2.5;
  for (let k = 1; k <= RINGS; k++) {
    g.beginPath(); g.arc(H, H, ringInner(k) * H, 0, Math.PI * 2); g.stroke();
  }
  g.beginPath(); g.arc(H, H, ringOuter(RINGS) * H, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = "rgba(237,228,207,0.13)";
  g.lineWidth = 2;
  for (let s = 0; s < SECTORS; s++) {
    const a = (s * Math.PI * 2) / SECTORS;
    const [x0, y0] = B(ringInner(1), a), [x1, y1] = B(ringOuter(RINGS), a);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }

  // ring multipliers along the bottom, readable from the default camera
  g.fillStyle = "rgba(207,239,91,0.85)";
  g.font = `600 ${Math.round(size / 52)}px "JetBrains Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let k = 1; k <= RINGS; k++) {
    const [x, y] = B(k * 0.18, -Math.PI / 2 - 0.02);
    g.fillText(`×${k}`, x, y);
  }

  // the pole
  g.fillStyle = "#0e0e0b";
  g.beginPath(); g.arc(H, H, ringInner(1) * H * 0.92, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(207,239,91,0.7)";
  g.lineWidth = 3;
  g.beginPath(); g.arc(H, H, ringInner(1) * H * 0.92, 0, Math.PI * 2); g.stroke();

  // rim
  const rim = g.createRadialGradient(H, H, H * 0.965, H, H, H);
  rim.addColorStop(0, "rgba(230,244,255,0)");
  rim.addColorStop(1, "rgba(230,244,255,0.55)");
  g.fillStyle = rim;
  g.beginPath(); g.arc(H, H, H, 0, Math.PI * 2); g.fill();
  return c;
}

function makePawnGeometry() {
  const body = new THREE.ConeGeometry(0.15, 0.36, 18);
  body.translate(0, 0.18, 0);
  const head = new THREE.SphereGeometry(0.1, 16, 12);
  head.translate(0, 0.41, 0);
  return { body, head };
}

export class World {
  constructor(canvas, land) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0e0b);
    this.scene.fog = new THREE.Fog(0x0e0e0b, 22, 48);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.view = { azimuth: 0, polar: 0.92, radius: 15.5, target: new THREE.Vector3(0, -0.4, 0) };

    // light
    this.scene.add(new THREE.HemisphereLight(0xfff6e0, 0x101008, 0.32));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.25);
    sun.position.set(-6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 40 });
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    const rimLight = new THREE.DirectionalLight(LIME, 0.6);
    rimLight.position.set(5, -2, -10);
    this.scene.add(rimLight);

    // the pin and the column it stands on
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.55, 14, 24),
      new THREE.MeshStandardMaterial({ color: 0x2a2a22, roughness: 0.6, metalness: 0.3 }),
    );
    column.position.y = -7.2;
    this.scene.add(column);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.6 }));
    tip.position.y = -0.18;
    this.scene.add(tip);
    const glow = new THREE.PointLight(LIME, 6, 9, 2);
    glow.position.set(0, -1.6, 0);
    this.scene.add(glow);

    // dust falling into the void
    const dustGeo = new THREE.BufferGeometry();
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 22;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = -Math.random() * 30 + 4; pos[i * 3 + 2] = Math.sin(a) * r;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: CREAM, size: 0.05, transparent: true, opacity: 0.35, depthWrite: false }));
    this.scene.add(this.dust);

    // tilting world
    this.world = new THREE.Group();
    this.scene.add(this.world);

    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.97, 0.34, 128, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x24241b, roughness: 0.85, side: THREE.DoubleSide }),
    );
    side.position.y = -0.17;
    side.receiveShadow = true;
    this.world.add(side);
    const under = new THREE.Mesh(new THREE.CircleGeometry(R * 0.97, 96), new THREE.MeshStandardMaterial({ color: 0x16160f, roughness: 1 }));
    under.rotation.x = Math.PI / 2;
    under.position.y = -0.34;
    this.world.add(under);

    const tex = new THREE.CanvasTexture(drawMap(land, 2048));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const topGeo = new THREE.CircleGeometry(R, 160);
    topGeo.rotateX(-Math.PI / 2);
    this.top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0.0, emissive: LIME, emissiveIntensity: 0 }));
    this.top.receiveShadow = true;
    this.world.add(this.top);

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.26, 160, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe6f4ff, emissive: ICE, emissiveIntensity: 0.15, transparent: true, opacity: 0.5, side: THREE.DoubleSide, roughness: 0.3 }),
    );
    wall.position.y = 0.13;
    this.world.add(wall);

    // danger zone: the strip of the low side beyond the slide line, where settlers would fall now
    this.danger = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: DANGER, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.danger.rotation.x = -Math.PI / 2;
    this.danger.position.y = 0.006;
    this.world.add(this.danger);
    this.dangerLine = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.05),
      new THREE.MeshBasicMaterial({ color: DANGER, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.dangerLine.rotation.x = -Math.PI / 2;
    this.dangerLine.position.y = 0.008;
    this.world.add(this.dangerLine);
    this.dangerOpacity = 0;

    // lean arrows (current, and predicted while hovering)
    this.arrow = this._makeArrow(DANGER, 0.85);
    this.ghostArrow = this._makeArrow(LIME, 0.6);
    this.world.add(this.arrow, this.ghostArrow);

    // hover + selected cell
    this.hoverMesh = this._cellMesh(LIME, 0.22);
    this.selMesh = this._cellMesh(LIME, 0.5);
    this.world.add(this.hoverMesh, this.selMesh);

    this.pawnGeo = makePawnGeometry();
    this.pawns = new Map(); // key -> pawn
    this.ghost = this._makePawn(LIME, true);
    this.ghost.visible = false;
    this.world.add(this.ghost);

    this.tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 }; // degrees as a 2D vector (board coords)
    this.settlers = [];
    this.me = "";
    this.hover = -1;
    this.selected = -1;
    this.mode = "live"; // live | tipping
    this.flatGlow = 0;
    this.labels = [];
    this.labelLayer = null;
    this.onPick = null;
    this.onHover = null;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---------------------------------------------------------------- building blocks
  _cellMesh(color, opacity) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.position.y = 0.012;
    m.visible = false;
    m.userData.cell = -1;
    return m;
  }

  _setCellMesh(mesh, cell) {
    if (cell < 0) { mesh.visible = false; mesh.userData.cell = -1; return; }
    if (mesh.userData.cell !== cell) {
      const ring = ringOf(cell), s = sectorOf(cell);
      const g = new THREE.RingGeometry(ringInner(ring) * R, ringOuter(ring) * R, 10, 1, (s * Math.PI * 2) / SECTORS, (Math.PI * 2) / SECTORS);
      g.rotateX(-Math.PI / 2);
      mesh.geometry.dispose();
      mesh.geometry = g;
      mesh.userData.cell = cell;
    }
    mesh.visible = true;
  }

  _makeArrow(color, opacity) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.09); shape.lineTo(0.75, -0.09); shape.lineTo(0.75, -0.24); shape.lineTo(1.1, 0);
    shape.lineTo(0.75, 0.24); shape.lineTo(0.75, 0.09); shape.lineTo(0, 0.09); shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.position.y = 0.02;
    m.visible = false;
    return m;
  }

  _placeArrow(arrow, t) {
    const mag = Math.hypot(t[0], t[1]);
    if (mag < 1) { arrow.visible = false; return; }
    const a = Math.atan2(t[1], t[0]);
    arrow.visible = true;
    arrow.rotation.y = a; // shape points +x; rotation about y turns +x toward -z (= board +y) for positive a
    const len = 0.9 + Math.min(2.2, tiltDegrees(t) / 7);
    arrow.scale.set(len, 1, 1.2);
    arrow.position.set(Math.cos(a) * 0.55, 0.02, -Math.sin(a) * 0.55);
  }

  _makePawn(color, ghost = false) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, emissive: color, emissiveIntensity: ghost ? 0.4 : 0.06, transparent: ghost, opacity: ghost ? 0.45 : 1 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.pawnGeo.body, mat);
    const head = new THREE.Mesh(this.pawnGeo.head, mat);
    body.castShadow = head.castShadow = !ghost;
    g.add(body, head);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.24, 24), new THREE.MeshBasicMaterial({ color: DANGER, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.01;
    g.add(halo);
    g.userData = { mat, halo, ghost };
    return g;
  }

  // ---------------------------------------------------------------- public api
  /** settlers: [{key, owner, cell}] in drop order. */
  setSettlers(list, me = "") {
    this.me = (me || "").toLowerCase();
    this.settlers = list;
    const seen = new Set();
    const perCell = new Map();
    for (const s of list) {
      seen.add(s.key);
      const slot = perCell.get(s.cell) || 0;
      perCell.set(s.cell, slot + 1);
      let p = this.pawns.get(s.key);
      if (!p) {
        const mine = this.me && s.owner.toLowerCase() === this.me;
        p = this._makePawn(mine ? LIME : colorFor(s.owner));
        p.userData.mine = mine;
        p.userData.dropT = 0;
        p.userData.state = "drop";
        this.world.add(p);
        this.pawns.set(s.key, p);
        this.kick(s.cell);
      }
      const [x, y] = cellCenter(s.cell);
      const off = slot === 0 ? [0, 0] : [Math.cos(slot * 2.4) * 0.16 * Math.min(slot, 3), Math.sin(slot * 2.4) * 0.16 * Math.min(slot, 3)];
      p.userData.home = boardToLocal(x + off[0] / R, y + off[1] / R);
      p.userData.cell = s.cell;
      if (p.userData.state !== "drop") p.position.copy(p.userData.home);
    }
    for (const [key, p] of this.pawns) {
      if (!seen.has(key)) { this.world.remove(p); this.pawns.delete(key); }
    }
    if (this.mode === "live") this._retarget();
  }

  clear() {
    for (const p of this.pawns.values()) this.world.remove(p);
    this.pawns.clear();
    this.settlers = [];
    this.mode = "live";
    this.flatGlow = 0;
    this._retarget();
  }

  setHover(cell) {
    this.hover = cell;
    this._setCellMesh(this.hoverMesh, cell);
    if (cell >= 0 && this.mode === "live") {
      const [x, y] = cellCenter(cell);
      this.ghost.position.copy(boardToLocal(x, y));
      this.ghost.visible = true;
      this._placeArrow(this.ghostArrow, tiltOf([...this.settlers, { cell }]));
    } else {
      this.ghost.visible = false;
      this.ghostArrow.visible = false;
    }
  }

  setSelected(cell) {
    this.selected = cell;
    this._setCellMesh(this.selMesh, cell);
  }

  /** A little wobble toward a cell, as if something landed there. */
  kick(cell) {
    const [x, y] = cellCenter(cell);
    this.tilt.vx += x * 9;
    this.tilt.vy += y * 9;
  }

  _retarget() {
    const t = tiltOf(this.settlers);
    const deg = tiltDegrees(t);
    const m = Math.hypot(t[0], t[1]);
    this.tilt.tx = m ? (t[0] / m) * deg : 0;
    this.tilt.ty = m ? (t[1] / m) * deg : 0;
    this._placeArrow(this.arrow, t);
    // danger zone beyond the slide line, and halos
    const line = slideLine(t) * RING_STEP; // as a fraction of the disc radius
    const showZone = m > 0 && line < 0.99;
    this.dangerTarget = showZone ? 0.2 : 0;
    if (showZone) {
      const alpha = Math.acos(line);
      const shape = new THREE.Shape();
      shape.moveTo(line * R, -Math.sin(alpha) * R);
      shape.absarc(0, 0, R * 0.995, -alpha, alpha, false);
      shape.lineTo(line * R, -Math.sin(alpha) * R);
      this.danger.geometry.dispose();
      this.danger.geometry = new THREE.ShapeGeometry(shape, 48);
      const a = Math.atan2(t[1], t[0]);
      this.danger.rotation.z = a;
      // the slide line itself
      const half = Math.sin(alpha) * R;
      this.dangerLine.scale.set(half * 2, 1, 1);
      this.dangerLine.position.set(Math.cos(a) * line * R, 0.008, -Math.sin(a) * line * R);
      this.dangerLine.rotation.set(-Math.PI / 2, 0, a + Math.PI / 2);
    }
    for (const p of this.pawns.values()) {
      p.userData.inDanger = m >= 1 && fallsOn(p.userData.cell, t);
    }
    if (this.hover >= 0) this.setHover(this.hover);
  }

  /**
   * Play the end of a round. result: {outcome:1|2|3, tilt:[x,y], fallenKeys:Set, payouts: Map key->label}
   */
  tip(result) {
    this.mode = "tipping";
    this.arrow.visible = false;
    this.ghostArrow.visible = false;
    this.ghost.visible = false;
    this.dangerTarget = 0;
    const t = result.tilt;
    const m = Math.hypot(t[0], t[1]);
    if (result.outcome === 1 && m > 0) {
      this.tilt.tx = (t[0] / m) * 24;
      this.tilt.ty = (t[1] / m) * 24;
    } else {
      this.tilt.tx = this.tilt.ty = 0;
    }
    if (result.outcome === 2) this.flatGlow = 1;
    const dirLocal = m ? new THREE.Vector3(t[0] / m, 0, -t[1] / m) : new THREE.Vector3();
    let i = 0;
    for (const [key, p] of this.pawns) {
      p.userData.halo.material.opacity = 0;
      if (result.fallenKeys.has(key)) {
        p.userData.state = "slide";
        p.userData.t = -0.35 - i * 0.05;
        p.userData.dir = dirLocal.lengthSq() ? dirLocal.clone() : p.userData.home.clone().setY(0).normalize();
        p.userData.v = 0;
        i++;
      } else {
        p.userData.state = "hop";
        p.userData.t = 0;
      }
      const label = result.labels && result.labels.get(key);
      if (label) this.label(p, label.text, label.cls, 0.6 + Math.random() * 0.3);
    }
  }

  // floating DOM labels attached to 3D objects
  label(obj, text, cls = "", delay = 0) {
    if (!this.labelLayer) return;
    const el = document.createElement("div");
    el.className = `float-label ${cls}`;
    el.textContent = text;
    el.style.opacity = "0";
    this.labelLayer.appendChild(el);
    this.labels.push({ el, obj, born: performance.now() + delay * 1000, life: 3200 });
  }

  // ---------------------------------------------------------------- input
  _bindInput() {
    const el = this.canvas;
    let down = null;
    let pinch = null;
    el.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, az: this.view.azimuth, po: this.view.polar, moved: false, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (down && down.id === e.pointerId && !pinch) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 6) down.moved = true;
        if (down.moved) {
          this.view.azimuth = down.az - dx * 0.006;
          this.view.polar = Math.min(1.25, Math.max(0.35, down.po - dy * 0.004));
          this.setHover(-1);
          return;
        }
      }
      if (e.pointerType === "mouse") this._hoverAt(e.clientX, e.clientY);
    });
    el.addEventListener("pointerup", (e) => {
      if (down && !down.moved) {
        const cell = this._cellAtScreen(e.clientX, e.clientY);
        if (this.onPick) this.onPick(cell);
      }
      down = null;
    });
    el.addEventListener("pointerleave", () => { if (!down) { this.setHover(-1); if (this.onHover) this.onHover(-1); } });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.view.radius = Math.min(24, Math.max(9, this.view.radius * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: false });
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), r: this.view.radius };
        down = null;
      }
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (pinch && e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.view.radius = Math.min(24, Math.max(9, (pinch.r * pinch.d) / d));
      }
    }, { passive: true });
    el.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; });
  }

  _cellAtScreen(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.top, false)[0];
    if (!hit) return -1;
    const p = this.world.worldToLocal(hit.point.clone());
    return cellAt(p.x / R, -p.z / R);
  }

  _hoverAt(cx, cy) {
    if (this.mode !== "live") return;
    const cell = this._cellAtScreen(cx, cy);
    if (cell !== this.hover) {
      this.setHover(cell);
      if (this.onHover) this.onHover(cell);
    }
    this.canvas.style.cursor = cell >= 0 ? "pointer" : "grab";
  }

  // ---------------------------------------------------------------- loop
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole disc in view on tall phones
    this.fitBoost = w / h < 0.8 ? 1.45 : w / h < 1.1 ? 1.15 : 1;
    this.camera.updateProjectionMatrix();
  }

  _frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now();

    // camera
    const { azimuth, polar, radius, target } = this.view;
    const r = radius * (this.fitBoost || 1);
    this.camera.position.set(
      target.x + r * Math.sin(polar) * Math.sin(azimuth),
      target.y + r * Math.cos(polar),
      target.z + r * Math.sin(polar) * Math.cos(azimuth),
    );
    this.camera.lookAt(target);

    // tilt spring (board-space vector, degrees)
    const k = this.mode === "tipping" ? 26 : 14, c = this.mode === "tipping" ? 5 : 3.2;
    const T = this.tilt;
    T.vx += ((T.tx - T.x) * k - T.vx * c) * dt;
    T.vy += ((T.ty - T.y) * k - T.vy * c) * dt;
    T.x += T.vx * dt;
    T.y += T.vy * dt;
    const deg = Math.hypot(T.x, T.y);
    if (deg > 1e-4) {
      // tilt down toward (x, y): axis = up x dir
      const d = new THREE.Vector3(T.x / deg, 0, -T.y / deg);
      const axis = new THREE.Vector3(0, 1, 0).cross(d).normalize();
      this.world.quaternion.setFromAxisAngle(axis, (deg * Math.PI) / 180);
    } else {
      this.world.quaternion.identity();
    }

    // danger overlay fade
    this.dangerOpacity += ((this.dangerTarget || 0) - this.dangerOpacity) * Math.min(1, dt * 4);
    this.danger.material.opacity = this.dangerOpacity * (0.75 + 0.25 * Math.sin(now / 380));
    this.dangerLine.material.opacity = Math.min(1, this.dangerOpacity * 4.5);

    // flat-day glow
    if (this.flatGlow > 0) {
      this.top.material.emissiveIntensity = 0.25 * this.flatGlow * (0.6 + 0.4 * Math.sin(now / 160));
      this.flatGlow = Math.max(0, this.flatGlow - dt * 0.12);
    } else this.top.material.emissiveIntensity = 0;

    // pawns
    for (const p of this.pawns.values()) this._animatePawn(p, dt, now);
    if (this.ghost.visible) this.ghost.position.y = 0.05 + Math.sin(now / 200) * 0.04;

    // dust drifts down into the void
    const arr = this.dust.geometry.attributes.position.array;
    for (let i = 1; i < arr.length; i += 3) { arr[i] -= dt * 0.35; if (arr[i] < -26) arr[i] = 4; }
    this.dust.geometry.attributes.position.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
    this._updateLabels(now);
  }

  _animatePawn(p, dt, now) {
    const u = p.userData;
    if (u.state === "drop") {
      u.dropT += dt;
      const t = Math.min(1, u.dropT / 0.55);
      const bounce = t < 1 ? (1 - t) * (1 - t) * 4.5 : 0;
      p.position.set(u.home.x, u.home.y + bounce, u.home.z);
      const s = t < 1 ? 1 : 1 + Math.max(0, 0.25 - (u.dropT - 0.55) * 1.5) * Math.sin((u.dropT - 0.55) * 30);
      p.scale.set(s, 2 - s, s);
      if (u.dropT > 0.9) { u.state = "idle"; p.scale.set(1, 1, 1); }
    } else if (u.state === "idle") {
      p.position.copy(u.home);
      const pulse = u.inDanger ? 0.45 + 0.35 * Math.sin(now / 220) : 0;
      u.halo.material.opacity += (pulse - u.halo.material.opacity) * Math.min(1, dt * 6);
      if (u.mine) u.mat.emissiveIntensity = 0.25 + 0.15 * Math.sin(now / 400);
    } else if (u.state === "slide") {
      u.t += dt;
      if (u.t < 0) { p.position.copy(u.home); return; }
      u.v += dt * 9;
      p.position.addScaledVector(u.dir, u.v * dt);
      const rr = Math.hypot(p.position.x, p.position.z);
      p.rotation.z -= dt * 3;
      if (rr > R + 0.1) {
        // over the edge: hand over to world space and fall
        const wp = this.world.localToWorld(p.position.clone());
        this.world.remove(p);
        this.scene.add(p);
        p.position.copy(wp);
        u.state = "fall";
        u.vel = new THREE.Vector3(u.dir.x * u.v * 0.6, 1.2, u.dir.z * u.v * 0.6);
        u.spin = new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
        u.fallT = 0;
      }
    } else if (u.state === "fall") {
      u.fallT += dt;
      u.vel.y -= 14 * dt;
      p.position.addScaledVector(u.vel, dt);
      p.rotation.x += u.spin.x * dt; p.rotation.y += u.spin.y * dt; p.rotation.z += u.spin.z * dt;
      u.mat.transparent = true;
      u.mat.opacity = Math.max(0, 1 - u.fallT / 2.2);
      if (u.fallT > 2.4) { u.state = "gone"; p.visible = false; }
    } else if (u.state === "hop") {
      u.t += dt;
      const h = u.t < 1.6 ? Math.abs(Math.sin(u.t * 7)) * 0.35 * (1 - u.t / 1.6) : 0;
      p.position.set(u.home.x, u.home.y + h, u.home.z);
      if (u.t > 1.6) u.state = "idle";
    }
  }

  _updateLabels(now) {
    if (!this.labels.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    this.labels = this.labels.filter((l) => {
      const age = now - l.born;
      if (age > l.life) { l.el.remove(); return false; }
      if (age < 0) return true;
      l.obj.getWorldPosition(v);
      v.y += 0.8 + age / 2200;
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * rect.width, y = (-v.y * 0.5 + 0.5) * rect.height;
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      l.el.style.opacity = String(age < 200 ? age / 200 : age > l.life - 600 ? (l.life - age) / 600 : 1);
      return true;
    });
  }
}
