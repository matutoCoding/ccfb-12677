import { useEffect, useRef } from 'react';
import { WebGLRenderer, type MeshData } from '../renderer/webgl-renderer';
import type { Vec3 } from '../types';

interface Scene3DProps {
  meshes: MeshData[];
  clipPlane?: { normal: Vec3; distance: number } | null;
  onPick?: (encodedId: number, clientX: number, clientY: number) => void;
  registerRenderer?: (r: WebGLRenderer) => void;
}

export function Scene3D({ meshes, clipPlane, onPick, registerRenderer }: Scene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number; button: number } | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new WebGLRenderer(canvas);
    rendererRef.current = renderer;
    registerRenderer?.(renderer);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.resize(canvas.clientWidth, canvas.clientHeight, dpr);
      renderer.render();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onDown = (e: MouseEvent) => {
      dragRef.current = { x: e.clientX, y: e.clientY, button: e.button };
      movedRef.current = false;
    };
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
      if (d.button === 2 || e.shiftKey) renderer.pan(dx, dy);
      else renderer.orbit(dx, dy);
      dragRef.current = { ...d, x: e.clientX, y: e.clientY };
      renderer.render();
    };
    const onUp = (e: MouseEvent) => {
      if (!movedRef.current && e.button === 0 && onPick) {
        const rect = canvas.getBoundingClientRect();
        const id = renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
        onPick(id, e.clientX, e.clientY);
      }
      dragRef.current = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      renderer.zoom(e.deltaY > 0 ? 1.12 : 0.89);
      renderer.render();
    };
    const onCtx = (e: Event) => e.preventDefault();

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);
    return () => {
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.clipPlane = clipPlane ?? null;
    r.setMeshes(meshes);
    r.render();
  }, [meshes, clipPlane]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', cursor: 'grab' }}
      title="左键拖动旋转 · Shift/右键平移 · 滚轮缩放 · 点击拾取"
    />
  );
}
