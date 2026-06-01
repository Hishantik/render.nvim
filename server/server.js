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

function Server(settings) {
	this.settings = settings;
	this.connections = [];
	var self = this;
	this.files = new filemanager(file => self.sendFileGoto(file));
}

Server.prototype.start = function() {
	this.httpServer = http.createServer(this.httpRequest.bind(this));
	this.webSocketServer = new websocket.server({ httpServer: this.httpServer, autoAcceptConnections: false });
	this.webSocketServer.on('request', this.webSocketRequest.bind(this));

	const port = this.settings['port'] || 13378;
	this.settings['allow-remote-web']
		? this.httpServer.listen(port)
		: this.httpServer.listen(port, this.settings['web-address'] || '127.0.0.1');
};

Server.prototype.stop = function() {
	this.httpServer.close();
};

Server.prototype.httpRequest = function(request, response) {
	if (request.method === 'GET') {
		this.handleFileRequest(request, response);
	} else if (request.method === 'POST' && (this.settings['allow-remote-editor'] || request.connection.remoteAddress.includes(this.settings['editor-address']))) {
		let postData = '';
		request.on('data', data => { postData += data; });
		request.on('end', () => {
			response.writeHead(200);
			response.end();
			this.parseEditorRequest(postData);
		});
	}
};

Server.prototype.parseEditorRequest = function(data) {
	if (data === 'ping') { this.sendPong(); return; }

	let command = data[0];
	let headerLength = data.indexOf(':', 2);
	let dataLength = parseInt(data.substr(2, headerLength - 2));
	let commandArgs = [data.substr(headerLength + 1, dataLength)];

	while (data[headerLength + dataLength + 1] === ':') {
		data = data.substr(headerLength + dataLength + 2);
		headerLength = data.indexOf(':');
		dataLength = parseInt(data.substr(0, headerLength));
		commandArgs.push(data.substr(headerLength + 1, dataLength));
	}

	this.handleEditorCommand(command, commandArgs);
	let remaining = data.substr(headerLength + dataLength + 1);
	if (remaining.length > 0) this.parseEditorRequest(remaining);
};

Server.prototype.handleEditorCommand = function(command, data) {
	const currentFile = this.files.getCurrentFile();

	switch (command) {
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
		case 'e': this.broadcast({ command: 'eval', js: data[0] }); break;
		case 'r': this.broadcast({ command: 'reload_page' }); break;
		case 'f':
			if (!this.files.getById(data[0])) this.files.newFile(data[0], data[1], data[2], data[3]);
			this.files.setCurrentFile(data[0]);
			break;
		case 'v': this.files.editorRoot = data[0]; break;
		case 'p':
			if (!currentFile || currentFile.errorState) break;
			currentFile.cursorX = data[0] - 1;
			currentFile.cursorY = data[1] - 1;

			let selector = null;
			if (currentFile.type === 'html') {
				selector = currentFile.tagFromPosition(currentFile.cursorX, currentFile.cursorY);
				if (selector != null) selector = selector.index;
			} else if (currentFile.type === 'css') {
				selector = currentFile.selectorFromPosition(currentFile.cursorX, currentFile.cursorY);
			}
			if (selector != null) this.sendSelect(selector);
			break;
		case 'c':
			// Configure validation rules: c:type:json_data
			// type: 'html' or 'css'
			// json_data: JSON encoded configuration
			var configType = data[0];
			var config = JSON.parse(data[1] || '{}');
			if (configType === 'html') {
				htmlfile.setRules(config.rules || {});
			} else if (configType === 'css') {
				if (config.rules) cssfile.setRules(config.rules);
				if (config.customValidators) {
					cssfile.clearValidators();
					config.customValidators.forEach(fn => cssfile.addValidator(fn));
				}
			}
			break;
	}
};

Server.prototype.stripParams = function(url) {
	return url.split('?')[0];
};

Server.prototype.handleFileRequest = function(request, response) {
	if (request.url === '/') {
		const currentFile = this.files.getCurrentHtmlFile();
		if (!currentFile) {
			response.writeHead(200);
			response.end(this.files.errorPage.webSrc('wait for file...', "vim hasn't opened an html file yet, or at least render isn't aware of any"));
		} else {
			response.writeHead(302, { Location: currentFile.path.relative });
			response.end();
		}
		return;
	}

	if (request.url === '/qr') {
		const url = `http://${request.headers.host}`;
		QRCode.toDataURL(url, { margin: 2 }, (err, dataUrl) => {
			if (err) {
				response.writeHead(500);
				response.end('Failed to generate QR code');
				return;
			}
			const html = `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mobile Preview - render.nvim</title>
<style>
	body { font-family: system-ui; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: #fff; }
	h1 { margin-bottom: 20px; }
	img { border: 4px solid #fff; border-radius: 8px; max-width: 250px; }
	.url { margin-top: 20px; padding: 12px 20px; background: #16213e; border-radius: 6px; font-family: monospace; word-break: break-all; text-align: center; }
	.btn { margin-top: 15px; padding: 10px 20px; background: #0f3460; color: #fff; border: none; border-radius: 6px; cursor: pointer; text-decoration: none; }
	a { color: #e94560; }
</style>
</head>
<body>
	<h1>Scan to Preview on Mobile</h1>
	<img src="${dataUrl}" alt="QR Code">
	<div class="url">${url}</div>
	<a class="btn" href="${url}" target="_blank">Open Preview</a>
</body>
</html>`;
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(html);
		});
		return;
	}

	const url = this.stripParams(request.url);
	const file = this.files.getByWebPath(url);
	const self = this;

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
		const editorRoot = (this.files.editorRoot || '').replace(/\/+$/, '');
		fs.readFile(path.join(editorRoot, url), (err, data) => {
			response.writeHead(err ? 404 : 200, err ? undefined : { "Content-Type": mime.lookup(url) });
			response.end(err ? self.files.errorPage.webSrc('file could not be read', err.toString()) : data);
		});
	}
};

Server.prototype.webSocketRequest = function(request) {
	const connection = request.accept('', request.origin);
	this.connections.push(connection);
	connection.on('close', () => this.connections.splice(this.connections.indexOf(connection), 1));
	connection.on('message', () => { /* TODO: handle client messages */ });
};

var lastGoto = '';
Server.prototype.sendGoto = function(location) {
	if (lastGoto !== location) { this.broadcast({ command: 'goto', location }); lastGoto = location; }
};

Server.prototype.sendFileGoto = function(file) {
	if (!file || !file.path || !file.path.relative) return;
	const filename = path.basename(file.path.relative);
	if (lastGoto !== filename) { this.broadcast({ command: 'goto', location: filename }); lastGoto = filename; }
};

Server.prototype.sendPong = function() { this.broadcast({ command: 'pong' }); };

Server.prototype.sendEdit = function(diff) { this.broadcast({ command: 'edit', changes: diff }); };

Server.prototype.setError = function(message) {
	if (!this.hasError && !message) return;
	if (message) {
		this.hasError = true;
		const err = message[0];
		this.broadcast({ command: 'error', action: 'show', message: `${err.line}:${err.col}: ${err.message}` });
	} else {
		this.hasError = false;
		this.broadcast({ command: 'error', action: 'clear' });
	}
};

var lastSelector;
Server.prototype.sendSelect = function(selector) {
	const cmd = { command: 'select' };
	let hasChange = false;
	if (selector !== lastSelector) {
		if (typeof selector === 'number') { cmd.index = selector; hasChange = true; }
		else if (typeof selector === 'string') { cmd.selector = selector; hasChange = true; }
		lastSelector = selector;
	}
	if (hasChange) this.broadcast(cmd);
};

Server.prototype.broadcast = function(command) {
	this.connections.forEach(c => c.sendUTF(JSON.stringify(command)));
};

module.exports = Server;
