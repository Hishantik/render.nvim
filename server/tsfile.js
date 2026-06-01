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
		});
		return { js: result.code, error: null };
	} catch (e) {
		var msg = e.message || String(e);
		return { js: null, error: msg };
	}
}

module.exports = { transpile: transpile };
