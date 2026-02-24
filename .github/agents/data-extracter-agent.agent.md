---
description: 'For extracting data from the tranport applications and uploading to database'
tools: ['vscode', 'execute', 'read', 'agent', 'edit', 'search', 'web', 'todo']
---
Given the database structure and the data from the transport applications, extract the relevant data and upload it to the database. 

The database structure can be found in the files in postgres folder as this contains a backup of the database. 

The node.js backend is stored in backend folder and the react frontend is stored in frontend folder.

Use as much information from this project as possible to understand the data structure and how to extract the relevant data from the transport applications.

Transport data will be pulled from xml, csv files from transport.scc.lancs.ac.uk

Below is documentation on understanding the transportation data:

Datasets and Feeds
The following feeds are provided for your use at: http://transport.scc.lancs.ac.uk You
will find feeds cross reference each other and sites within the National Public Transport
Gazetteer (NPTG) and National Public Transport Access Node database (NaPTAN).
You don’t have to use all the feeds but may wish to do so… Have fun!
NOTE: You must be on campus or use the University VPN to access the server.
National Public Transport Gazetteer and Access Node Database
/nptg/nptg.xml National Public Transport Gazetteer, for whole UK
/nptg/naptan.xml Nat. Public Transport Access Node database, Lancashire
/nptg/naptan-full.xml As naptan.xml, but for whole UK
Note these are large files, 53MB, 17MB, and 548MB respectively, and they rarely change.
National Highways
/road/vms Messages on information displays along major routes
Traffic flow and average speed data can be found at:
https://webtris.nationalhighways.co.uk/api/swagger/ui/index
Weather
/weather?lat=54.05&lon=-2.80 Current weather for Latitude and Longitude
/weather/icons/XXX (e.g., 04n) Icon specified in above report (.png format)
Data updated every few minutes, and locations binned into areas due to API rate limits.
J36 8 MINS
J40 45 MINS
Figure 3 - Bus Locations and Routes
SCC.200 Group Project 2025-26
Page 11 of 50
Buses
Times gives route information with links to timetables and live gives GPS tracking data.
/bus/times/XXXX Reply includes URL for actual timetable data
/bus/live/XXXX Where XXXX is the Nat. Operator Code (NOC), e.g., ARCT or BLAC
Rail
/rail/departures/XXX Where XXX is the CRS code for station, e.g., LAN
/rail/facilities/XXX Where XXX is the CRS code for station, e.g., PRE
/rail/bplan.txt Incl. location of, and timing between all sites (89MB)
/rail/corpus Locations, incl. STANOX and TIPLOC codes (7MB)
/rail/smart TD berth offset data used for train reporting (7MB)
/rail/delay-codes.json List of Delay Attribution Codes used in reports
/rail/schedule Gzipped JSON of timetable for current day (~122MB)
You may also find the following useful:
/rail/timetable/ Published Working (Long-Term Planning) Timetable
/rail/track-model/ Directory of geo-spatial files for UK Track Model
To access live train running and signalling information, and late timetable updates, you
need to use the Streaming Text Oriented Messaging Protocol (STOMP)
1
to access
network port 61613 on the host transport.scc.lancs.ac.uk; note the vhost must be /
to connect to the correct message exchange. The connection header should be:
{ "username": "guest", "passcode": "guest", "wait": True }
Information is provided as a set of message queues you can subscribe to:
• /topic/TRAIN_MVT_ALL_TOC TRUST Train movement feed
• /topic/TD_ALL_SIG_AREA Train Describer (TD) feed
• /topic/VSTP_ALL VSTP Timetable updates
• /topic/TSR_ALL_ROUTE Temporary Speed Restrictions*
* TSR messages are normally sent once a week, typically around 06:00 on Friday; they
are also one of the places you will commonly see distances in yards and chains.
Each subscription must have a distinct ID, for example:
{"destination": "/topic/TRAIN_MVT_ALL_TOC", "id": 1, "ack": "auto"}
{"destination": "/topic/TD_ALL_SIG_AREA", "id": 2, "ack": "auto"}
