/*global module, require */

var event = require('events').EventEmitter;

module.exports = (function() {

	var ko = {};

	ko.observable = function() {
		/*
		 No need to understand this, we're basically replicating the
		 function of a Knockout.js observable.
		 */
		var currentValue = null,
			e = new event,
			me = function(v) {
				if (typeof(v)==='undefined') {
					return currentValue;
				} else {
					if (currentValue!==v) {
						currentValue = v;
						e.emit("change", currentValue);
					}
					return currentValue;
				}
			};
		me.subscribe = function(f) {
			e.on('change', function() {
				f(currentValue);
			});
		};
		return me;
	};

	return ko;

})();