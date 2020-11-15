const version = 'v5';
var osrmTextInstructions = require('osrm-text-instructions')(version);
var map = new mapboxgl.Map({
    container: 'map',
    style: 'styles/osm-bright/style.json'
});
var electron = require('electron');
var ipc = electron.ipcRenderer;

var direction_request = 0;

electron.ipcRenderer.on('locations', (event, locations) => {
    //clear it out
    let end_point = document.getElementById("end_point");
    end_point.innerText = null;
    //recreate
    let blank = document.createElement("option");
    blank.text = "";
    blank.value = "";
    end_point.add(blank);
    for (let l of locations) {
        let option = document.createElement("option");
        option.text = l.name;
        option.value = `${l.lat},${l.lon}`;
        end_point.add(option);
    }
});

var d = new MapboxDirections({
    accessToken: mapboxgl.accessToken,
    api: 'http://127.0.0.1:5000/route/v1/',
    profile: 'driving',
    language: '',
    alternatives: false,
    steps: true,
    controls: {
        inputs: false,
        instructions: true,
        profileSwitcher: false
    },
    flyTo: false,
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
// console.log(d);
map.addControl(d, 'top-left');

map.on('load', function () {
    //Get image of car
    map.loadImage(
        'http://localhost/car.png',
        function (error, image) {
            if (error) throw error;
            map.addImage('car', image);
        });
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
        "type": "symbol",
        'layout': {
            'icon-image': 'car',
            'icon-size': 0.05,
            'icon-allow-overlap': true
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
                map.setZoom(15);
                map.setCenter([message.lon, message.lat]);

                async function animation() {
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
    let end_point = document.getElementById("end_point");
    end_point.addEventListener("change", function () {
        //Ask and set a new origin point
        ipc.send("get-origin");
        d.setDestination(end_point.value.split(','))
        direction_request += 1; //this lets us know what steps are from a new set
    });

    //when they're going the wrong way, update the origin and let the directions api fire off new directions
    electron.ipcRenderer.on('wrong-way', (event, message) => {
        // console.log(`going the wrong way, got a message of...`);
        // console.log(message);
        direction_request += 1; //this lets us know what steps are from a new set
        d.setOrigin([message.lon, message.lat]);
    });
    //Backend tells us to update the starting position (which should usually be the current position after a directions request)
    electron.ipcRenderer.on('set-origin', (event, message) => {
        d.setOrigin([message.lon, message.lat])
    });
})