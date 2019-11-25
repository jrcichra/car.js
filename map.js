const version = 'v5';
var osrmTextInstructions = require('osrm-text-instructions')(version);
var map = new mapboxgl.Map({
    container: 'map',
    style: 'styles/osm-bright/style.json'
});
var electron = require('electron');
var ipc = electron.ipcRenderer;

var direction_request = 0;

var d = new MapboxDirections({
    accessToken: mapboxgl.accessToken,
    api: 'http://127.0.0.1:5000/route/v1/',
    profile: 'driving',
    language: '',
    alternatives: false,
    steps: true,
    compile: function (language, step, options) {
        instruction = osrmTextInstructions.compile(language, step, options);
        //send this instruction to the backend so we can speak it!
        ipc.send("osrm", {
            "instruction": instruction,
            "step": step,
            "options": options,
            "request": direction_request
        });
        return instruction;
        //return this.tokenize(language, instruction, replaceTokens, options);
    },
});
map.addControl(d, 'top-left');

map.on('load', function () {
    //add a point with a name on the map at 0,0 when it loads
    map.addSource('current_position', {
        "type": "geojson",
        "data": {
            "type": "Point",
            "coordinates": [0, 0]
        }
    });
    map.addLayer({
        "id": "current_position",
        "source": "current_position",
        "type": "circle",
        "paint": {
            "circle-radius": 10,
            "circle-color": "#007cbf"
        }
    });
    electron.ipcRenderer.on('gps-update', (event, message) => {
        //update the marker on the map where we currently are
        // console.log(message);
        if (message.lat == null || message.lon == null) {

        } else {
            map.getSource('current_position').setData({
                "type": "Point",
                "coordinates": [message.lon, message.lat]
            });

            if (message.speed > 1) {
                map.setPitch(60);
                map.setZoom(18);
                map.setCenter([message.lon, message.lat]);

                function animation() {
                    map.rotateTo(message.bearing, {
                        duration: .5
                    });
                    requestAnimationFrame(animation);
                }
                animation();
            }
        }

    });

    //Handle changes to the dropdowns
    let start_point = document.getElementById("start_point");
    start_point.addEventListener("change", function () {
        d.setOrigin(start_point.value.split(','))
    });
    let end_point = document.getElementById("end_point");
    end_point.addEventListener("change", function () {
        d.setDestination(end_point.value.split(','))
        direction_request += 1; //this lets us know what steps are from a new set
    });

    //when they're going the wrong way, update the origin and let the directions api fire off new directions
    electron.ipcRenderer.on('wrong_way', (event, message) => {
        console.log(`going the wrong way, got a message of ${message}`);
        d.setOrigin(message.lon, message.lat);
    });

})