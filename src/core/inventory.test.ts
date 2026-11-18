import { describe, it, expect } from 'vitest';
import {
  buildQuote,
  cableLedger,
  checkinSerial,
  findBookingConflicts,
  reconcileProjectInventory,
  rigProgress,
} from './inventory';
import { makeProject } from '../store/sample-data';
import { v3 } from './math3d';

describe('inventory 库存/档期/报价/线缆/吊装', () => {
  it('档期重叠序列号被报冲突，不重叠不报', () => {
    const conflicts = findBookingConflicts([
      { id: 'a', projectId: 'p1', definitionId: 'd', serialNo: 'S1', fromDate: '2026-12-01', toDate: '2026-12-10' },
      { id: 'b', projectId: 'p2', definitionId: 'd', serialNo: 'S1', fromDate: '2026-12-05', toDate: '2026-12-12' },
      { id: 'c', projectId: 'p3', definitionId: 'd', serialNo: 'S2', fromDate: '2027-01-01', toDate: '2027-01-05' },
    ]);
    expect(conflicts.map((c) => c.serialNo)).toEqual(['S1']);
  });

  it('台账核对：缺失序列号灯进入 missing', () => {
    const { project, inventory } = makeProject('p', 'v1', 8, 2);
    const r = reconcileProjectInventory(project.fixtures, inventory, project.id);
    expect(r.satisfied.length + r.missing.length).toBe(project.fixtures.length);
    const broken = inventory.filter((i) => i.serialNo !== project.fixtures[0]!.serialNo);
    const r2 = reconcileProjectInventory(project.fixtures, broken, project.id);
    expect(r2.missing.length).toBeGreaterThanOrEqual(1);
  });

  it('撤场核销归还后状态变 idle', () => {
    const { inventory } = makeProject('p', 'v1', 4, 0);
    const serial = inventory[0]!.serialNo;
    const updated = checkinSerial(inventory, serial);
    expect(updated.find((i) => i.serialNo === serial)!.status).toBe('idle');
  });

  it('报价：租赁按天数、人工运输合计', () => {
    const { project } = makeProject('p', 'v1', 10, 4);
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const quote = buildQuote({
      title: '测试报价',
      fixtures: project.fixtures,
      definitions: defMap,
      showDays: 3, installDays: 2, strikeDays: 1,
      laborDayRate: 800, laborPersonDays: 20,
      truckTripRate: 3000, truckTrips: 4,
    });
    expect(quote.total).toBeGreaterThan(0);
    expect(quote.lines.reduce((s, l) => s + l.subtotal, 0)).toBe(quote.total);
    const lampLine = quote.lines.find((l) => l.label.includes('MH380'))!;
    expect(lampLine.days).toBe(6);
  });

  it('线缆清册按折线求和长度并统计接头', () => {
    const r = cableLedger([
      { id: 'c1', signal: 'dmx', fromNode: 'a', toNode: 'b', path: [v3(0, 0, 0), v3(3000, 0, 0), v3(3000, 4000, 0)], lengthMm: 0, connectorFrom: 'XLR5', connectorTo: 'XLR5' },
    ]);
    expect(r.runs[0]!.lengthM).toBeCloseTo(7, 3);
    expect(r.connectorSummary['XLR5']).toBe(2);
    expect(r.totalLengthM).toBeCloseTo(7, 3);
  });

  it('吊装进度', () => {
    const r = rigProgress([
      { id: '1', day: 'd', startHm: '08', endHm: '10', crew: '甲', trussId: 't', description: '', done: true },
      { id: '2', day: 'd', startHm: '10', endHm: '12', crew: '乙', trussId: 't', description: '', done: false },
    ]);
    expect(r.percent).toBeCloseTo(0.5, 5);
  });
});
