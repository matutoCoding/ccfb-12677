import { useEffect, useRef, useState } from 'react';
import { useStore } from './store/use-store';
import { exportProjectBundle, importProjectBundle, downloadBytes, readFileAsBytes } from './store/storage';
import { VenuesPage } from './pages/venues-page';
import { DesignPage } from './pages/design-page';
import { ProgrammingPage } from './pages/programming-page';
import { ReviewPage } from './pages/review-page';
import { OutputPage } from './pages/output-page';

const PAGES = [
  ['venues', '场馆档案'],
  ['design', '方案设计'],
  ['programming', '灯效编程'],
  ['review', '预演评审'],
  ['output', '出图报价'],
] as const;

type PageId = (typeof PAGES)[number][0];

export function App() {
  const state = useStore();
  const [page, setPage] = useState<PageId>('venues');
  const [toast, setToast] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const project = state.activeProjectId ? state.projects[state.activeProjectId] : undefined;

  useEffect(() => {
    void state.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  const doExport = async () => {
    const bytes = await exportProjectBundle({
      version: state.version,
      venues: state.venues,
      projects: state.projects,
      inventory: state.inventory,
      bookings: state.bookings,
      activeProjectId: state.activeProjectId,
      blindMode: state.blindMode,
    });
    downloadBytes(`tourlight-${new Date().toISOString().slice(0, 10)}.tlpkg`, bytes);
    flash('工程包已导出（含附件，离线文件）');
  };

  const doImport = async (file: File) => {
    const bytes = await readFileAsBytes(file);
    const loaded = await importProjectBundle(bytes);
    state.replaceAll(loaded);
    flash('工程包已导入并恢复全部数据');
  };

  if (!state.loaded) return <div style={{ padding: 40 }}>正在加载本地工程…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Tour<span className="dot">Light</span></div>
        <nav className="nav">
          {PAGES.map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>
          ))}
        </nav>
        <div className="spacer" />
        {project && <span className="project-name">工程：{project.name} · {project.fixtures.length} 台灯</span>}
        {state.blindMode && <span className="blind-badge">盲编模式</span>}
        <button className="btn small ghost" onClick={doExport}>导出工程包</button>
        <button className="btn small ghost" onClick={() => importRef.current?.click()}>导入工程包</button>
        <input ref={importRef} type="file" accept=".tlpkg" hidden
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
      </header>

      {page === 'venues' && <VenuesPage />}
      {page === 'design' && <DesignPage />}
      {page === 'programming' && <ProgrammingPage />}
      {page === 'review' && <ReviewPage />}
      {page === 'output' && <OutputPage />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
