# car.js ![Actions Status](https://github.com/jrcichra/car.js/workflows/car.js/badge.svg)
A Javascript nagivation system using Electron. Works on Raspberry Pis.
# Demo
![Demo](/demo.gif)
## How it works
+ A lot of Mapbox libraries! Mapbox is a crucial component of the functionality of this project. Without their easy to use Javascript APIs, this would have taken me much longer to develop.
+ Big shoutout to the OSRM project. Since it was open source, I make an arm-based docker container and run their API in my car.
+ Tileserver is how the maps are fed into Mapbox. Without their easy to use and easy to port container, this project wouldn't have happened.

## Known issues
Hardware acceleration. Running on a Pi3 seems to put all CPUs ~80% used, and use ~600MB of RAM. This is not a lightweight application (as expected from Electron + Node.js + Chrome + Mapbox + OSRM + a zillion other things). If you want to run other projects on this, you might need a beefier Pi, like the Pi4. I'm running my smartcar project on the same Pi and I've had some system lockups.
