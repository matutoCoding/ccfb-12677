// MVR (My Virtual Rig) / GDTF 打包导出与回导
// 坐标零偏差策略: 除标准 XML 几何外, 额外写入精确坐标表 tld_exact_xyz.json,
// 回导优先读精确表; 标准 XML 仍按规范输出供第三方控台/可视化软件使用。
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { Project, Fixture, LampModel, Vec3, Truss } from './types.ts';

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const f3 = (n: number): string => (Math.round(n * 10000) / 10000).toString();

interface ExactRig {
  format: 'tld-exact-xyz/1';
  projectName: string;
  fixtures: { id: string; label: string; modelId: string; position: Vec3; rotation: Vec3; universe: number; dmxStart: number }[];
  trusses: { id: string; label: string; from: Vec3; to: Vec3 }[];
}

function buildSceneXml(project: Project, models: LampModel[]): string {
  const modelMap = new Map(models.map(m => [m.id, m]));
  const fixtureXml = project.fixtures.map(fx => {
    const m = modelMap.get(fx.modelId);
    return `      <Fixture name="${xmlEscape(fx.label)}" uuid="${fx.id}">
        <GDTFSpec>${xmlEscape(m ? gdtfName(m) : `${fx.modelId}.gdtf`)}</GDTFSpec>
        <GDTFMode>Mode 1</GDTFMode>
        <Address type="Absolute" universe="${fx.universe}" address="${fx.dmxStart}" />
        <Matrix>${f3(fx.position[0])} 0 0 0 ${f3(fx.position[1])} 0 0 0 ${f3(fx.position[2])} 0 0 0 1</Matrix>
      </Fixture>`;
  }).join('\n');

  const trussXml = project.trusses.map(tr => `      <SceneObject name="${xmlEscape(tr.label)}" uuid="${tr.id}">
        <Matrix>${f3(tr.from[0])} 0 0 0 ${f3(tr.from[1])} 0 0 0 ${f3(tr.from[2])} 0 0 0 1</Matrix>
        <Geometries><Geometry name="truss" type="Beam"><Matrix>1 0 0 0 1 0 0 0 1 0 0 0</Matrix></Geometry></Geometries>
      </SceneObject>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<GeneralSceneDescription verMajor="1" verMinor="6">
  <Scene>
${fixtureXml}
${trussXml}
  </Scene>
</GeneralSceneDescription>`;
}

const gdtfName = (m: LampModel): string => `${m.manufacturer.replace(/\W+/g, '_')}-${m.name.replace(/\W+/g, '_')}@${m.name.replace(/\W+/g, '_')}.gdtf`;

function buildGdtf(m: LampModel): Uint8Array {
  const desc = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType Name="${xmlEscape(m.name)}" ShortName="${xmlEscape(m.name.slice(0, 8))}" LongName="${xmlEscape(m.manufacturer + ' ' + m.name)}">
    <AttributeDefinitions>
      <Attribute Name="DmxPan" />
      <Attribute Name="DmxTilt" />
      <Attribute Name="Dimmer" />
      <Attribute Name="ColorRGB_R" />
      <Attribute Name="ColorRGB_G" />
      <Attribute Name="ColorRGB_B" />
      <Attribute Name="Gobo" />
      <Attribute Name="Prism" />
      <Attribute Name="Shutter" />
    </AttributeDefinitions>
    <DMXModes>
      <DMXMode Name="Mode 1">
        <DMXChannels>
${Array.from({ length: m.dmxChannels }, (_, i) => `          <DMXChannel Geometry="Base" Offset="${i}"><LogicalChannel Attribute="${['DmxPan', 'DmxTilt', 'Dimmer', 'ColorRGB_R', 'ColorRGB_G', 'ColorRGB_B', 'Gobo', 'Prism', 'Shutter'][i] ?? 'Dimmer'}" /></DMXChannel>`).join('\n')}
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;
  // GDTF 本身也是 zip 容器
  return zipSync({
    'description.xml': strToU8(desc),
    'general-scene-description.json': strToU8(JSON.stringify({
      weightKg: m.weightKg, powerW: m.powerW, lumen: m.lumen, cct: m.cct, cri: m.cri, pwmHz: m.pwmHz,
      beamAngleDeg: m.beamAngleDeg, panRange: m.panRange, tiltRange: m.tiltRange,
    })),
  });
}

/** 导出 MVR 包 (含 GDTF 灯具描述 + 精确坐标表) */
export function exportMVR(project: Project, models: LampModel[]): Uint8Array {
  const usedModels = new Set(project.fixtures.map(f => f.modelId));
  const files: Record<string, Uint8Array> = {
    'GeneralSceneDescription.xml': strToU8(buildSceneXml(project, models)),
    'tld_exact_xyz.json': strToU8(JSON.stringify({
      format: 'tld-exact-xyz/1',
      projectName: project.name,
      fixtures: project.fixtures.map(f => ({
        id: f.id, label: f.label, modelId: f.modelId,
        position: f.position, rotation: f.rotation,
        universe: f.universe, dmxStart: f.dmxStart,
      })),
      trusses: project.trusses.map(t => ({ id: t.id, label: t.label, from: t.from, to: t.to })),
    } satisfies ExactRig)),
  };
  for (const m of models) {
    if (usedModels.has(m.id)) files[`fixtures/${gdtfName(m)}`] = buildGdtf(m);
  }
  return zipSync(files);
}

export interface MVRRoundtripResult {
  fixtures: { id: string; label: string; modelId: string; position: Vec3; rotation: Vec3; universe: number; dmxStart: number }[];
  trusses: Truss[];
  usedExactTable: boolean;
  warnings: string[];
}

/** 回导 MVR: 优先精确坐标表保证零偏差, 缺表时解析标准 XML */
export function importMVR(bytes: Uint8Array): MVRRoundtripResult {
  const archive = unzipSync(bytes);
  const warnings: string[] = [];
  const exactEntry = archive['tld_exact_xyz.json'];
  if (exactEntry) {
    const rig = JSON.parse(strFromU8(exactEntry)) as ExactRig;
    return {
      fixtures: rig.fixtures.map(f => ({ ...f, position: [...f.position] as Vec3, rotation: [...f.rotation] as Vec3 })),
      trusses: rig.trusses.map(t => ({
        id: t.id, label: t.label, from: [...t.from] as Vec3, to: [...t.to] as Vec3,
        section: 0.3, loadKg: 500,
      })),
      usedExactTable: true,
      warnings,
    };
  }

  // 第三方 MVR: 解析 GeneralSceneDescription.xml 中的 Fixture 与 Matrix
  warnings.push('未发现精确坐标表, 已按标准 MVR XML 解析 (坐标精度受 XML 小数位限制)');
  const xml = strFromU8(archive['GeneralSceneDescription.xml'] ?? new Uint8Array());
  const fixtures: MVRRoundtripResult['fixtures'] = [];
  const fixtureBlocks = xml.matchAll(/<Fixture[^>]*uuid="([^"]+)"[^>]*>([\s\S]*?)<\/Fixture>/g);
  for (const block of fixtureBlocks) {
    const [, uuid, inner] = block;
    const name = block[0].match(/name="([^"]*)"/)?.[1] ?? uuid;
    const gdtf = inner.match(/<GDTFSpec>([^<]+)<\/GDTFSpec>/)?.[1] ?? 'unknown.gdtf';
    const addr = inner.match(/universe="(\d+)"\s+address="(\d+)"/);
    const matrix = inner.match(/<Matrix>([^<]+)<\/Matrix>/)?.[1].trim().split(/\s+/).map(Number) ?? [];
    fixtures.push({
      id: uuid, label: name, modelId: gdtf.replace(/\.gdtf$/, ''),
      position: [matrix[0] ?? 0, matrix[5] ?? 0, matrix[10] ?? 0],
      rotation: [0, 0, 0],
      universe: Number(addr?.[1] ?? 0), dmxStart: Number(addr?.[2] ?? 1),
    });
  }
  return { fixtures, trusses: [], usedExactTable: false, warnings };
}

/** 校验往返坐标: 返回最大偏差 (米), 精确表路径必须为 0 */
export function verifyRoundtrip(original: Fixture[], imported: MVRRoundtripResult): { maxDeviation: number; perFixture: Record<string, number> } {
  const perFixture: Record<string, number> = {};
  let maxDeviation = 0;
  const byId = new Map(imported.fixtures.map(f => [f.id, f]));
  for (const fx of original) {
    const back = byId.get(fx.id);
    if (!back) { perFixture[fx.id] = Infinity; maxDeviation = Infinity; continue; }
    const d = Math.hypot(
      fx.position[0] - back.position[0],
      fx.position[1] - back.position[1],
      fx.position[2] - back.position[2],
    );
    perFixture[fx.id] = d;
    maxDeviation = Math.max(maxDeviation, d);
  }
  return { maxDeviation, perFixture };
}

/** 下载工具 (浏览器侧) */
export function downloadBytes(filename: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
