'use strict';

const collator = new Intl.Collator('zh');

const state = {
  view: 'prompts',
  data: null,
};

// 弹窗关闭后要把焦点还回去的元素
let lastFocused = null;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function $(selector) {
  return document.querySelector(selector);
}

function isDrawer() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function columnCount() {
  const width = window.innerWidth;
  if (width < 640) return 1;
  if (width < 1024) return 2;
  return 3;
}

function buildColumns() {
  const container = $('#masonry');
  container.innerHTML = '';

  const columns = Array.from({ length: columnCount() }, () => {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    container.appendChild(col);
    return col;
  });
  return columns;
}

function renderMasonry(items) {
  const columns = buildColumns();

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
  const card = document.createElement('article');
  card.className = 'card';

  const title = document.createElement('h3');
  title.className = 'card-title';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'card-link';
  link.textContent = item.title;
  link.addEventListener('click', () => openModal(item));
  title.appendChild(link);
  card.appendChild(title);

  if (item.intro) {
    const intro = document.createElement('p');
    intro.className = 'card-intro';
    intro.textContent = item.intro;
    card.appendChild(intro);
  }

  if (item.category) {
    const tag = document.createElement('span');
    tag.className = 'card-tag';
    tag.textContent = item.category;
    card.appendChild(tag);
  }

  return card;
}

function createSkeleton() {
  const card = document.createElement('div');
  card.className = 'skeleton-card';

  const title = document.createElement('span');
  title.className = 'skeleton-line skeleton-title';

  const line = document.createElement('span');
  line.className = 'skeleton-line';

  const short = document.createElement('span');
  short.className = 'skeleton-line skeleton-short';

  card.append(title, line, short);
  return card;
}

function renderSkeleton() {
  buildColumns().forEach((col) => {
    col.append(createSkeleton(), createSkeleton());
  });
}

function createStatePanel(titleText, descText) {
  const panel = document.createElement('div');
  panel.className = 'state-panel';

  const title = document.createElement('p');
  title.className = 'state-title';
  title.textContent = titleText;

  const desc = document.createElement('p');
  desc.className = 'state-desc';
  desc.textContent = descText;

  panel.append(title, desc);
  return panel;
}

function renderState(panel) {
  const container = $('#masonry');
  container.innerHTML = '';
  container.appendChild(panel);
}

function renderEmpty() {
  renderState(
    createStatePanel(
      '暂无内容',
      '这个列表还没有条目。在 content 目录下添加 Markdown 文件后，运行 python3 build.py 重新构建即可。'
    )
  );
}

function errorHint(error) {
  if (window.location.protocol === 'file:') {
    return 'file:// 模式无法读取 data.json，请通过 HTTP 访问：在项目目录运行 bash scripts/restart.sh，再打开 http://localhost:8001';
  }
  if (error.message.indexOf('404') !== -1) {
    return 'data.json 不存在，请先在项目目录运行 python3 build.py 生成数据';
  }
  return error.message;
}

function renderError(error) {
  const hint = errorHint(error);
  const panel = createStatePanel('数据加载失败', hint);

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-primary';
  retry.textContent = '重试';
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    retry.textContent = '重试中…';
    // 重试成功后焦点留在内容区，避免键盘用户被丢回页面顶部
    if (await load()) $('#masonry').focus();
  });
  panel.appendChild(retry);

  renderState(panel);
  announce('数据加载失败：' + hint);
}

function render() {
  const items = state.data[state.view];
  const isPrompts = state.view === 'prompts';
  const title = isPrompts ? 'Prompts' : 'Skills';

  $('#view-title').textContent = title;
  $('#view-count').textContent = items.length + ' 条';
  announce(title + '，共 ' + items.length + ' 条');

  if (!items.length) {
    renderEmpty();
    return;
  }

  renderMasonry([...items].sort(compareItems));
}

function compareItems(a, b) {
  const byCategory = collator.compare(a.category || '', b.category || '');
  return byCategory !== 0 ? byCategory : collator.compare(a.title, b.title);
}

function announce(message) {
  const status = $('#status');
  if (status.textContent === message) return;
  status.textContent = message;
}

function openModal(item) {
  lastFocused = document.activeElement;
  $('#modal-title').textContent = item.title;

  const categoryEl = $('#modal-category');
  categoryEl.textContent = item.category || '';
  categoryEl.hidden = !item.category;

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
      announce(ok ? '已复制原始 Markdown' : '复制失败，请手动选择文本复制');
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
  document.body.classList.add('modal-open');
  $('#modal-close').focus();
}

function hideModal() {
  if ($('#modal').hidden) return;

  $('#modal').hidden = true;
  document.body.classList.remove('modal-open');

  if (lastFocused && document.body.contains(lastFocused)) {
    lastFocused.focus();
  }
  lastFocused = null;
}

function trapFocus(event) {
  if (event.key !== 'Tab') return;

  const nodes = Array.from($('#modal-box').querySelectorAll(FOCUSABLE));
  if (!nodes.length) return;

  const first = nodes[0];
  const last = nodes[nodes.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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
  const wasOpen = sidebar.classList.contains('is-open');

  sidebar.classList.toggle('is-open', open);
  $('#scrim').hidden = !open;
  document.body.classList.toggle('drawer-open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));

  if (!isDrawer() || wasOpen === open) return;
  if (open) {
    $('#sidebar-close').focus();
  } else {
    $('#menu-toggle').focus();
  }
}

function selectView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('is-active', active);
    if (active) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
  render();
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
      selectView(button.dataset.view);
      setDrawer(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideModal();
      setDrawer(false);
      return;
    }
    if (!$('#modal').hidden) {
      trapFocus(event);
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!isDrawer() && $('#sidebar').classList.contains('is-open')) {
        setDrawer(false);
      }
      if (state.data) render();
    }, 150);
  });
}

async function fetchData() {
  const response = await fetch('data.json');
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return await response.json();
}

async function load() {
  const masonry = $('#masonry');
  renderSkeleton();
  masonry.setAttribute('aria-busy', 'true');

  try {
    state.data = await fetchData();
    masonry.removeAttribute('aria-busy');
    render();
    return true;
  } catch (error) {
    masonry.removeAttribute('aria-busy');
    renderError(error);
    return false;
  }
}

async function init() {
  bindUI();
  await load();
}

init();
