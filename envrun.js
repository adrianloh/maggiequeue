var Firebase = require("firebase"),
	MaggieBase = new Firebase("https://ebay.firebaseio-demo.com/"),
	MachineRegistrationBase = MaggieBase.child("machines"),
	machineIsLive = MaggieBase.child(".info").child("connected"),
	$HOSTNAME = process.env.hasOwnProperty("INSTANCE_ID") ? process.env.INSTANCE_ID : process.env.HOSTNAME,
	debugBase = MachineRegistrationBase.child($HOSTNAME);

machineIsLive.on("value", function(snap) {
	var isConnected = snap.val();
	if (isConnected) {
		var serverData = {
			name: $HOSTNAME,
			dob: process.env.hasOwnProperty("INSTANCE_LAUNCH_TIME") ? process.env.INSTANCE_LAUNCH_TIME : null,
			benchtime : process.env.hasOwnProperty("BENCHTIME") ? process.env.BENCHTIME : 0
		};
		debugBase.set(serverData);
		debugBase.onDisconnect().remove();
	}
});