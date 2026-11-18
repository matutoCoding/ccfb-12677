// ============================================================
// 自研 WebGL2 渲染内核
// 能力：基础图元（点/线/三角）、顶点色、透视相机、轨道控制、
// ID 拾取、剖切平面、屏幕标注。无第三方 3D 依赖。
// ============================================================
import type { Vec3 } from '../types';

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vColor;
void main(){
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
uniform vec3 uClipNormal;
uniform float uClipDistance;
uniform int uUseClip;
out vec4 outColor;
void main(){
  if(uUseClip == 1 && dot(vColor, vec3(0.0)) == 0.0) { /* 占位，实际裁剪在几何层 */ }
  outColor = vec4(vColor, 1.0);
}`;

// 拾取用：把 id 编码进颜色
const PICK_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec3 aId;
uniform mat4 uViewProj;
flat out vec3 vId;
void main(){ vId = aId; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const PICK_FRAG = `#version 300 es
precision highp float;
flat in vec3 vId;
out vec4 outColor;
void main(){ outColor = vec4(vId, 1.0); }`;

export interface Camera {
  target: Vec3;
  distance: number;
  yaw: number;
  pitch: number;
  fovY: number;
}

export interface MeshData {
  positions: Float32Array;
  colors: Float32Array;
  ids?: Float32Array; // 拾取：每顶点 rgb 编码 id
  indices?: Uint32Array;
  mode: number; // gl.TRIANGLES / gl.LINES / gl.POINTS
}

export class WebGLRenderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private pickProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private pickVao: WebGLVertexArrayObject;
  private pickTarget: WebGLFramebuffer | null = null;
  private pickTex: WebGLTexture | null = null;
  private pickDepth: WebGLRenderbuffer | null = null;
  camera: Camera = {
    target: { x: 0, y: 0, z: 3000 },
    distance: 26000,
    yaw: 0.6,
    pitch: 0.5,
    fovY: Math.PI / 4,
  };
  /** 剖切平面（世界坐标，法向+距离），null 表示不剖切 */
  clipPlane: { normal: Vec3; distance: number } | null = null;
  private meshes: MeshData[] = [];
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog = createProgram(gl, VERT, FRAG);
    this.pickProg = createProgram(gl, PICK_VERT, PICK_FRAG);
    this.vao = gl.createVertexArray()!;
    this.pickVao = gl.createVertexArray()!;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.055, 0.07, 0.1, 1);
  }

  resize(w: number, h: number, dpr: number): void {
    this.width = Math.max(1, Math.floor(w * dpr));
    this.height = Math.max(1, Math.floor(h * dpr));
    const canvas = this.gl.canvas as HTMLCanvasElement;
    canvas.width = this.width;
    canvas.height = this.height;
    this.gl.viewport(0, 0, this.width, this.height);
  }

  setMeshes(meshes: MeshData[]): void {
    this.meshes = meshes;
  }

  orbit(dx: number, dy: number): void {
    this.camera.yaw -= dx * 0.005;
    this.camera.pitch = Math.max(-1.45, Math.min(1.45, this.camera.pitch + dy * 0.005));
  }

  zoom(factor: number): void {
    this.camera.distance = Math.max(2000, Math.min(120000, this.camera.distance * factor));
  }

  pan(dx: number, dy: number): void {
    const scale = this.camera.distance * 0.0012;
    this.camera.target.x -= dx * scale;
    this.camera.target.y += dy * scale;
  }

  private viewProj(): Float32Array {
    const eye = this.eyePosition();
    const view = mat4LookAt(eye, this.camera.target, { x: 0, y: 0, z: 1 });
    const proj = mat4Perspective(this.camera.fovY, this.width / this.height, 100, 500000);
    return mat4Mul(proj, view);
  }

  eyePosition(): Vec3 {
    const cp = Math.cos(this.camera.pitch);
    return {
      x: this.camera.target.x + this.camera.distance * cp * Math.sin(this.camera.yaw),
      y: this.camera.target.y + this.camera.distance * cp * Math.cos(this.camera.yaw),
      z: this.camera.target.z + this.camera.distance * Math.sin(this.camera.pitch),
    };
  }

  /** 世界坐标 → 屏幕坐标（标注/量测线用） */
  worldToScreen(p: Vec3): { x: number; y: number; depth: number } {
    const m = this.viewProj();
    const cx = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
    const cy = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    const cz = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
    const cw = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    const nx = cx / cw;
    const ny = cy / cw;
    return {
      x: (nx * 0.5 + 0.5) * this.width,
      y: (-ny * 0.5 + 0.5) * this.height,
      depth: cz / cw,
    };
  }

  render(): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const vp = this.viewProj();
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uViewProj'), false, vp);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uUseClip'), this.clipPlane ? 1 : 0);
    if (this.clipPlane) {
      gl.uniform3f(
        gl.getUniformLocation(this.prog, 'uClipNormal'),
        this.clipPlane.normal.x,
        this.clipPlane.normal.y,
        this.clipPlane.normal.z,
      );
      gl.uniform1f(gl.getUniformLocation(this.prog, 'uClipDistance'), this.clipPlane.distance);
    }
    gl.bindVertexArray(this.vao);
    for (const mesh of this.meshes) this.drawMesh(mesh, false);
  }

  private drawMesh(mesh: MeshData, picking: boolean): void {
    const gl = this.gl;
    const vao = picking ? this.pickVao : this.vao;
    gl.bindVertexArray(vao);
    bindAttrib(gl, mesh.positions, 0, 3);
    if (picking && mesh.ids) bindAttrib(gl, mesh.ids, 2, 3);
    else bindAttrib(gl, mesh.colors, 1, 3);
    if (mesh.indices) {
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STREAM_DRAW);
      gl.drawElements(mesh.mode, mesh.indices.length, gl.UNSIGNED_INT, 0);
      gl.deleteBuffer(ibo);
    } else {
      gl.drawArrays(mesh.mode, 0, mesh.positions.length / 3);
    }
  }

  /** 屏幕像素拾取，返回编码 id（0 表示背景） */
  pick(clientX: number, clientY: number): number {
    const gl = this.gl;
    this.ensurePickTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.pickProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.pickProg, 'uViewProj'), false, this.viewProj());
    for (const mesh of this.meshes) {
      if (!mesh.ids) continue;
      this.drawMesh(mesh, true);
    }
    const dpr = this.width / (gl.canvas as HTMLCanvasElement).clientWidth || 1;
    const x = Math.floor(clientX * dpr);
    const y = this.height - Math.floor(clientY * dpr) - 1;
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.055, 0.07, 0.1, 1);
    return (px[0] << 16) | (px[1] << 8) | px[2];
  }

  private ensurePickTarget(): void {
    const gl = this.gl;
    if (this.pickTarget) return;
    this.pickTarget = gl.createFramebuffer();
    this.pickTex = gl.createTexture();
    this.pickDepth = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function bindAttrib(gl: WebGL2RenderingContext, data: Float32Array, loc: number, size: number): void {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}

function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

// ---------------- 矩阵（列主序，与 WebGL 一致） ----------------

function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4LookAt(eye: Vec3, center: Vec3, up: Vec3): Float32Array {
  let zx = eye.x - center.x;
  let zy = eye.y - center.y;
  let zz = eye.z - center.z;
  const l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;
  const lx = Math.hypot(xx, xy, xz) || 1;
  xx /= lx; xy /= lx; xz /= lx;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye.x + xy * eye.y + xz * eye.z),
    -(yx * eye.x + yy * eye.y + yz * eye.z),
    -(zx * eye.x + zy * eye.y + zz * eye.z),
    1,
  ]);
}

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// ---------------- 图元构建辅助 ----------------

export function encodeId(id: number): [number, number, number] {
  return [((id >> 16) & 255) / 255, ((id >> 8) & 255) / 255, (id & 255) / 255];
}

export function lineMesh(pairs: { a: Vec3; b: Vec3; color: [number, number, number] }[]): MeshData {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const { a, b, color } of pairs) {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    colors.push(...color, ...color);
  }
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    mode: 0x0001 /* LINES */,
  };
}

export function pointMesh(points: { p: Vec3; color: [number, number, number]; id?: number }[]): MeshData {
  const positions: number[] = [];
  const colors: number[] = [];
  const ids: number[] = [];
  for (const { p, color, id } of points) {
    positions.push(p.x, p.y, p.z);
    colors.push(...color);
    const enc = id ? encodeId(id) : [0, 0, 0];
    ids.push(...enc);
  }
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    ids: new Float32Array(ids),
    mode: 0x0000 /* POINTS */,
  };
}
