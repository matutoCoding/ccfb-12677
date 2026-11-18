import { describe, it, expect } from 'vitest';
import { exportMvr, importMvr, roundTripCheck, quantizePosition } from './mvr';
import { makeProject } from '../store/sample-data';
import { v3 } from './math3d';

describe('MVR/GDTF 打包与往返', () => {
  it('坐标量化到毫米整数', () => {
    expect(quantizePosition(v3(1.4, 2.6, -3.5))).toEqual({ x: 1, y: 3, z: -3 });
  });

  it('示例工程导出再导入：灯位坐标零偏差', () => {
    const { project } = makeProject('p', 'v1', 80, 16);
    const result = roundTripCheck(project);
    expect(result.maxDeviationMm).toBe(0);
    for (const check of result.coordinateCheck) {
      expect(check.actual).toEqual(check.expected);
      expect(check.deviationMm).toBe(0);
    }
    // 灯具数量守恒
    expect(result.fixtures.length).toBe(project.fixtures.length);
    // 桁架守恒
    expect(result.truss.length).toBe(project.truss.length);
  });

  it('非整数坐标往返仍零偏差（量化发生在写入侧）', () => {
    const { project } = makeProject('p', 'v1', 10, 0);
    project.fixtures = project.fixtures.map((f, i) => ({
      ...f,
      position: { x: 1234.5 + i, y: 9876.25, z: 10000.75 },
    }));
    const bytes = exportMvr(project);
    const result = importMvr(bytes, project.fixtures);
    // 基准也按同一量化规则对齐后比较
    for (const check of result.coordinateCheck) {
      const expectedQ = quantizePosition(check.expected);
      expect(check.actual).toEqual(expectedQ);
    }
  });

  it('GDTF 规格包随 MVR 一起导出并可解析回型号', () => {
    const { project } = makeProject('p', 'v1', 10, 4);
    const result = roundTripCheck(project);
    expect(result.gdtfSpecs.length).toBeGreaterThan(0);
    const models = result.gdtfSpecs.map((g) => g.model);
    expect(models).toContain('MH380 Beam');
  });

  it('编址信息随包保留', () => {
    const { project } = makeProject('p', 'v1', 5, 0);
    const result = roundTripCheck(project);
    const withAddr = result.fixtures.filter((f) => f.address);
    expect(withAddr.length).toBe(project.fixtures.filter((f) => f.address).length);
  });
});
