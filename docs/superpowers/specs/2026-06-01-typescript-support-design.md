# TypeScript/TSX Support Design

**Date:** 2026-06-01
**Status:** Approved

## Problem

The README claims TypeScript/TSX support, but the implementation is broken:
- The Vimscript side correctly hooks `.ts`/`.tsx` buffer events and sends content to the server
- The server has no TypeScript transpiler dependency
- The `handleEditorCommand` method in `server.js` has no `typescript` case in the buffer-update handler
- Raw TypeScript syntax (type annotations, interfaces, JSX) causes browser-side `SyntaxError` if eval'd

## Solution

Use **esbuild** to transpile TypeScript and TSX to JavaScript before eval'ing in the browser.

### Design Decisions

- **Transpile only, no type checking** — matches existing JS behavior (raw eval), keeps latency minimal
- **esbuild** chosen over @swc/core (heavier) and babel (slower) for speed and simplicity
- **JSX transform** enabled with default `React.createElement` factory

## Architecture

### New dependency

Add `esbuild` to `server/package.json` dependencies.

### New file: `server/tsfile.js`

Thin wrapper around esbuild's `transformSync` API:

- `transpile(tsCode, filePath)` → `{ js, error }`
- Detects `.tsx` from `filePath` extension to enable JSX transform
- Uses `esbuild.transformSync` for synchronous, low-latency transpilation
- Default JSX factory: `React.createElement`
- Returns structured error with line/column info on failure

### Changes to `server/server.js`

In `handleEditorCommand`, case `'b'` (buffer update), add a `typescript` handler after the `javascript` handler:

```js
} else if (currentFile.type === 'typescript') {
    const result = tsfile.transpile(data[0], currentFile.path.system);
    if (result.error) {
        this.setError(result.error);
    } else {
        this.broadcast({ command: 'eval', js: result.js });
    }
}
```

In `handleFileRequest`, when serving files from the file manager, transpile `.ts`/`.tsx` files before sending. Note: JS/TS file objects are plain `{ source, type }` without a `webSrc()` method, so use `file.source` directly:

```js
if (file && (file.type === 'typescript')) {
    const result = tsfile.transpile(file.source, file.path.system);
    if (result.error) {
        response.writeHead(500);
        response.end('Transpilation error: ' + result.error);
    } else {
        response.writeHead(200, { "Content-Type": "application/javascript" });
        response.end(result.js);
    }
    return;
}
```

### Changes to `server/filemanager.js`

No changes needed. The `newFile` method already handles `'typescript'` type by storing `{ source, type }`, which is sufficient.

### Vimscript changes

None needed. The existing autocmds already hook `.ts`/`.tsx` files for:
- `CursorMoved`/`CursorMovedI` → `render#setCursor()`
- `TextChanged`/`TextChangedI` → `render#bufferChange()`
- `BufWritePost` → `render#evalFile()`

## Files to modify

| File | Change |
|------|--------|
| `server/package.json` | Add `esbuild` dependency |
| `server/tsfile.js` | **New file** — esbuild wrapper |
| `server/server.js` | Add `typescript` case in buffer handler + file serving |
| `server/filemanager.js` | No changes |
| `autoload/render.vim` | No changes |

## Testing

1. Open a `.ts` file in Neovim, run `:Render` — should show transpiled JS in browser
2. Edit the `.ts` file — changes should reflect live in browser
3. Open a `.tsx` file with JSX — should transpile and render correctly
4. Introduce a syntax error in `.ts`/`.tsx` — should show error indicator in browser
5. Save a `.ts` file — should eval the transpiled output via `BufWritePost`
