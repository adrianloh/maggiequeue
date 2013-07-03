var randrange = function(minVal,maxVal,floatVal) {
	var randVal = minVal+(Math.random()*(maxVal-minVal));
	return typeof floatVal=='undefined'?Math.round(randVal):randVal.toFixed(floatVal);
};

var padded = function(number) {
	if (number<=9999999) { number = ("000000"+number).slice(-7); }
	return number;
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
	S3_BASE = "https://maggieq.s3-ap-southeast-1.amazonaws.com/";

var TotalFramesCreatedBase = MaggieBase.child("totalFramesCreated"),
	TotalFramesProcessedBase = MaggieBase.child("totalFramesProcessed"),
	renderedFrames = [];

var machineIsLive = MaggieBase.child(".info").child("connected");
machineIsLive.on("value", function(snap) {
	var isConnected = snap.val();
	if (isConnected) {
		Jobsystem.onDisconnect().remove();
		QueueBase.onDisconnect().remove();
	}
});

(function test() {

	var machineNames = _.range(10).map(function(n) {
		return "machine"+n;
	});

	var $FRAMERANGE = "1-50",
		$FILENAME = "bitcheseverywhere.ma";

	function parseRanges(ranges) {
		var frameList = [], start, end,
			method;
		ranges.split(",").forEach(function(subRange) {
			var range = subRange.replace(/ /g,""),
				matchRange = range.match(/(\d+)-(\d+)/);
			if (matchRange) {
				range = range.split("-");
				start = Number(range[0]);
				end = Number(range[1]);
				method = (end > start) ? "push" : "unshift";
				var s,e;
				if (end > start) {
					s = start; e = end;
				} else {
					s = end; e = start;
				}
				_.range(s,e+1).forEach(function(n) {
					if (frameList.indexOf(n)<0) {
						frameList[method](n);
					}
				});
			} else if (range.match(/^\d+$/)) {
				var n = Number(range);
				if (frameList.indexOf(n)<0) {
					frameList[method](n);
				}
			}
		});
		frameList.sort(function(a,b) {
			return a - b;
		});
		return frameList;
	}

	function setupJob(ranges) {
		var data,
			blowJob = {
				projectCode: "NVAPCG",
				location: "$PROJECTS/stupidMayaProject",
				file: $FILENAME,
				jobId: "NA",
				frame: -1
			},
			ref = Jobsystem.push(),
			jobId = ref.name(),
			frameList = parseRanges(ranges),
			shitList = {};
			var timings = {};
			frameList.forEach(function(n) {
				data = Object.create(blowJob);
				data.jobId = jobId;
				data.frame = n;
				timings[n] = 0;
				shitList[n]  = {
					renderData: data,
					sold: false,
					frame: n
				};
			});
		TotalFramesCreatedBase.transaction(function(v) {
			if (v===null) {
				return shitList.length;
			} else {
				return v + shitList.length;
			}
		});
		async.series([
			function(done) {
				ref.child("frames").set(shitList);
				ref.child("timings").set(timings);
				var q = IronMQ(jobId);
				q.put(timings, function() {
					// Do nothing
				});
				setTimeout(done, 10000);
			},
			function(done) {
				var queuePayload = {
						id: jobId,
						completed: 0,
						sold: 0,
						total: _.keys(shitList).length
					},
					qRef = QueueBase.child(queuePayload.id);
				qRef.set(queuePayload);
				done();
			}
		]);
	}

	function initTest(seriesStepDone) {
		Jobsystem.remove(function(error) {
			QueueBase.remove(function(error) {
				seriesStepDone();
			});
		});
	}

	function testAddJobAndSetAllToRender(testDone) {
		var numberOfJobs = 1,
			machines = [];
		console.log("TEST ".cyan + "Adding " + numberOfJobs + " jobs and setting all to render");
		function step1_createMachines(seriesStepDone) {
			machineNames.forEach(function(name,i) {
				setTimeout(function() {
					var m = RenderBlade(name, randrange(2,10,4));
					machines.push(m);
				}, 5000*i);
			});
			setTimeout(seriesStepDone, 1000);
		}
		function step2_createJobs(seriesStepDone) {
			_.range(numberOfJobs).forEach(function(n) {
				setTimeout(function() {
					setupJob($FRAMERANGE);
				}, 30000*n);
			});
			setTimeout(seriesStepDone, 5000);
		}
		async.series([
//			initTest,
//			step1_createMachines,
			step2_createJobs
		], function mainSeriesCallback() {
			var failures = 0;
//			machines.forEach(function(m,i) {
//				if (m.jobQueue.length!==numberOfJobs) {
//					failures+=1;
//					console.log("FAIL ".red + "Machine " + m.hostname + " only queued " + m.jobQueue.length + " jobs.");
//				}
//			});
			if (failures===0) {
				console.log("PASS".green);
			}
			testDone();
		});
	}

	function finish(testDone) {
		testDone();
	}

	async.series([
		testAddJobAndSetAllToRender,
//		testAddJobAndSetGroupToRender,
//		testRemoveJobFromTail,
//		testRemoveMachineFromAuction,
//		testRemoveJobFromHead,
		finish
	], function finalTestCallback() {

	})

})();