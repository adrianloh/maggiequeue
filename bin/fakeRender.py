import os, sys
from optparse import OptionParser
from time import sleep, time

parser = OptionParser()
parser.add_option("-s", "--start", action="store", type="int", dest="start")

(options, args) = parser.parse_args()

nodeName = args[0].split(".")[0]
frameNumber = options.start

nuke.scriptOpen("/Users/adrianloh/Desktop/MaggieQueue/graphs.nk")
node = nuke.toNode(nodeName)
renderTime = node['scale'].getValueAt(frameNumber)
perTickTime = renderTime/10.0
t1 = time() + renderTime
perc = 0
while time()<t1:
	sys.stderr.write(str(perc) + ".0%\n")
	sleep(perTickTime)
	perc+=10

sys.stderr.write("100.0%\n")
exit(0)