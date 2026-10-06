const state = { history: { projects: [] }, projectId: null, versionId: null, mode: 'manual' };
const $ = id => document.getElementById(id);
const formatDate = date => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));

async function loadHistory() {
  const response = await fetch('/api/history');
  state.history = await response.json();
  render();
}

function selectedProject() {
  return state.history.projects.find(project => project.id === state.projectId);
}

function renderProjects() {
  const projects = $('projects');
  projects.replaceChildren();
  const search = $('search').value.trim().toLocaleLowerCase('vi');
  for (const project of state.history.projects.filter(item => item.title.toLocaleLowerCase('vi').includes(search))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `project${project.id === state.projectId ? ' active' : ''}`;
    const title = document.createElement('strong');
    title.textContent = project.title;
    const meta = document.createElement('small');
    meta.textContent = `${project.versions.length} phiên bản · ${formatDate(project.versions.at(-1).createdAt)}`;
    button.append(title, meta);
    button.addEventListener('click', () => {
      state.projectId = project.id;
      state.versionId = project.versions.at(-1)?.id || null;
      $('title').value = project.title;
      render();
    });
    projects.append(button);
  }
  $('project-count').textContent = state.history.projects.length;
}

function renderVersions() {
  const project = selectedProject();
  const versions = $('versions');
  versions.replaceChildren();
  $('version-count').textContent = `${project?.versions.length || 0} phiên bản`;
  if (!project) {
    const empty = document.createElement('p');
    empty.className = 'no-versions';
    empty.textContent = 'Chưa có phiên bản nào.';
    versions.append(empty);
    $('empty-preview').hidden = false;
    $('preview').hidden = true;
    $('version-actions').hidden = true;
    return;
  }
  for (let i = project.versions.length - 1; i >= 0; i--) {
    const version = project.versions[i];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `version${version.id === state.versionId ? ' active' : ''}`;
    const details = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = `Phiên bản ${i + 1}`;
    const meta = document.createElement('small');
    meta.textContent = `${formatDate(version.createdAt)}${version.sourceName ? ` · ${version.sourceName}` : ''}`;
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = version.mode === 'manual' ? 'CỤC BỘ' : 'CODEX';
    details.append(title, meta);
    button.append(details, tag);
    button.addEventListener('click', () => { state.versionId = version.id; render(); });
    versions.append(button);
  }
  const chosen = project.versions.find(version => version.id === state.versionId) || project.versions.at(-1);
  if (chosen) {
    state.versionId = chosen.id;
    const base = `/${encodeURIComponent(project.id)}/${encodeURIComponent(chosen.id)}`;
    const diagram = `/api/diagram${base}`;
    $('preview').src = diagram;
    $('preview').hidden = false;
    $('empty-preview').hidden = true;
    $('open-diagram').href = diagram;
    $('download-json').href = `/api/source${base}`;
    $('version-actions').hidden = false;
  }
}

function render() {
  const project = selectedProject();
  $('page-title').textContent = project?.title || 'Tạo bản vẽ mới';
  renderProjects();
  renderVersions();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  $('codex-fields').hidden = mode !== 'codex';
  $('manual-fields').hidden = mode !== 'manual';
}

async function loadJsonFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Hãy chọn file .json.');
  if (file.size > 120000) throw new Error('File JSON quá lớn (tối đa 120 KB).');
  const content = await file.text();
  const parsed = JSON.parse(content);
  $('manual-json').value = JSON.stringify(parsed, null, 2);
  if (!$('title').value.trim() && parsed?.meta?.title) $('title').value = String(parsed.meta.title).slice(0, 120);
  $('json-dropzone').textContent = `✓ ${file.name}`;
  setStatus('Đã nạp JSON. Bấm “Tạo bản vẽ” để kiểm tra và lưu phiên bản.', true);
}

function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp.'));
    reader.onload = () => resolve({ name: file.name, base64: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  });
}

function setStatus(text, ok = false) {
  $('form-status').textContent = text;
  $('form-status').classList.toggle('ok', ok);
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
$('new-project').addEventListener('click', () => {
  state.projectId = null;
  state.versionId = null;
  $('create-form').reset();
  $('file-label').textContent = 'Chọn hoặc kéo tài liệu vào đây';
  $('json-dropzone').textContent = '↥   Chọn hoặc kéo file .json từ ChatGPT Web vào đây';
  setStatus('');
  render();
});
$('search').addEventListener('input', renderProjects);
$('copy-prompt').addEventListener('click', async () => {
  const prompt = `Hãy đọc tài liệu tôi cung cấp và tạo MỘT đối tượng JSON hợp lệ cho Archify architecture diagram. Chỉ trả về JSON, không Markdown. Cấu trúc bắt buộc: {"schema_version":1,"diagram_type":"architecture","meta":{"title":"Tên sơ đồ","output":"diagram.html"},"components":[{"id":"user","type":"external","label":"Người dùng","pos":[40,120],"size":[140,62]},{"id":"app","type":"backend","label":"Ứng dụng","pos":[300,120],"size":[150,62]}],"connections":[{"id":"user-app","from":"user","to":"app","label":"Yêu cầu"}]}. Hãy thay toàn bộ nội dung ví dụ bằng sự thật trong tài liệu. Component type chỉ dùng frontend, backend, database, cloud, security, messagebus, external. Mỗi id là duy nhất; mỗi connection from/to phải trỏ đến id component có thật. Bố trí pos đủ thoáng để các hộp và nhãn không chồng nhau. Không suy diễn thành phần không có trong tài liệu.`;
  try { await navigator.clipboard.writeText(prompt); setStatus('Đã sao chép yêu cầu. Dán vào ChatGPT Web cùng tài liệu của anh.', true); }
  catch { setStatus('Trình duyệt không cho sao chép tự động. Hãy mở trang bằng http://127.0.0.1.'); }
});
$('edit-version').addEventListener('click', async () => {
  const project = selectedProject();
  if (!project || !state.versionId) return;
  try {
    const response = await fetch(`/api/source/${project.id}/${state.versionId}`);
    if (!response.ok) throw new Error('Không đọc được JSON nguồn.');
    $('manual-json').value = JSON.stringify(await response.json(), null, 2);
    $('title').value = project.title;
    setMode('manual');
    setStatus('Đã nạp JSON của phiên bản này. Sau khi sửa, bấm “Tạo bản vẽ” để lưu phiên bản mới.', true);
    $('manual-json').focus();
  } catch (error) { setStatus(error.message); }
});
$('file').addEventListener('change', () => {
  $('file-label').textContent = $('file').files[0]?.name || 'Chọn hoặc kéo tài liệu vào đây';
});
$('json-file').addEventListener('change', () => {
  loadJsonFile($('json-file').files[0]).catch(error => setStatus(error.message));
});
for (const eventName of ['dragenter', 'dragover']) {
  $('json-dropzone').addEventListener(eventName, event => { event.preventDefault(); $('json-dropzone').classList.add('dragging'); });
}
for (const eventName of ['dragleave', 'drop']) {
  $('json-dropzone').addEventListener(eventName, event => { event.preventDefault(); $('json-dropzone').classList.remove('dragging'); });
}
$('json-dropzone').addEventListener('drop', event => {
  loadJsonFile(event.dataTransfer.files[0]).catch(error => setStatus(error.message));
});
for (const eventName of ['dragenter', 'dragover']) {
  $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
}
for (const eventName of ['dragleave', 'drop']) {
  $('dropzone').addEventListener(eventName, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
}
$('dropzone').addEventListener('drop', event => {
  if (event.dataTransfer.files.length) {
    $('file').files = event.dataTransfer.files;
    $('file-label').textContent = $('file').files[0].name;
  }
});
$('create-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('generate').disabled = true;
  setStatus(state.mode === 'codex' ? 'Codex đang đọc tài liệu và tạo sơ đồ. Có thể mất vài phút…' : 'Đang kiểm tra và dựng sơ đồ…', true);
  try {
    const file = state.mode === 'codex' && $('file').files[0] ? await fileData($('file').files[0]) : null;
    const response = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: state.projectId, title: $('title').value, mode: state.mode,
        instructions: $('instructions').value, manualJson: $('manual-json').value, file,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không tạo được bản vẽ.');
    state.projectId = result.projectId;
    state.versionId = result.versionId;
    await loadHistory();
    setStatus('Đã tạo và lưu phiên bản mới.', true);
  } catch (error) { setStatus(error.message); }
  finally { $('generate').disabled = false; }
});
loadHistory().catch(error => setStatus(`Không tải được lịch sử: ${error.message}`));
