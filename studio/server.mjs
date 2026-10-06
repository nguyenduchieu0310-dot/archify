import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MAX_TEXT_CHARS, buildPrompt, extractText, normalizeCandidate, parseUpload,
  projectTitle, readHistory, writeJsonAtomic,
} from './lib.mjs';

const studioDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(studioDir, '..');
const cliPath = path.join(repoDir, 'archify', 'bin', 'archify.mjs');
const dataDir = path.resolve(process.env.ARCHIFY_STUDIO_DATA || path.join(os.homedir(), '.archify-studio'));
const historyPath = path.join(dataDir, 'history.json');
const host = '127.0.0.1';
const port = Number(process.env.ARCHIFY_STUDIO_PORT || 4317);
let history = readHistory(historyPath);
let busy = false;

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readBody(request, limit = 19 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Dữ liệu gửi lên quá lớn.'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Yêu cầu JSON không hợp lệ.')); }
    });
    request.on('error', reject);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env || process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), options.timeout || 240000);
    child.stdout.on('data', part => { stdout = (stdout + part).slice(-60000); });
    child.stderr.on('data', part => { stderr = (stderr + part).slice(-60000); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(options.input || '');
  });
}

function extractJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

async function generateCandidate({ title, instructions, sourceText, previous, workDir }) {
  const output = path.join(workDir, 'codex-output.json');
  const prompt = buildPrompt({ title, instructions, sourceText, previous });
  const env = { ...process.env };
  // A configured API key must not silently switch Codex from ChatGPT plan usage to API billing.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '-C', workDir, '--output-last-message', output, '-'];
  const result = await run('codex', args, { cwd: workDir, input: prompt, env, timeout: 240000 });
  if (result.code !== 0 || !fs.existsSync(output)) {
    throw new Error(`Codex chưa tạo được sơ đồ: ${(result.stderr || result.stdout || 'unknown error').slice(-1400)}`);
  }
  return extractJson(fs.readFileSync(output, 'utf8'));
}

async function deliver(candidate, workDir) {
  const candidatePath = path.join(workDir, 'candidate.json');
  const artifactPath = path.join(workDir, 'diagram.html');
  writeJsonAtomic(candidatePath, candidate);
  const result = await run(process.execPath,
    [cliPath, 'deliver', 'architecture', candidatePath, artifactPath, '--quality', 'standard', '--json'],
    { cwd: workDir, timeout: 120000 });
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { /* Use stderr below. */ }
  if (result.code !== 0 || !fs.existsSync(artifactPath)) {
    const diagnostics = receipt?.diagnostics?.map(item => `${item.code}: ${item.message}`).join('; ');
    throw new Error(`Bản vẽ chưa qua kiểm tra: ${diagnostics || result.stderr || result.stdout}`.slice(0, 2400));
  }
  return { candidatePath, artifactPath };
}

async function createVersion(body) {
  const title = projectTitle(body.title);
  const instructions = String(body.instructions || '').trim().slice(0, 10000);
  const manual = body.mode === 'manual';
  const upload = parseUpload(body.file);
  if (!manual && !upload && !instructions) throw new Error('Hãy nhập mô tả hoặc chọn tài liệu.');
  if (manual && !String(body.manualJson || '').trim()) throw new Error('Hãy dán JSON sơ đồ.');

  const existing = body.projectId
    ? history.projects.find(project => project.id === body.projectId)
    : null;
  if (body.projectId && !existing) throw new Error('Không tìm thấy bản vẽ cần tạo phiên bản mới.');
  const projectId = existing?.id || randomUUID();
  const versionId = randomUUID();
  const workDir = path.join(dataDir, 'projects', projectId, versionId);
  fs.mkdirSync(workDir, { recursive: true });
  let sourceText = '';
  if (upload) {
    fs.writeFileSync(path.join(workDir, upload.name), upload.bytes, { flag: 'wx' });
    if (!manual) sourceText = await extractText(upload);
  }
  if (!manual && upload && !sourceText.trim()) {
    throw new Error('Không đọc được chữ trong tài liệu. PDF quét ảnh cần OCR trước khi nhập.');
  }
  const previousVersion = existing?.versions.at(-1);
  let previous;
  if (previousVersion) {
    const previousPath = path.join(dataDir, 'projects', projectId, previousVersion.id, 'candidate.json');
    previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
  }
  let candidate = manual
    ? extractJson(String(body.manualJson).slice(0, 120000))
    : await generateCandidate({ title, instructions, sourceText, previous, workDir });
  candidate = normalizeCandidate(candidate, title);
  let failure;
  for (let attempt = 0; attempt < (manual ? 1 : 3); attempt += 1) {
    try {
      await deliver(candidate, workDir);
      failure = null;
      break;
    } catch (error) {
      failure = error;
      if (attempt === 2 || manual) break;
      candidate = normalizeCandidate(await generateCandidate({
        title,
        instructions: `${instructions}\nRepair the JSON according to this exact validation error: ${error.message}`,
        sourceText,
        previous: candidate,
        workDir,
      }), title);
    }
  }
  if (failure) throw failure;

  const now = new Date().toISOString();
  const project = existing || { id: projectId, title, createdAt: now, versions: [] };
  project.title = title;
  project.versions.push({ id: versionId, createdAt: now, mode: manual ? 'manual' : 'codex',
    instructions, sourceName: upload?.name || null });
  if (!existing) history.projects.unshift(project);
  writeJsonAtomic(historyPath, history);
  return { projectId, versionId };
}

function existingArtifact(projectId, versionId, kind) {
  const project = history.projects.find(item => item.id === projectId);
  if (!project?.versions.some(version => version.id === versionId)) return null;
  return path.join(dataDir, 'projects', projectId, versionId,
    kind === 'source' ? 'candidate.json' : 'diagram.html');
}

async function handler(request, response) {
  const base = `http://${host}:${port}`;
  const url = new URL(request.url, base);
  if (request.headers.origin && request.headers.origin !== base) {
    return json(response, 403, { error: 'Nguồn yêu cầu không được phép.' });
  }
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return response.end(fs.readFileSync(path.join(studioDir, 'index.html')));
  }
  if (request.method === 'GET' && url.pathname === '/app.css') {
    response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    return response.end(fs.readFileSync(path.join(studioDir, 'app.css')));
  }
  if (request.method === 'GET' && url.pathname === '/app.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return response.end(fs.readFileSync(path.join(studioDir, 'app.js')));
  }
  if (request.method === 'GET' && url.pathname === '/api/history') return json(response, 200, history);
  if (request.method === 'GET' && url.pathname === '/api/template') {
    const template = JSON.parse(fs.readFileSync(path.join(repoDir, 'archify', 'examples', 'web-app.architecture.json'), 'utf8'));
    template.meta.output = 'diagram.html';
    response.setHeader('Content-Disposition', 'attachment; filename="archify-template.json"');
    return json(response, 200, template);
  }
  const artifact = url.pathname.match(/^\/api\/(diagram|source)\/([0-9a-f-]+)\/([0-9a-f-]+)$/);
  if (request.method === 'GET' && artifact) {
    const file = existingArtifact(artifact[2], artifact[3], artifact[1]);
    if (!file || !fs.existsSync(file)) return json(response, 404, { error: 'Không tìm thấy phiên bản.' });
    response.writeHead(200, {
      'Content-Type': artifact[1] === 'source' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      'Content-Disposition': artifact[1] === 'source' ? 'attachment; filename="candidate.json"' : 'inline',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': artifact[1] === 'diagram' ? "frame-ancestors 'self'" : "default-src 'none'",
    });
    return fs.createReadStream(file).pipe(response);
  }
  if (request.method === 'POST' && url.pathname === '/api/generate') {
    if (busy) return json(response, 409, { error: 'Studio đang tạo một bản vẽ khác. Vui lòng đợi.' });
    busy = true;
    try {
      const body = await readBody(request);
      return json(response, 201, await createVersion(body));
    } finally { busy = false; }
  }
  return json(response, 404, { error: 'Không tìm thấy.' });
}

const server = http.createServer((request, response) => {
  handler(request, response).catch(error => {
    if (!response.headersSent) json(response, 400, { error: error.message || 'Không thể xử lý yêu cầu.' });
    else response.destroy();
  });
});
server.listen(port, host, () => {
  console.log(`Archify Studio: http://${host}:${port}`);
  console.log(`History: ${dataDir}`);
});
