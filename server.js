#! /usr/local/bin/node
/*global process, require */

var randrange = function(minVal,maxVal,floatVal) {
	var randVal = minVal+(Math.random()*(maxVal-minVal));
	return typeof floatVal=='undefined'?Math.round(randVal):randVal.toFixed(floatVal);
};

var Firebase = require("firebase"),
	MaggieBase = new Firebase("https://ebay.firebaseio-demo.com/"),
	MachineRegistrationBase = MaggieBase.child("machines"),
	QueueBase = MaggieBase.child("queue"),
	Jobsystem = MaggieBase.child("jobsystem"),
	IronMQ = require("./iron"),
	ko = require("./knockout"),
	uuid = require('node-uuid'),
	_ = require("underscore"),
	async = require("async"),
	colors = require('colors'),
	popen = require('child_process').exec,
	event = require('events').EventEmitter,
	fs = require('fs'),
	path = require('path'),
	http = require('http'),
	S3_BASE = "https://maggieq.s3-ap-southeast-1.amazonaws.com/",
	isEC2 = process.env.hasOwnProperty("AWS_IAM_HOME"),
	minuteOfBirth;

var RenderBlade = function(hostname, power) {

	var self = {},
		$HOSTNAME = hostname,
		render_handlers = {
			maya: require("./maya"),
			nuke: require("./nuke")
		};

	self.hostname = hostname;
	self.power = power;
	self.debugBase = MachineRegistrationBase.child($HOSTNAME);
	self.renderThread = null;

	var deleledQueues = [];
	QueueBase.on("child_removed", function(snap) {
		deleledQueues.push(snap.ref().name());
	});

	self.activeQueueName = ko.observable();
	self.activeQueueName.subscribe(function(qName) {
		if (qName!==null) {
			Jobsystem.child(qName).once("value", function(snapshot) {
				if (snapshot.val()) {
					bidForFrames();
				}
			});
		} else {
			killRenderer();
			self.log("8==O:");
		}
	});

	self.log = function(msg) {
		var activeQueue = self.activeQueueName();
		activeQueue = activeQueue===null ? "Idle" : activeQueue;
		var logMsg = "[" + activeQueue + "] " + msg;
		self.debugBase.child("log").set(logMsg);
	};

	var machineIsLive = MaggieBase.child(".info").child("connected");
	machineIsLive.on("value", function(snap) {
		var isConnected = snap.val();
		if (isConnected) {
			self.log("online");
			self.debugBase.child("zscore").set(self.power);
			self.debugBase.onDisconnect().remove();
		}
	});

	function killRenderer() {
		if (self.renderThread) {
			var type = self.renderThread.type;
			render_handlers[type].die();
		}
	}

	function firstAvailableAuctionRef(ifAvailableCallback, noneAvailableCallback) {
		QueueBase.once("value", function(snapshot) {
			var quids = snapshot.val();
			if (quids===null) {
				noneAvailableCallback();
			} else {
				var queueIds = _.keys(quids).sort();
				async.whilst(
					function() {
						return queueIds.length>0;
					},
					function(done) {
						var ref = Jobsystem.child(queueIds.shift());
						ref.child("frames").startAt(null).endAt(null).once("value", function(snapshot) {
							var frameList = snapshot.val();
							if (frameList!==null) {
								if (!Array.isArray(frameList)) {
									frameList = _.values(frameList);
								}
								var available = frameList.filter(function(o) { return o!==null } );
								if (available.length>0) {
									done({ok: ref});
								} else {
									done(null);
								}
							} else {
								done(null);
							}
						});
					},
					function finalCallback(error) {
						if (error && error.hasOwnProperty('ok')) {
							ifAvailableCallback(error.ok);
						} else {
							noneAvailableCallback();
						}
					}
				)
			}
		});
	}

	function bidForFrames() {
		var qName = self.activeQueueName(),
			jobRef = Jobsystem.child(qName),
			biddersRef = jobRef.child("bidders"),
			framesRef = jobRef.child("frames");
		if (qName===null) return;
		console.log($HOSTNAME + " " + qName + " bidForFrames");
		framesRef.endAt(null).once("value", function(snapshot) {
			var msg,
				frameList = snapshot.val(),
				myBid = {hostname:$HOSTNAME, bid: self.power};
			if (frameList!==null && _.keys(frameList).length>0) {
				biddersRef.transaction(function(currentData) {
					var hostnames, biddersList, newList = {};
					if (currentData===null) {
						currentData = {};
					}
					hostnames = _.keys(currentData);
					if (hostnames.indexOf($HOSTNAME)<0) {
						currentData[$HOSTNAME] = myBid;
					}
					biddersList = _.values(currentData);
					biddersList.sort(function(a,b) {
						var a_bid = a.bid,
							b_bid = b.bid;
						if (a_bid === b_bid) {
							return 0;
						} else if(a_bid > b_bid) {
							return 1;
						} else {
							return -1;
						}
					});
					biddersList.slice(0, _.keys(frameList).length).forEach(function(bidder) {
						newList[bidder.hostname] = bidder;
					});
					return newList;
				}, function (error, comitted, snapshot) {
					var currentData = snapshot.val(),
						hostnames;
					if (currentData!==null && deleledQueues.indexOf(qName)<0) {
						hostnames = _.keys(currentData);
						if (hostnames.indexOf($HOSTNAME)>=0) {
							msg = "...";
							biddersRef.child($HOSTNAME).onDisconnect().remove();
							setTimeout(function() {
								checkAuction(qName);
							}, 10000);
						} else {
							msg = ":(";
							moveToNextQueue();
						}
						self.log(msg);
						console.log($HOSTNAME + " " + msg.yellow);
					} else {
						moveToNextQueue();
					}
				});
			} else {
				moveToNextQueue();
			}
		});
	}

	function moveToNextQueue() {
		self.log(">>>");
		console.log($HOSTNAME + " >>>");
		setTimeout(function() {
			firstAvailableAuctionRef(
				function found(ref) {
					var nextQueueName = ref.name();
					if (nextQueueName!==self.activeQueueName()) {
						self.activeQueueName(nextQueueName);
					} else {
						bidForFrames();
					}
				},
				function notFound() {
					self.activeQueueName(null);
				}
			);
		}, 5000);
	}

	function remainingTimeToRender(qName, callback) {
		var jobRef = Jobsystem.child(qName),
			timingsRef = jobRef.child("timings");
		timingsRef.once("value", function(snapshot) {
			var currentData = snapshot.val(),
				timings = {};
			if (Array.isArray(currentData)) {
				currentData.forEach(function(data,i) {
					timings[i.toString()] = data;
				});
			} else {
				timings = currentData;
			}
			var frameNumbers = _.keys(timings).map(function(i) {
				return Number(i);
			}).sort(function(a,b) {
				return a-b;
			});
			var renderedTimes = [],
				unrenderedFrames = [],
				intervals = [];
			frameNumbers.forEach(function(n) {
				var t = timings[n.toString()];
				if (t > 0) {
					renderedTimes.push({x:n, y:t});
				} else if (t===0) {
					unrenderedFrames.push(n);
				}
			});
			if (unrenderedFrames.length>0) {
				var ok = true;
				while (ok) {
					if (renderedTimes.length>=2) {
						var	p1 = renderedTimes.shift(),
							p2 = renderedTimes[0],
							interval = getInterval(p1, p2);
						intervals.push(interval);
					} else {
						ok = false;
					}
				}
			}
			var totalEstimatedTimes = 0;
			intervals.forEach(function(interval) {
				if (interval.right-interval.left===1) {
					// Ignore this interval because they are consecutive frames
				} else {
					// Are there underendered frames in this interval?
					var unrenderedInRange = _.range(interval.left+1, interval.right).filter(function(n) {
						return unrenderedFrames.indexOf(n)>=0;
					});
					if (unrenderedInRange.length>0) {
						unrenderedInRange.forEach(function(n) {
							totalEstimatedTimes+=interval.valueAtFrame(n);
						})
					}
				}
			});
			callback(totalEstimatedTimes);
		});
	}

	function checkAuction(qName) {
		console.log($HOSTNAME + " " + qName + " checkAuction");
		var jobRef = Jobsystem.child(qName),
			biddersRef = jobRef.child("bidders"),
			framesRef = jobRef.child("frames"),
			timingsRef = jobRef.child("timings"),
			renderPacket = null;
		biddersRef.once("value", function(snapshot) {
			var bidders = snapshot.val(),
				hostnames = bidders!==null ? _.keys(bidders) : [],
				indexToRender = null;
			if (hostnames.indexOf($HOSTNAME)>=0) {
				timingsRef.transaction(function(currentData) {
					var res, timings = {};
					if (Array.isArray(currentData)) {
						currentData.forEach(function(data,i) {
							timings[i.toString()] = data;
						});
					} else {
						timings = currentData;
					}
					res = computeTimings(currentData);
					if (res.indexToRender!==null) {
						indexToRender = res.indexToRender;
						return res.timings;
					} else {
						return;
					}
				}, function afterGettingFrame(error, comitted, snapshot) {
					if (comitted && indexToRender!==null) {
						console.log($HOSTNAME + " About to render frame " + indexToRender);
						biddersRef.child($HOSTNAME).remove();
						framesRef.child(Number(indexToRender)).once("value", function(snapshot) {
							renderPacket = snapshot.val();
							if (renderPacket!==null) {
								timingsRef.child(Number(indexToRender)).onDisconnect().set(0);
								render(renderPacket);
							} else {
								console.log($HOSTNAME + " " + qName + " WTF got null from framesRef frame ".red + indexToRender);
							}
						});
					} else {
						console.log($HOSTNAME + " " + qName + " FAILED to acquire frame".red);
						moveToNextQueue();
					}
				});
			} else {
				console.log($HOSTNAME + " Got bumped from auction!".red);
				moveToNextQueue();
			}
		});
	}

	function getInterval(left, right) {
		var m = (right.y - left.y)/(right.x - left.x),
			median = (right.y + left.y)/2,
			c = left.y-(m * left.x);
		return {
			left: left.x,
			right: right.x,
			slope: m,
			median: median,
			valueAtFrame: function(x) {
				return (m * x) + c;
			}
		}
	}

	function computeTimings(timings) {
		var indexToRender = null,
			frameNumbers;
		frameNumbers = _.keys(timings).map(function(i) {
			return Number(i);
		}).sort(function(a,b) {
			return a-b;
		});
		var firstFrame = frameNumbers[0],
			lastFrame = frameNumbers.slice(-1);
		if (timings[firstFrame]===0) {
			indexToRender = firstFrame;
			timings[firstFrame] = -1;
		} else if (timings[lastFrame]===0) {
			indexToRender = lastFrame;
			timings[lastFrame] = -1;
		} else {
			var renderedTimes = [],
				unrenderedFrames = [],
				intervals = [],
				steepest = {left:0, right:0, median:0};
			frameNumbers.forEach(function(n) {
				var t = timings[n.toString()];
				if (t > 0) {
					renderedTimes.push({x:n, y:t});
				} else if (t===0) {
					unrenderedFrames.push(n);
				} else {
					// t===-1 (Somebody is rendering this, leave alone)
				}
			});
			if (renderedTimes.length>1 && Math.random()>0.3) {
				var ok = true;
				while (ok) {
					if (renderedTimes.length>=2) {
						var	p1 = renderedTimes.shift(),
							p2 = renderedTimes[0],
							interval = getInterval(p1, p2);
						intervals.push(interval);
					} else {
						ok = false;
					}
				}
				intervals.forEach(function(interval) {
					if (interval.right-interval.left===1) {
						// Ignore this interval because they are consecutive frames
					} else {
						// Are there underendered frames in this interval?
						var unrenderedInRange = _.range(interval.left+1, interval.right).filter(function(n) {
							return unrenderedFrames.indexOf(n)>=0;
						});
						if (unrenderedInRange.length>0 && (interval.median > steepest.median)) {
							steepest = interval;
						}
					}
				});
				if (steepest.right > steepest.left) {
					var tweenFrames = _.range(steepest.left+1, steepest.right).filter(function(n) {
						return unrenderedFrames.indexOf(n)>=0;
					});
					if (tweenFrames.length===1) {
						indexToRender = tweenFrames[0];
						timings[indexToRender] = -1;
					} else if (tweenFrames.length%2===1) {
						indexToRender = tweenFrames[Math.floor(tweenFrames.length/2)];
						timings[indexToRender] = -1;
					} else {
						indexToRender = tweenFrames[Math.ceil(tweenFrames.length/2)];
						timings[indexToRender] = -1;
					}
					if (unrenderedFrames.indexOf(indexToRender)<0) {
						console.log($HOSTNAME + " RETARDED: Cannot render frame " + indexToRender);
						timings[indexToRender] = 0;
						indexToRender = null;
					}
				} else {
					if (unrenderedFrames.length>0) {
						indexToRender = unrenderedFrames[Math.floor(Math.random() * unrenderedFrames.length)];
						timings[indexToRender] = -1;
					}
				}
			} else {
				if (unrenderedFrames.length>0) {
					indexToRender = unrenderedFrames[Math.floor(Math.random() * unrenderedFrames.length)];
					timings[indexToRender] = -1;
				}
			}
		}
		return {
			indexToRender: indexToRender,
			timings: timings
		};
	}

	function renderCallbacks(renderPacket) {
		var renderData = renderPacket.renderData,
			frameToRender = Number(renderData.frame),
			jobRef = Jobsystem.child(renderData.jobId),
			framesRef = jobRef.child("frames"),
			timingsRef = jobRef.child("timings"),
			renderStatsRef = self.debugBase.child("renderStats"),
			execRef = self.debugBase.child("exec"),
			start = Date.now();

		function updateTiming(t) {
			self.renderThread = null;
			timingsRef.transaction(function(currentData) {
				if (currentData!==null) {
					currentData[frameToRender] = t;
					return currentData;
				} else {
					return;
				}
			}, function afterwards(error, comitted, snapshot) {
				timingsRef.onDisconnect().cancel();
				execRef.off("child_removed");
				execRef.remove();
				renderStatsRef.remove();
			});
		}

		var lastProgressUpdate = Date.now(),
			callbacks = {
				init: function() {
					execRef.set(renderPacket);
					execRef.on("child_removed", killRenderer);
					renderStatsRef.child("started").set(start);
					renderStatsRef.child("jobId").set(renderData.jobId);
					renderStatsRef.child("frame").set(renderData.frame);
				},
				onError: function renderErrorCallback(error) {
					if (error.error) {
						console.log($HOSTNAME + " " + error.error.red);
						self.log(error.error);
					}
					updateTiming(0);
					moveToNextQueue();
				},
				onProgress: function renderProgressCallback(percentComplete) {
					var msg = "[" + frameToRender + "] " + percentComplete;
					if (Date.now()-lastProgressUpdate > 5000) {
						renderStatsRef.child("progress").set(percentComplete);
						self.log(msg);
						lastProgressUpdate = Date.now();
					}
				},
				onComplete: function renderSuccessCallback(results) {
					var timeToRender = (Date.now()-start) * self.power;
					console.log($HOSTNAME + " Render took " + timeToRender/1000);
					framesRef.child(frameToRender).setPriority("done");
					updateTiming(timeToRender);
					moveToNextQueue();
				}
			};

		return callbacks;

	}

	function render(renderPacket) {
		var renderData = renderPacket.renderData,
			frameToRender = Number(renderPacket.frame),
			ext = path.extname(renderData.file),
			whichRenderer = _.keys(render_handlers).filter(function(name) {
				return render_handlers[name].extensions.indexOf(ext)>=0;
			}),
			Renderer = whichRenderer.length===1 ? render_handlers[whichRenderer[0]] : null,
			callbacks = renderCallbacks(renderPacket);

		var msg;
		if (Renderer===null) {
			msg = "Abort: Cannot find renderer for filetype: " + renderData.file;
			callbacks.onError({error: msg});
			self.log(msg);
			return;
		} else {
			callbacks.init();
			msg = "Init: " + Renderer.name + " | " + frameToRender;
			console.log($HOSTNAME + " | " + msg.green.bold);
			self.log(msg);
		}

		var resolved_path,
			location = renderData.location.split(path.sep).map(function(p) {
			var environVar = p.match(/\$(.+)/);
			if (environVar) {
				var ev = environVar[1];
				if (process.env.hasOwnProperty(ev)) {
					return process.env[ev];
				} else {
					return null;
				}
			} else {
				return p;
			}

		});
		if (location.indexOf(null)>=0) {
			callbacks.onError({error: "Unknown environmental variable in path: " + renderData.location});
			return;
		} else {
			resolved_path = location.join(path.sep);
		}

		var	command_find = "find \"PROJ\" -name \"FILENAME\"".replace(/PROJ/, resolved_path).replace(/FILENAME/, renderData.file);
		if (fs.existsSync(resolved_path)) {
			popen(command_find, function(Error, stdout, stderr) {
				if (stdout.length>0) {
					var filesToRender = stdout.split("\n");
					if (filesToRender.length>1) {
						/* WARN USER: Duplicate filenames in project */
						filesToRender = [filesToRender[0]];
					}
					renderData.filepath = filesToRender[0];
					self.renderThread = {type: Renderer.name, proc: Renderer.render(renderData, callbacks)};
				} else {
					callbacks.onError({error: "Cannot find file: " + renderData.file});
				}
			});
		} else {
			callbacks.onError({error: "Cannot find project path: " + resolved_path});
		}
	}

	QueueBase.on("value", function(snapshot) {
		var queues = snapshot.val();
		if (queues===null) {
			self.activeQueueName(null);
			return;
		}
		var queue_ids = _.keys(queues).sort(),
			currentJob = self.activeQueueName();
		if (currentJob!==null && queue_ids.indexOf(currentJob)<0) {
			// Are we currently working on a queue that no longer exists?
			self.activeQueueName(null);
		}
		var skipIteration = false;
		queue_ids.forEach(function(queueId) {
			if (skipIteration) return;
			currentJob = self.activeQueueName();
			var queue = queues[queueId],
				bidders = queue.hasOwnProperty('bidders') ? queue.bidders : [],
				okToBid = (bidders.length===0 || bidders.indexOf($HOSTNAME)>=0),
				machineIsIdle = currentJob===null,
				auctionIsOpen = (queue.sold < queue.total);
			if (machineIsIdle && okToBid && auctionIsOpen) {
				// Machine is doing jack shit, and there's shit to be done
				self.activeQueueName(queueId);
				skipIteration = true;
			} else if (currentJob===queueId && !okToBid) {
				// Working on this queue, but we've been removed from bidding on it
				self.activeQueueName(null);
			}
		});
	});

	return self;

};

(function init() {

	var name;

	if (isEC2) {
		minuteOfBirth = new Date(process.env.INSTANCE_LAUNCH_TIME).getMinutes();
		name = process.env.hasOwnProperty("INSTANCE_ID") ? process.env.INSTANCE_ID : process.env.HOSTNAME;
	} else {
		minuteOfBirth = -1;
		var fullHostname = process.env.hasOwnProperty("HOSTNAME") ? process.env.HOSTNAME : marvelName(),
			cleanHostname = fullHostname.replace(/[\.\$\[\]#]|local/g,""),
			randomId = uuid.v4().split("-")[0].slice(0,3);
		name = cleanHostname + "-" + randomId;
	}

	function getBenchMarkTime(callback) {
		var renderTime = randrange(25,120,2),
			cmd = "echo " + renderTime + " >&2";
		popen(cmd, function(Error, stdout, stderr) {
			var t = Number(stderr.split("\n")[0]);
			callback(t/60);
		});
	}

	function marvelName() {
		var names = fs.readFileSync("marvel.txt", encoding="utf8").split("\n");
		return names[Math.floor(Math.random() * names.length)]
	}

	getBenchMarkTime(function(power) {
		RenderBlade(name, power);
	});

})();