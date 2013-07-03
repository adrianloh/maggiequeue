/*global module, require*/

/*
	For API reference, go here: http://dev.iron.io/mq/reference/api
*/

var http = require("http"),
	colors = require('colors');

module.exports = function(queueName) {

	var self = {};
	self.queueName = queueName;

	function QHeader() {
		var h = {};
		h.headers = {"Authorization":"OAuth E9PHJUc_nzkRpVSlrvMZM0TQn3A"};
		h.hostname = "mq-aws-us-east-1.iron.io";
		h.path = "/1/projects/51bcd4dbed3d764af2000e8a/queues/QUEUENAME".replace(/QUEUENAME/, self.queueName);
		return h;
	}

	function MHeader() {
		var h = QHeader();
		h.headers["Content-Type"] = "application/json";
		h.path+="/messages";
		return h;
	}

	var DEBUG = true;

	self.info = function(callback) {
		var options = QHeader();
		options.method = "GET";
		http.request(options, function(res) {
			// console.log('STATUS: ' + res.statusCode);
			// console.log('HEADERS: ' + JSON.stringify(res.headers));
			if (res.statusCode>201) {
				callback({message: "Error QUEUE INFO. HTTP response code " + res.statusCode});
				return;
			}
			res.setEncoding('utf8');
			var buffer = "";
			res.on('data', function (chunk) {
				buffer = buffer + chunk;
			});
			res.on('end', function () {
				var res_body = JSON.parse(buffer);
				/* Response info on a queue populated with *active* messages looks like:
					 { id: '51c4c4abe63394694730d5be',
					 name: 'test_queue',
					 size: 128,
					 total_messages: 128,
					 project_id: '51bcd4dbed3d764af2000e8a' }

					If the queue has been deleted, you get:
					 { msg: 'Queue not found' }

					If the queue was previously populated but all messages have
					been checked out and deleted, you get the first response but
					size will be 0
				*/
				if (res_body.hasOwnProperty('id')) {
					callback(null, res_body);
				} else if(res_body.hasOwnProperty('msg')) {
					callback({message: "Error QUEUE INFO. " + res_body.msg});
				}
			});
		}).on('error', function(e) {
			callback({message: "Fail QUEUE INFO request. " + e.message});
		}).end();
	};

	self.get = function(getOptions, callback) {
		var count, timeout;
		if (typeof(getOptions)==='object') {
			count = getOptions.hasOwnProperty('count') ? getOptions.count : 1;
			timeout = getOptions.hasOwnProperty('timeout') ? getOptions.timeout : 60;
		} else if (typeof(getOptions)==='function') {
			count = 1;
			timeout = 60;
			callback = getOptions;
		}
		var options = MHeader();
		options.method = "GET";
		options.path = options.path + "?n=COUNT&timeout=TOUT".replace(/COUNT/, count).replace(/TOUT/, timeout);
		http.request(options, function(res) {
			// console.log('STATUS: ' + res.statusCode);
			// console.log('HEADERS: ' + JSON.stringify(res.headers));
			if (res.statusCode>201) {
				callback({message: "Error GET MESSAGES. HTTP response code " + res.statusCode});
				return;
			}
			res.setEncoding('utf8');
			var buffer = "";
			res.on('data', function (chunk) {
				buffer = buffer + chunk;
			});
			res.on('end', function () {
				var res_body = JSON.parse(buffer);
				/* The message looks like:
					{ messages:
						 [ { id: '5892061205832765690',
						 body: '"Hello World"',
						 timeout: 60,
						 reserved_count: 1,
						 push_status: [Object] }] }

					Severe Warning: If you call get on a queue that exists but has
					no more messages, you get an empty array. If the queue itself
					doesn't exists, e.g. it got deleted or you're just being a dumbass,
					messages is null
				*/
				if (res_body.hasOwnProperty('messages') && Array.isArray(res_body.messages)) {
					if (res_body.messages===null) {
						callback(null,null);
					} else {
						var messages = res_body.messages.map(function(message) {
							if (typeof(message.body)==='string') {
								message.body = JSON.parse(message.body);
							}
							return message;
						});
						callback(null, messages);
					}
				} else {
					callback({message: "Error GET MESSAGES. Did not receive a sane list."});
				}
			});
		}).on('error', function(e) {
			callback({message: "Fail GET MESSAGES request. " + e.message});
		}).end();
	};

	self.delete = function(msgId, callback) {
		var options = MHeader();
		options.method = "DELETE";
		options.path += "/" + msgId;
		var req = http.request(options, function(res) {
			// console.log('STATUS: ' + res.statusCode);
			// console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			var buffer = "";
			res.on('data', function (chunk) {
				buffer = buffer + chunk;
			});
			res.on('end', function () {
				/* Success looks like:
				 {"ids":["5892013905357986201"],"msg":"Messages put on queue."}
				 */
				var res_body = JSON.parse(buffer);
				if (res_body.hasOwnProperty('msg')) {
					callback(null, res_body.msg);
				} else {
					callback('error');
				}
			});
		}).on('error', function(e) {
			callback('error');
			console.log('problem with request: ' + e.message);
		}).end();
	};

	self.touch = function(msgId, extend_timeout, callback) {
		if (typeof(extend_timeout)==='function') {
			callback = extend_timeout;
			extend_timeout = 60;
		}
		var options = MHeader();
		options.method = "POST";
		options.path += "/" + msgId + "/touch" + "?timeout=" + extend_timeout;
		var req = http.request(options, function(res) {
			// console.log('STATUS: ' + res.statusCode);
			// console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			var buffer = "";
			res.on('data', function (chunk) {
				buffer = buffer + chunk;
			});
			res.on('end', function () {
				/* Success looks like:
				 {"ids":["5892013905357986201"],"msg":"Messages put on queue."}
				 */
				var res_body = JSON.parse(buffer);
				if (res_body.hasOwnProperty('msg')) {
					callback(null, res_body.msg);
				} else {
					callback('error');
				}
			});
		});
		req.on('error', function(e) {
			callback('error');
			console.log('problem with request: ' + e.message);
		});
		req.write(JSON.stringify({}));
		req.end();
	};

	self.purge = function(done) {
		var options = QHeader();
		options.method = "DELETE";
		http.request(options, function(res) {
			// console.log('STATUS: ' + res.statusCode);
			// console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			var buffer = "";
			res.on('data', function (chunk) {
				buffer = buffer + chunk;
			});
			res.on('end', function () {
				var msg = "queue " + self.queueName,
					res_body = JSON.parse(buffer);
				if (res_body.hasOwnProperty('msg')) {
					if (res_body.msg.match(/deleted/i)) {
						if (DEBUG) console.log("OK PURGED ".green + msg);
					} else if (res_body.msg.match(/Queue not found/)) {
						if (DEBUG) console.log("WARN ".yellow + " attempted to delete non-existent queue");
					} else {
						if (DEBUG) console.log("WARN ".yellow + " unknown error: " + res_body.msg);
					}
					done(null);
				} else {
					if (DEBUG) console.log("FAIL PURGE ".red + msg);
					done('error');
				}
			});
		}).on('error', function(e) {
			if (DEBUG) console.log("FAIL PURGE request: ".red + e.message);
			done('error');
		}).end();
	};

	self.put = function(msgs, callback) {
		if (!Array.isArray(msgs)) {
			msgs = [msgs];
		}
		var options = MHeader();
		options.method = "POST";
		var req = http.request(options, function(res) {
			// console.log('STATUS: ' + res.statusCode);
			// console.log('HEADERS: ' + JSON.stringify(res.headers));
			res.setEncoding('utf8');
			var buffer = "";
			res.on('data', function (chunk) {
				buffer = buffer + chunk;
			});
			res.on('end', function () {
				/* Success looks like:
				 {"ids":["5892013905357986201"],"msg":"Messages put on queue."}
				 */
				var res_body = JSON.parse(buffer);
				if (res_body.hasOwnProperty('ids')) {
					if (res_body.ids.length===msgs.length) {
						callback(null, res_body.ids);
					} else {
						callback('error');
					}
				} else {
					callback('error');
				}
			});
		});

		req.on('error', function(e) {
			callback('error');
			console.log('problem with request: ' + e.message);
		});

		var message = msgs.map(function(oo) {
			return {body:JSON.stringify(oo)};
		});

		var body = {messages:message};
		req.write(JSON.stringify(body));
		req.end();
	};

	return self;

};