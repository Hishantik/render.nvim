# TypeScript/TSX Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live TypeScript and TSX transpilation to render.nvim using esbuild.

**Architecture:** A new `tsfile.js` module wraps esbuild's `transformSync` API. The server transpiles TS/TSX to JS before eval'ing in the browser. Two call sites: buffer updates (live editing) and file serving (HTTP requests).

**Tech Stack:** esbuild (transpiler), Node.js (server runtime)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `server/tsfile.js` | **New.** esbuild wrapper — transpiles TS/TSX to JS |
| `server/package.json` | **Modify.** Add `esbuild` dependency |
| `server/server.js` | **Modify.** Wire `typescript` type into buffer handler and file serving |

---

### Task 1: Add esbuild dependency

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add esbuild to package.json**

Edit `server/package.json` to add esbuild to the dependencies object:

```json
{
  "dependencies": {
    "csslint": "^1.0.5",
    "domhandler": "^2.3.0",
    "domutils": "^1.5.1",
    "esbuild": "^0.25.0",
    "htmlhint": "^0.11.0",
    "htmlparser2": "^3.9.0",
    "mime": "^1.3.4",
    "postcss": "^8.2.10",
    "qrcode": "^1.5.4",
    "websocket": "^1.0.32"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd /storage/3038-3431/Projects/github/render.nvim/server && npm install`

Expected: esbuild installs successfully, no errors.

- [ ] **Step 3: Verify esbuild is installed**

Run: `cd /storage/3038-3431/Projects/github/render.nvim/server && node -e "require('esbuild'); console.log('esbuild OK')"`

Expected: `esbuild OK`

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "deps: add esbuild for TypeScript transpilation"
```

---

### Task 2: Create tsfile.js transpiler module

**Files:**
- Create: `server/tsfile.js`

- [ ] **Step 1: Create tsfile.js with transpile function**

Create `server/tsfile.js`:

```js
var esbuild = require('esbuild');
var path = require('path');

/**
 * Transpile TypeScript or TSX source to JavaScript.
 * @param {string} source - The TS/TSX source code
 * @param {string} filePath - The file path (used to detect .tsx vs .ts)
 * @returns {{ js: string|null, error: string|null }}
 */
function transpile(source, filePath) {
	var ext = path.extname(filePath).toLowerCase();
	var isTsx = ext === '.tsx';

	try {
		var result = esbuild.transformSync(source, {
			loader: isTsx ? 'tsx' : 'ts',
			jsx: isTsx ? 'transform' : undefined,
			jsxFactory: 'React.createElement',
			jsxFragment: 'React.Fragment',
			target: 'es2017',
			format: 'iife',
		});
		return { js: result.code, error: null };
	} catch (e) {
		var msg = e.message || String(e);
		// esbuild errors include file path and location — extract just the message
		return { js: null, error: msg };
	}
}

module.exports = { transpile: transpile };
```

- [ ] **Step 2: Verify the module loads**

Run: `cd /storage/3038-3431/Projects/github/render.nvim/server && node -e "var ts = require('./tsfile.js'); console.log(typeof ts.transpile)"`

Expected: `function`

- [ ] **Step 3: Verify transpilation works for .ts**

Run:

```bash
cd /storage/3038-3431/Projects/github/render.nvim/server && node -e "
var ts = require('./tsfile.js');
var result = ts.transpile('const x: number = 1; console.log(x);', '/test.ts');
console.log('error:', result.error);
console.log('js:', result.js);
"
```

Expected: `error: null`, `js` contains transpiled JavaScript without type annotation.

- [ ] **Step 4: Verify transpilation works for .tsx**

Run:

```bash
cd /storage/3038-3431/Projects/github/render.nvim/server && node -e "
var ts = require('./tsfile.js');
var result = ts.transpile('const el = <div>Hello</div>;', '/test.tsx');
console.log('error:', result.error);
console.log('js:', result.js);
"
```

Expected: `error: null`, `js` contains `React.createElement("div", ...)`.

- [ ] **Step 5: Verify error handling for invalid syntax**

Run:

```bash
cd /storage/3038-3431/Projects/github/render.nvim/server && node -e "
var ts = require('./tsfile.js');
var result = ts.transpile('const x: number = ;', '/test.ts');
console.log('error:', result.error);
console.log('js:', result.js);
"
```

Expected: `js: null`, `error` contains a non-empty error message.

- [ ] **Step 6: Commit**

```bash
git add server/tsfile.js
git commit -m "feat: add tsfile.js transpiler module using esbuild"
```

---

### Task 3: Wire TypeScript into server buffer handler

**Files:**
- Modify: `server/server.js:1-10` (add require)
- Modify: `server/server.js:84-86` (add typecase)

- [ ] **Step 1: Add tsfile require at top of server.js**

Add `var tsfile = require("./tsfile.js");` after the existing requires in `server/server.js`. The top of the file should read:

```js
var VERSION = "0.0.1";
var websocket = require("websocket");
var http = require("http");
var fs = require("fs");
var path = require("path");
var mime = require("mime");
var QRCode = require("qrcode");
var filemanager = require("./filemanager.js");
var htmlfile = require("./htmlfile.js");
var cssfile = require("./cssfile.js");
var tsfile = require("./tsfile.js");
```

- [ ] **Step 2: Add typecase to buffer update handler**

In `server/server.js`, in the `handleEditorCommand` method, case `'b'`, add a `typescript` branch after the `javascript` branch. The full case block should read:

```js
case 'b':
    if (!currentFile) break;
    if (currentFile.type === 'html') {
        currentFile.setContent(data[0], (err, diff) => {
            this.setError(err);
            if (!err && diff) this.sendEdit(diff);
        });
    } else if (currentFile.type === 'css') {
        currentFile.setContent(data[0], err => {
            this.setError(err);
            if (!err) this.broadcast({ command: 'reload_css' });
        });
    } else if (currentFile.type === 'javascript') {
        this.broadcast({ command: 'eval', js: data[0] });
    } else if (currentFile.type === 'typescript') {
        var result = tsfile.transpile(data[0], currentFile.path.system);
        if (result.error) {
            this.setError(result.error);
        } else {
            this.broadcast({ command: 'eval', js: result.js });
        }
    }
    break;
```

- [ ] **Step 3: Commit**

```bash
git add server/server.js
git commit -m "feat: wire TypeScript transpilation into buffer update handler"
```

---

### Task 4: Wire TypeScript into file serving

**Files:**
- Modify: `server/server.js:183-193` (handleFileRequest)

- [ ] **Step 1: Add typecase to file request handler**

In `server/server.js`, in the `handleFileRequest` method, modify the file-serving block to transpile TypeScript files before sending. The block starting at line 183 should become:

```js
if (file) {
    if (file.type === 'typescript') {
        var result = tsfile.transpile(file.source, file.path.system);
        if (result.error) {
            response.writeHead(500);
            response.end('Transpilation error: ' + result.error);
        } else {
            response.writeHead(200, { "Content-Type": "application/javascript" });
            response.end(result.js);
        }
    } else {
        response.writeHead(200, { "Content-Type": mime.lookup(url) });
        response.end(file.webSrc());
    }
} else {
```

- [ ] **Step 2: Commit**

```bash
git add server/server.js
git commit -m "feat: transpile TypeScript files when serving over HTTP"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start the server and verify it loads**

Run: `cd /storage/3038-3431/Projects/github/render.nvim/server && node launch.js --port 13379`

Expected: Server starts without errors, prints startup log. Kill it with Ctrl+C after verifying.

- [ ] **Step 2: Create a test TypeScript file and verify transpilation end-to-end**

Run:

```bash
cd /storage/3038-3431/Projects/github/render.nvim/server && node -e "
var tsfile = require('./tsfile.js');

// Test .ts
var r1 = tsfile.transpile('interface User { name: string; age: number; }\nconst u: User = { name: \"test\", age: 1 };\nconsole.log(u.name);', '/app.ts');
console.log('TS result:', r1.error ? 'ERROR: ' + r1.error : 'OK');
console.log(r1.js);

// Test .tsx
var r2 = tsfile.transpile('const App = () => <div><h1>Hello</h1></div>;', '/app.tsx');
console.log('TSX result:', r2.error ? 'ERROR: ' + r2.error : 'OK');
console.log(r2.js);
"
```

Expected: Both produce valid JS output with no errors. TSX output contains `React.createElement`.

- [ ] **Step 3: Verify error reporting works**

Run:

```bash
cd /storage/3038-3431/Projects/github/render.nvim/server && node -e "
var tsfile = require('./tsfile.js');
var r = tsfile.transpile('const x: = 1;', '/bad.ts');
console.log('Error:', r.error);
"
```

Expected: Non-empty error message, `js` is null.
