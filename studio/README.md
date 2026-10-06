# Archify Studio (local)

Studio adds a browser input screen and local version history. It runs on
`127.0.0.1`; generated diagrams remain standalone Archify HTML files.

## Start

From `studio/`:

```sh
npm ci
npm start
```

Open <http://127.0.0.1:4317>. To change the port, set `ARCHIFY_STUDIO_PORT`.
History is stored under `~/.archify-studio` unless `ARCHIFY_STUDIO_DATA` is set.

## No separate API billing

**Nhập JSON** is the default. Create Archify JSON in ChatGPT Web or another
editor, upload a `.json` file or paste it, and click **Tạo bản vẽ**. Studio
runs the bundled Archify validator and renderer locally. It makes no AI call.
The **Sao chép yêu cầu cho ChatGPT** button gives a short prompt; a checked
sample is available through **Tải JSON mẫu**. A generated JSON still needs to
pass Archify validation before it is saved as a version.

**Tạo bằng Codex** is optional. It requires a local `codex` CLI signed in with
ChatGPT. It accepts PDF, DOCX, TXT, and Markdown up to 12 MB, extracts text
locally, and asks Codex to generate architecture JSON. Codex usage counts
against the signed-in plan's allowance and any applicable credits. Studio does
not read an API key and removes `OPENAI_API_KEY`/`CODEX_API_KEY` from the child
environment. Scanned PDFs without extractable text require OCR first.

Each successful generation creates a new immutable version with source JSON,
HTML, and optional uploaded document. Select an older version to view it, or
choose **Sửa từ bản này** to load its JSON and save another version. Existing
versions are never overwritten.

Studio intentionally supports Architecture diagrams first. Other Archify modes
can be added after their input contracts and authoring workflows are designed.
