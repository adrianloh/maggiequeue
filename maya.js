/*global process, require, module */

var spawn = require('child_process').spawn,
	popen = require('child_process').exec,
	event = require('events').EventEmitter;

module.exports = (function MayaRenderModule() {

	var self = {};

	self.name = "maya";

	self.extensions = [".mb", ".ma"];

	self.projectsRoot = process.env.MAYA_PROJECTS || "/Users/adrianloh/Desktop/Projects";

	self.preRenderHook = function() {};

	var ppid = null;

	self.die = function() {
		if (ppid) {
			var kill_cmd = "pkill -P " + ppid;
			popen(kill_cmd, function(Error, stdout, stderr) {
				// Not interested
			});
		}
	};

	self.render = function(renderObject, callbacks) {
		var render_args = ['-s', renderObject.frame, '-e', renderObject.frame, '-mr:v', '6', '-mr:rt', '1', renderObject.filepath],
			proc = spawn("Render", render_args),
			results = {
				messages: [],
				files:[]
			};

		ppid = proc.pid;

		proc.stdout.on('data', function (data) {
			/* This is never called, cause Maya doesn't print to stdout */
			// console.log('stdout: ' + data);
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
			var renderedFilepath = data.match(/writing frame buffer .+ image file (.+) \(frame \d+\)/);
			if (renderedFilepath) {
				var fp = renderedFilepath[1];
				if (results.files.indexOf(fp)<0) {
					results.files.push(fp);
				}
			}
			var	percentComplete = data.match(/(\d+\.\d+)%/);
			if (percentComplete) {
				//console.log('stderr: ' + percentComplete[0]);
				if (callbacks.hasOwnProperty('onProgress')) {
					callbacks.onProgress(percentComplete[1]);
				}
			}
		});

		proc.on('close', function (code) {
			//console.log('child process exited with code ' + code);
			if (code===0) {
				if (callbacks.hasOwnProperty('onComplete')) {
					results.messages.push("Exit 0");
					callbacks.onComplete(results);
				}
			} else {
				if (callbacks.hasOwnProperty('onError')) {
					callbacks.onError({error:"Exited with code " + code});
				}
			}
		});

		proc.on('error', function (error) {
			if (callbacks.hasOwnProperty('onError')) {
				callbacks.onError(error);
			}
		});

		return proc;

	};

	self.postRenderHook = function() {};

	return self;

})();