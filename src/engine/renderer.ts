// WebGL2 渲染器: 实例化网格、线段、拾取、剖切、伪彩照度网格、光束、评论钉
import { mat4, invertMat4, type Mat4 } from './mat4.ts';
import type { Vec3 } from '../core/types.ts';

export interface Camera {
  eye: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovy: number;
}

export interface Instance {
  position: Vec3;
  scale?: number;
  color: [number, number, number, number];
  /** 拾取 id (>=1), 0 表示不参与拾取 */
  pickId?: number;
  rotation?: Vec3;
}

export interface LineSeg {
  a: Vec3;
  b: Vec3;
  color: [number, number, number, number];
}

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iPos;
layout(location=3) in float iScale;
layout(location=4) in vec4 iColor;
layout(location=5) in float iPick;
layout(location=6) in vec3 iRot;
uniform mat4 uViewProj;
uniform vec3 uClipNormal;
uniform float uClipDist;
uniform int uClipOn;
out vec4 vColor;
out vec3 vNormal;
out float vPick;
out vec3 vWorld;
mat3 rotZYX(vec3 r){
  float cx=cos(r.x),sx=sin(r.x),cy=cos(r.y),sy=sin(r.y),cz=cos(r.z),sz=sin(r.z);
  return mat3(cy*cz,cy*sz,-sy, sx*sy*cz-cx*sz,sx*sy*sz+cx*cz,sx*cy, cx*sy*cz+sx*sz,cx*sy*sz-sx*cz,cx*cy);
}
void main(){
  vec3 world = rotZYX(iRot) * (aPos * iScale) + iPos;
  gl_Position = uViewProj * vec4(world,1.0);
  vWorld = world;
  vColor = iColor;
  vNormal = rotZYX(iRot) * aNormal;
  vPick = iPick;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
in vec3 vNormal;
in float vPick;
in vec3 vWorld;
uniform int uPickMode;
uniform vec3 uClipNormal;
uniform float uClipDist;
uniform int uClipOn;
out vec4 outColor;
void main(){
  // 剖切: 法线正侧的片段丢弃 (无扩展依赖, GLSL ES 3.00 全平台可用)
  if(uClipOn==1 && dot(vWorld, uClipNormal) > uClipDist) discard;
  if(uPickMode==1){
    int id = int(vPick + 0.5);
    outColor = vec4(float(id&255)/255.0, float((id>>8)&255)/255.0, float((id>>16)&255)/255.0, 1.0);
    return;
  }
  vec3 lightDir = normalize(vec3(0.4,0.6,0.8));
  float shade = 0.55 + 0.45*abs(dot(normalize(vNormal), lightDir));
  outColor = vec4(vColor.rgb*shade, vColor.a);
}`;

const LINE_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
void main(){ gl_Position = uViewProj * vec4(aPos,1.0); vColor=aColor; }`;

const LINE_FRAG = `#version 300 es
precision highp float;
in vec4 vColor; out vec4 outColor;
void main(){ outColor=vColor; }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Shader 编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program 链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

/** 立方体+法线数据, 灯体/挂点/评论钉共用 */
function cubeData(): { verts: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const v = [
    -.5, -.5, .5, .5, -.5, .5, .5, .5, .5, -.5, .5, .5,
    -.5, -.5, -.5, -.5, .5, -.5, .5, .5, -.5, .5, -.5, -.5,
  ];
  const n = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 3, 2, 6, 3, 6, 5,
    0, 4, 7, 0, 7, 1, 1, 7, 6, 1, 6, 2, 0, 3, 5, 0, 5, 4];
  return { verts: new Float32Array(v), normals: new Float32Array(n), indices: new Uint16Array(idx) };
}

export class GLRenderer {
  gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private lineProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private lineVao: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer | null = null;
  private pickTarget: WebGLFramebuffer | null = null;
  private pickTex: WebGLTexture | null = null;
  private pickDepth: WebGLRenderbuffer | null = null;
  camera: Camera = {
    // 场景中心约在 (30, 20, 7), 相机在斜上方俯视整个舞台
    eye: [58, -28, 30], target: [30, 18, 7], up: [0, 0, 1], fovy: Math.PI / 4,
  };
  /** 剖切平面: 法线与距离 (世界坐标, dot(n,p) > dist 的片段被裁掉) */
  clipOn = false;
  clipNormal: Vec3 = [1, 0, 0];
  clipDist = 0;
  private instances: Instance[] = [];
  private lines: LineSeg[] = [];
  private pickMap = new Map<number, string>();
  private nextPick = 1;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog = program(gl, VERT, FRAG);
    this.lineProg = program(gl, LINE_VERT, LINE_FRAG);

    const { verts, normals, indices } = cubeData();
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.setStaticAttr(0, verts, 3);
    this.setStaticAttr(1, normals, 3);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    // 实例属性走单一交错缓冲, 每实例 13 float: pos(3) scale(1) color(4) pick(1) rot(3) pad(1)
    this.instanceBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    const layout: [number, number][] = [[2, 3], [3, 1], [4, 4], [5, 1], [6, 3]];
    let offsetFloats = 0;
    for (const [loc, size] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 13 * 4, offsetFloats * 4);
      gl.vertexAttribDivisor(loc, 1);
      offsetFloats += size;
    }

    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    // 立方体索引绕序不保证统一朝外, 关闭背面剔除避免物体被整体剔除
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.055, 0.07, 0.1, 1);
    gl.enable(gl.DEPTH_TEST);
    this.resize();
  }

  private setStaticAttr(loc: number, data: Float32Array, size: number): void {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  private uploadInstances(list: Instance[], pickMode: boolean): void {
    const gl = this.gl;
    const stride = 13;
    const data = new Float32Array(list.length * stride);
    list.forEach((ins, i) => {
      const o = i * stride;
      data[o] = ins.position[0]; data[o + 1] = ins.position[1]; data[o + 2] = ins.position[2];
      data[o + 3] = ins.scale ?? 1;
      data[o + 4] = ins.color[0]; data[o + 5] = ins.color[1]; data[o + 6] = ins.color[2]; data[o + 7] = ins.color[3];
      data[o + 8] = pickMode ? (ins.pickId ?? 0) : 0;
      data[o + 9] = (ins.rotation?.[0] ?? 0) * Math.PI / 180;
      data[o + 10] = (ins.rotation?.[1] ?? 0) * Math.PI / 180;
      data[o + 11] = (ins.rotation?.[2] ?? 0) * Math.PI / 180;
      data[o + 12] = 0;
    });
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  resize(): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w; c.height = h;
      this.width = w; this.height = h;
      this.buildPickTarget(w, h);
    }
  }

  private buildPickTarget(w: number, h: number): void {
    const gl = this.gl;
    if (this.pickTarget) gl.deleteFramebuffer(this.pickTarget);
    this.pickTarget = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget);
    this.pickTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
    this.pickDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  reset(instances: Instance[], lines: LineSeg[]): void {
    this.instances = instances;
    this.lines = lines;
    this.pickMap = new Map();
    this.nextPick = 1;
  }

  registerPick(key: string): number {
    const id = this.nextPick++;
    this.pickMap.set(id, key);
    return id;
  }

  private viewProj(): Mat4 {
    const gl = this.gl;
    const c = this.gl.canvas as HTMLCanvasElement;
    const aspect = c.width / c.height;
    return mat4.multiply(
      mat4.perspective(this.camera.fovy, aspect, 0.1, 500),
      mat4.lookAt(this.camera.eye, this.camera.target, this.camera.up),
    );
  }

  render(): void {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawScene(this.viewProj(), false);
  }

  private drawScene(vp: Mat4, pickMode: boolean): void {
    const gl = this.gl;
    if (this.instances.length) {
      this.uploadInstances(this.instances, pickMode);
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uViewProj'), false, vp);
      gl.uniform1i(gl.getUniformLocation(this.prog, 'uPickMode'), pickMode ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(this.prog, 'uClipOn'), this.clipOn ? 1 : 0);
      gl.uniform3f(gl.getUniformLocation(this.prog, 'uClipNormal'), ...this.clipNormal);
      gl.uniform1f(gl.getUniformLocation(this.prog, 'uClipDist'), this.clipDist);
      gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, this.instances.length);
    }
    if (this.lines.length && !pickMode) this.drawLines(vp);
  }

  private drawLines(vp: Mat4): void {
    const gl = this.gl;
    const data = new Float32Array(this.lines.length * 14);
    this.lines.forEach((l, i) => {
      const o = i * 14;
      data.set([...l.a, ...l.color, ...l.b, ...l.color], o);
    });
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uViewProj'), false, vp);
    gl.bindVertexArray(this.lineVao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(gl.LINES, 0, this.lines.length * 2);
    gl.deleteBuffer(buf);
  }

  /** 屏幕坐标拾取, 返回注册的业务 key 或 null */
  pick(clientX: number, clientY: number): string | null {
    const gl = this.gl;
    const c = gl.canvas as HTMLCanvasElement;
    const rect = c.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / rect.width * c.width);
    const y = Math.floor((1 - (clientY - rect.top) / rect.height) * c.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickTarget);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawScene(this.viewProj(), true);
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.055, 0.07, 0.1, 1);
    const id = px[0] + (px[1] << 8) + (px[2] << 16);
    return this.pickMap.get(id) ?? null;
  }

  /** 屏幕射线与水平面 z=const 的交点, 用于在台面/吊挂层放置灯具 */
  screenToPlane(clientX: number, clientY: number, planeZ: number): Vec3 {
    const gl = this.gl;
    const c = gl.canvas as HTMLCanvasElement;
    const rect = c.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const vp = this.viewProj();
    const inv = invertMat4(vp);
    const near: Vec3 = [nx, ny, -1];
    const far: Vec3 = [nx, ny, 1];
    const toV = (v: Vec3): Vec3 => {
      const w = inv;
      const x = w[0] * v[0] + w[4] * v[1] + w[8] * v[2] + w[12];
      const y = w[1] * v[0] + w[5] * v[1] + w[9] * v[2] + w[13];
      const z = w[2] * v[0] + w[6] * v[1] + w[10] * v[2] + w[14];
      const ww = w[3] * v[0] + w[7] * v[1] + w[11] * v[2] + w[15];
      return [x / ww, y / ww, z / ww];
    };
    const p0 = toV(near), p1 = toV(far);
    const t = (planeZ - p0[2]) / (p1[2] - p0[2]);
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, planeZ];
  }

  orbit(dx: number, dy: number): void {
    const cam = this.camera;
    const off: Vec3 = [cam.eye[0] - cam.target[0], cam.eye[1] - cam.target[1], cam.eye[2] - cam.target[2]];
    const r0 = Math.hypot(...off);
    const az = Math.atan2(off[1], off[0]);
    let el = Math.asin(off[2] / r0);
    const az2 = az - dx * 0.01;
    el = Math.max(-1.4, Math.min(1.45, el + dy * 0.01));
    cam.eye = [
      cam.target[0] + r0 * Math.cos(el) * Math.cos(az2),
      cam.target[1] + r0 * Math.cos(el) * Math.sin(az2),
      cam.target[2] + r0 * Math.sin(el),
    ];
  }

  zoom(factor: number): void {
    const cam = this.camera;
    const off: Vec3 = [cam.eye[0] - cam.target[0], cam.eye[1] - cam.target[1], cam.eye[2] - cam.target[2]];
    const r = Math.max(3, Math.min(200, Math.hypot(...off) * factor));
    const n: Vec3 = [off[0] / Math.hypot(...off), off[1] / Math.hypot(...off), off[2] / Math.hypot(...off)];
    cam.eye = [cam.target[0] + n[0] * r, cam.target[1] + n[1] * r, cam.target[2] + n[2] * r];
  }
}
