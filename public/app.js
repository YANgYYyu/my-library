'use strict';

const collator = new Intl.Collator('zh');

const state = {
  view: 'prompts',
  data: null,
};

function $(selector) {
  return document.querySelector(selector);
}

function columnCount() {
  const width = window.innerWidth;
  if (width < 640) return 1;
  if (width < 1024) return 2;
  return 3;
}

function renderMasonry(items) {
  const container = $('#masonry');
  container.innerHTML = '';

  const columns = Array.from({ length: columnCount() }, () => {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    return col;
  });
  columns.forEach((col) => container.appendChild(col));

  items.forEach((item) => {
    let shortest = 0;
    let shortestHeight = Infinity;
    columns.forEach((col, index) => {
      if (col.offsetHeight < shortestHeight) {
        shortestHeight = col.offsetHeight;
        shortest = index;
      }
    });
    columns[shortest].appendChild(createCard(item));
  });
}

function createCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = item.title;

  const intro = document.createElement('p');
  intro.className = 'card-intro';
  intro.textContent = item.intro || '';

  card.append(title, intro);
  card.addEventListener('click', () => openModal(item));
  return card;
}

function render() {
  const items = state.data[state.view];
  const isPrompts = state.view === 'prompts';
  $('#view-title').textContent = isPrompts ? 'Prompts' : 'Skills';
  $('#view-count').textContent = items.length + ' 条';

  const sorted = [...items].sort((a, b) => collator.compare(a.title, b.title));
  renderMasonry(sorted);
}

function openModal(item) {
  $('#modal-title').textContent = item.title;

  const bodyEl = $('#modal-body');
  const actionsEl = $('#modal-actions');
  bodyEl.innerHTML = '';
  actionsEl.innerHTML = '';

  if (state.view === 'prompts') {
    try {
      bodyEl.innerHTML = marked.parse(item.body);
    } catch (error) {
      bodyEl.textContent = item.body;
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-primary';
    copyBtn.textContent = '复制原始 Markdown';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(item.body);
      copyBtn.textContent = ok ? '已复制' : '复制失败';
      window.setTimeout(() => {
        copyBtn.textContent = '复制原始 Markdown';
      }, 1500);
    });
    actionsEl.appendChild(copyBtn);
  } else {
    const intro = document.createElement('p');
    intro.className = 'skill-intro';
    intro.textContent = item.intro || '';
    bodyEl.appendChild(intro);

    const githubBtn = document.createElement('a');
    githubBtn.className = 'btn btn-primary';
    githubBtn.href = item.url;
    githubBtn.target = '_blank';
    githubBtn.rel = 'noopener noreferrer';
    githubBtn.textContent = '打开 GitHub';
    actionsEl.appendChild(githubBtn);
  }

  $('#modal').hidden = false;
}

function hideModal() {
  $('#modal').hidden = true;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // 降级到选中文本复制
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (error) {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function setDrawer(open) {
  const sidebar = $('#sidebar');
  const scrim = $('#scrim');
  sidebar.classList.toggle('is-open', open);
  sidebar.setAttribute('aria-hidden', String(!open));
  scrim.hidden = !open;
  document.body.classList.toggle('drawer-open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
}

function bindUI() {
  $('#menu-toggle').addEventListener('click', () => setDrawer(true));
  $('#sidebar-close').addEventListener('click', () => setDrawer(false));
  $('#scrim').addEventListener('click', () => setDrawer(false));
  $('#modal-close').addEventListener('click', hideModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) hideModal();
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((item) => {
        item.classList.toggle('is-active', item === button);
      });
      state.view = button.dataset.view;
      render();
      setDrawer(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideModal();
      setDrawer(false);
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (state.data) render();
    }, 150);
  });
}

async function init() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    state.data = await response.json();
    bindUI();
    render();
  } catch (error) {
    $('#masonry').textContent = '数据加载失败：' + error.message;
  }
}

init();
