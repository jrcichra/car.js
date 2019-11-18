var version = 'v5';
var osrmTextInstructions = require('osrm-text-instructions')(version);
var map = new mapboxgl.Map({
    container: 'map',
    style: 'styles/osm-bright/style.json'
});
var d = new MapboxDirections({
    accessToken: mapboxgl.accessToken,
    api: 'http://127.0.0.1:5000/route/v1/',
    profile: 'driving',
    language: '',
    alternatives: false,
    steps: true,
    compile: function (language, step, options) {
        instruction = osrmTextInstructions.compile(language, step, options);
        console.log(instruction);
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
    require('electron').ipcRenderer.on('gps-update', (event, message) => {
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
})
