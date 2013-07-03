/*global process, require, module */

var spawn = require('child_process').spawn,
	event = require('events').EventEmitter;

module.exports = (function NukeRenderModule() {

	var self = {};

	self.name = "NUKE";

	self.extensions = [".nk"];

	self.projectsRoot = process.env.NUKE_PROJECTS;

	self.preRenderHook = function() {};

	self.render = function(renderObject, onProgressCallback, onSuccessCallback, onErrorCallback) {
		var render_args = ['-proj', renderObject.projectPath, '-s', renderObject.frameNumber, '-e', renderObject.frameNumber, '-mr:v', '6', renderObject.filename],
			proc = spawn('Render', render_args);

		proc.stdout.on('data', function (data) {
			/* This is never called, cause Maya doesn't print to stdout */
			console.log('stdout: ' + data);
		});

		proc.stderr.on('data', function (data) {
			data = data.toString();
			if (data.match(/Cannot load scene/i)) {
				console.log(data);
				return;
			}
			if (data.match(/Reference file not found/i) || data.match(/referenced texture file.+doesn't exist/)) {
				console.log(data);
				return;
			}
			var	percentComplete = data.match(/(\d+\.\d+)%/);
			if (percentComplete) {
				console.log('stderr: ' + percentComplete[0]);
			}
		});

		proc.on('close', function (code) {
			console.log('child process exited with code ' + code);
		});

		proc.on('error', function (error) {
			console.log('child process error' + error);
		});
	};

	self.postRenderHook = function() {};

	return self;

})();