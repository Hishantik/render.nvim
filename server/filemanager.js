var htmlfile = require("./htmlfile.js");
var cssfile = require("./cssfile.js");
var fs = require("fs");
var path = require("path");

function FileManager(changePageCallback) {
	this.changePageCallback = changePageCallback || (() => {});
	this.files = {};
	this.currentFile = undefined;
	this.currentHtmlFile = undefined;
	this.editorRoot = undefined;

	const injectedCss = fs.readFileSync('frontend.css', 'utf8');
	const injectedJs = fs.readFileSync('frontend.js', 'utf8');

	htmlfile.setCSS(injectedCss);
	htmlfile.setJS(injectedJs);
	this.errorPage.injectedJs = injectedJs;
}

FileManager.prototype.newFile = function(id, name, filePath, type, source) {
	if (source === undefined) source = '';

	// Normalize Neovim's 'typescriptreact' filetype to 'typescript'
	if (type === 'typescriptreact') type = 'typescript';

	var createdFile;
	switch (type) {
		case 'html': createdFile = new htmlfile(source); break;
		case 'css': createdFile = new cssfile(source); break;
		case 'javascript':
		case 'typescript':
			createdFile = { source: source, type: type };
			break;
		default: return;
	}

	createdFile.name = name;
	createdFile.path = {
		system: filePath,
		relative: this.editorRoot
			? path.relative(this.editorRoot, filePath)
			: path.basename(filePath)
	};
	createdFile.type = type;
	this.files[id] = createdFile;
};

FileManager.prototype.getById = function(id) { return this.files[id]; };
FileManager.prototype.getByPath = function() { throw new Error('not implemented'); };
FileManager.prototype.getByName = function() { throw new Error('not implemented'); };

FileManager.prototype.getByWebPath = function(webPath) {
	webPath = webPath.startsWith('/') ? webPath.slice(1) : webPath;
	for (const id in this.files) {
		const file = this.files[id];
		if (file.path.relative === webPath || file.name === webPath) return file;
	}
	return null;
};

FileManager.prototype.getCurrentFile = function() {
	return this.currentFile !== undefined ? this.files[this.currentFile] : undefined;
};

FileManager.prototype.setCurrentFile = function(id) {
	if (!this.files[id]) { this.currentFile = undefined; return; }
	this.currentFile = id;
	if (this.files[id].type === 'html') {
		this.currentHtmlFile = id;
		this.changePageCallback(this.files[id]);
	}
};

FileManager.prototype.getCurrentHtmlFile = function() {
	return this.currentHtmlFile !== undefined ? this.files[this.currentHtmlFile] : undefined;
};

FileManager.prototype.errorPage = {
	template_source: undefined,
	injectedJs: undefined,
	template_path: 'error_template.html',

	webSrc: function(title, details) {
		if (!this.template_source) {
			this.template_source = fs.readFileSync(this.template_path, 'utf8')
				.replace(/%JAVASCRIPT%/g, this.injectedJs);
		}
		return this.template_source
			.replace(/%TITLE%/g, title)
			.replace(/%DETAILS%/g, details);
	}
};

module.exports = FileManager;