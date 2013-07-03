#! /bin/bash

SLEEPYTIME=$(expr $1 \* 2)
osascript -e "tell app \"Terminal\"
   do script \"sleep ${SLEEPYTIME}; cd /Users/adrianloh/Desktop/MaggieQueue; node server.js\"
end tell"