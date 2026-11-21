/** 应用外壳:导航 + hash 路由。 */
import './styles.css';
import { store } from './core/store';
import { mountDesign } from './pages/design';
import { mountGlyphs } from './pages/glyphs';
import { mountTemplates } from './pages/templates';
import { mountPreview } from './pages/preview';
import { mountWorks } from './pages/works';

const PAGES: Record<string, { title: string; mount: (el: HTMLElement) => () => void }> = {
  design: { title: '印稿设计', mount: mountDesign },
  glyphs: { title: '篆字库', mount: mountGlyphs },
  templates: { title: '章法模板', mount: mountTemplates },
  preview: { title: '钤印预览', mount: mountPreview },
  works: { title: '作品管理', mount: mountWorks },
};

const app = document.getElementById('app')!;

const nav = document.createElement('div');
nav.className = 'topnav';
nav.innerHTML = `<span class="brand">印稿设计坊</span>` +
  Object.entries(PAGES)
    .map(([k, p]) => `<a href="#/${k}" data-page="${k}">${p.title}</a>`)
    .join('');

const pageRoot = document.createElement('div');
pageRoot.className = 'page';
app.append(nav, pageRoot);

let cleanup: (() => void) | null = null;

function route() {
  const key = location.hash.replace(/^#\//, '') || 'design';
  const page = PAGES[key] ?? PAGES.design;
  nav.querySelectorAll('a').forEach((a) => {
    a.classList.toggle('active', (a as HTMLElement).dataset.page === (PAGES[key] ? key : 'design'));
  });
  if (cleanup) cleanup();
  pageRoot.innerHTML = '';
  cleanup = page.mount(pageRoot);
}

store.load();
window.addEventListener('hashchange', route);
route();
