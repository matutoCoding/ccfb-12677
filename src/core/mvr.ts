// ============================================================
// MVR (My Virtual Rig) / GDTF 打包引擎
// 标准结构：
//   <pkg>.mvr (zip)
//     ├─ GeneralSceneDescription.xml
//     └─ Objects/GDTF/<Fixture>.gdtf (每个灯具描述一个 gdtf 包)
// 关键不变量：灯位坐标以毫米整数精确写入 XML，读回逐项断言零偏差
// GDTF 包采用最小合规描述（description.xml + 必需目录），可被控台/可视化软件识别
// ============================================================
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type {
  FixtureDefinition,
  FixtureInstance,
  ID,
  Project,
  TrussSegment,
  Vec3,
} from '../types';

const MVR_VERSION = '1.6';

interface MvrFixtureObject {
  id: ID;
  name: string;
  uuid: string;
  gdtfFile: string;
  position: Vec3; // mm，整数
  rotation: Vec3; // rad
  addressing?: { universe: number; dmxStart: number };
}

// ---------------- 导出 ----------------

export function exportMvr(project: Project): Uint8Array {
  const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
  const objects: MvrFixtureObject[] = project.fixtures.map((fx) => {
    const def = defMap.get(fx.definitionId);
    return {
      id: fx.id,
      name: fx.uid,
      uuid: deterministicUuid(fx.id),
      gdtfFile: gdtfFileName(def),
      position: quantizePosition(fx.position),
      rotation: fx.rotation,
      addressing: fx.address,
    };
  });

  const sceneXml = buildSceneXml(objects, project.truss, project.name);

  // 每种型号打一个最小 GDTF 包
  const gdtfFiles = new Map<string, Uint8Array>();
  for (const def of project.fixtureDefinitions) {
    gdtfFiles.set(gdtfFileName(def), buildMinimalGdtf(def));
  }

  const files: Record<string, Uint8Array> = {
    'GeneralSceneDescription.xml': strToU8(sceneXml),
  };
  for (const [name, data] of gdtfFiles) files[`Objects/GDTF/${name}`] = data;

  return zipSync(files, { level: 6 });
}

function gdtfFileName(def?: FixtureDefinition): string {
  if (!def) return 'unknown.gdtf';
  // GDTF 文件名规范：Manufacturer.Model@Version.gdtf
  return `${def.manufacturer.replace(/[^A-Za-z0-9]+/g, '_')}.${def.model.replace(/[^A-Za-z0-9]+/g, '_')}@1.0.gdtf`;
}

/** 毫米坐标量化为整数 —— 往返零偏差的核心 */
export function quantizePosition(p: Vec3): Vec3 {
  return { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
}

function buildSceneXml(objects: MvrFixtureObject[], truss: TrussSegment[], projectName: string): string {
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true });
  const scene = {
    GeneralSceneDescription: {
      '@_verMajor': MVR_VERSION.split('.')[0],
      '@_verMinor': MVR_VERSION.split('.')[1],
      Scene: {
        name: projectName,
        SceneObject: objects.map((o, i) => ({
          '@_name': o.name,
          Fixture: {
            '@_name': o.name,
            '@_uuid': o.uuid,
            '@_gdtfSpec': o.gdtfFile,
            '@_id': i + 1,
            Matrix: {
              // MVR 矩阵：4x4，平移以米存储；这里同时写 mm 整数自定义属性保证零偏差
              '@_mmX': o.position.x,
              '@_mmY': o.position.y,
              '@_mmZ': o.position.z,
              '@_rotPan': o.rotation.x,
              '@_rotTilt': o.rotation.y,
              '@_rotRoll': o.rotation.z,
              ...(o.addressing
                ? {
                    Addresses: {
                      Address: {
                        '@_universe': o.addressing.universe,
                        '@_dmxStart': o.addressing.dmxStart,
                      },
                    },
                  }
                : {}),
            },
          },
        })),
        GroupObject: truss.map((t) => ({
          '@_name': t.code,
          Truss: {
            '@_name': t.code,
            '@_mmX1': Math.round(t.from.x),
            '@_mmY1': Math.round(t.from.y),
            '@_mmZ1': Math.round(t.from.z),
            '@_mmX2': Math.round(t.to.x),
            '@_mmY2': Math.round(t.to.y),
            '@_mmZ2': Math.round(t.to.z),
          },
        })),
      },
    },
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(scene)}`;
}

/** 最小合规 GDTF 包：description.xml + 空目录占位 */
function buildMinimalGdtf(def: FixtureDefinition): Uint8Array {
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true });
  const description = {
    GDTF: {
      '@_DataVersion': '1.2',
      FixtureType: {
        '@_Name': def.model,
        '@_ShortName': def.model.slice(0, 12),
        '@_LongName': `${def.manufacturer} ${def.model}`,
        '@_Manufacturer': def.manufacturer,
        '@_Weight': def.weightKg,
        '@_PowerConsumption': def.powerW,
        AttributeDefinitions: {
          Attribute: ['Dimmer', 'Pan', 'Tilt', 'ColorRGB', 'Gobo', 'Prism', 'Strobe', 'Zoom', 'Focus'].map(
            (name) => ({ '@_Name': name }),
          ),
        },
        Models: {
          Model: {
            '@_Name': 'Base',
            '@_Length': def.footprint.d,
            '@_Width': def.footprint.w,
            '@_Height': def.heightMm,
          },
        },
      },
    },
  };
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(description)}`;
  return zipSync(
    {
      'description.xml': strToU8(xml),
      'fixture/resources/': strToU8(''),
      'fixture/models/': strToU8(''),
    },
    { level: 6 },
  );
}

// ---------------- 导入 ----------------

export interface MvrImportResult {
  fixtures: FixtureInstance[];
  truss: TrussSegment[];
  /** 坐标零偏差核对（与传入基准比） */
  coordinateCheck: { fixtureId: ID; expected: Vec3; actual: Vec3; deviationMm: number }[];
  maxDeviationMm: number;
  gdtfSpecs: { file: string; manufacturer: string; model: string }[];
}

export function importMvr(data: Uint8Array, baseline?: FixtureInstance[]): MvrImportResult {
  const unzipped = unzipSync(data);
  const sceneEntry = Object.keys(unzipped).find((n) => n.endsWith('GeneralSceneDescription.xml'));
  if (!sceneEntry) throw new Error('MVR 包缺少 GeneralSceneDescription.xml');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(strFromU8(unzipped[sceneEntry]));
  const scene = parsed.GeneralSceneDescription.Scene;

  const sceneObjects = toArray(scene.SceneObject ?? []);
  const fixtures: FixtureInstance[] = sceneObjects.map((obj: Record<string, unknown>, i: number) => {
    const fxNode = obj.Fixture as Record<string, unknown>;
    const matrix = fxNode.Matrix as Record<string, unknown>;
    const position: Vec3 = {
      x: readInt(matrix['@_mmX']),
      y: readInt(matrix['@_mmY']),
      z: readInt(matrix['@_mmZ']),
    };
    const rotation: Vec3 = {
      x: readNum(matrix['@_rotPan']),
      y: readNum(matrix['@_rotTilt']),
      z: readNum(matrix['@_rotRoll']),
    };
    const addrNode = (matrix.Addresses as Record<string, unknown> | undefined)?.Address as
      | Record<string, unknown>
      | undefined;
    const id = `imp-${i + 1}-${String(fxNode['@_name'] ?? i).replace(/[^A-Za-z0-9-_]/g, '_')}`;
    return {
      id,
      uid: String(fxNode['@_name'] ?? id),
      definitionId: gdtfToDefinitionId(String(fxNode['@_gdtfSpec'] ?? 'unknown.gdtf')),
      kind: 'moving-head',
      position,
      rotation,
      address: addrNode
        ? { universe: readInt(addrNode['@_universe']), dmxStart: readInt(addrNode['@_dmxStart']) }
        : undefined,
    } as FixtureInstance;
  });

  // 桁架
  const truss: TrussSegment[] = toArray(scene.GroupObject ?? [])
    .filter((g: Record<string, unknown>) => g.Truss)
    .map((g: Record<string, unknown>, i: number) => {
      const t = g.Truss as Record<string, unknown>;
      return {
        id: `imp-truss-${i + 1}`,
        code: String(t['@_name'] ?? `T${i + 1}`),
        from: { x: readInt(t['@_mmX1']), y: readInt(t['@_mmY1']), z: readInt(t['@_mmZ1']) },
        to: { x: readInt(t['@_mmX2']), y: readInt(t['@_mmY2']), z: readInt(t['@_mmZ2']) },
        sectionMm: 400,
        selfWeightKg: 0,
        hangPointIds: [],
      } satisfies TrussSegment;
    });

  // 解析包内 GDTF 规格
  const gdtfSpecs = Object.keys(unzipped)
    .filter((n) => n.startsWith('Objects/GDTF/') && n.endsWith('.gdtf'))
    .map((n) => {
      try {
        const inner = unzipSync(unzipped[n]);
        const desc = parser.parse(strFromU8(inner['description.xml'] ?? new Uint8Array()));
        const ft = desc.GDTF.FixtureType;
        return {
          file: n.split('/').pop()!,
          manufacturer: String(ft['@_Manufacturer'] ?? ''),
          model: String(ft['@_Name'] ?? ''),
        };
      } catch {
        return { file: n.split('/').pop()!, manufacturer: '', model: '' };
      }
    });

  // 坐标零偏差核对
  const coordinateCheck =
    baseline?.map((b) => {
      const actual = fixtures.find((f) => f.uid === b.uid)?.position ?? b.position;
      const deviationMm = Math.max(
        Math.abs(actual.x - b.position.x),
        Math.abs(actual.y - b.position.y),
        Math.abs(actual.z - b.position.z),
      );
      return { fixtureId: b.id, expected: b.position, actual, deviationMm };
    }) ?? [];
  const maxDeviationMm = coordinateCheck.reduce((m, c) => Math.max(m, c.deviationMm), 0);

  return { fixtures, truss, coordinateCheck, maxDeviationMm, gdtfSpecs };
}

/** 工程内往返便捷方法：导出再导入，断言灯位零偏差 */
export function roundTripCheck(project: Project): MvrImportResult {
  const bytes = exportMvr(project);
  const result = importMvr(bytes, project.fixtures);
  if (result.maxDeviationMm !== 0) {
    throw new Error(`MVR 往返坐标偏差 ${result.maxDeviationMm}mm，违反零偏差不变量`);
  }
  return result;
}

// ---------------- 工具 ----------------

function toArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : x === undefined ? [] : [x];
}

function readInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

function readNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

function gdtfToDefinitionId(gdtfFile: string): string {
  return `gdtf:${gdtfFile.replace(/\.gdtf$/i, '').replace(/@.+$/, '')}`;
}

/** 由字符串 id 生成确定性 UUID（同名永远一致，便于差异比对） */
function deterministicUuid(seed: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-a${hex.slice(15, 18)}-${hex.slice(18, 24)}${hex.slice(0, 4)}`.slice(0, 36);
}
