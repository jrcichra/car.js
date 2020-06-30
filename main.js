// Modules to control application life and create native browser window
const {
  app,
  BrowserWindow,
  ipcMain
} = require('electron')
const path = require('path')
const fs = require('fs');
var ipc = ipcMain;
const util = require('util');
const {
  spawn
} = require('child_process');
var GPS = require('gps');
var convert = require('convert-units');
var polyline = require('@mapbox/polyline');

//do we want a fake gps or not
let fakegps = true;

//are we navigating right now?
let navigating = true;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

// Keep a global for the directions we want to keep around - this gets overwritten if we get a new direction request
let directions = [];
let directions_request = 0; //first one should be one
let direction_index = 1; //where we are in the current direction process
let poly_index = 0; //index of the polyline we're on per direction
// Current state of where we are and where we're going next
let current_pos;

// Wrong way count, incremented when the distance to the next manuever is getting further and further away
//NOTE: this might be flawed - might be better to heavily hit the directions api instead, but we'll see
let wrong_way = 0;
let last_poly_distance = -1;

let spoke = {
  quarter: false,
  half: false,
  one: false,
  zero: false,
  first: false
}; //so we don't get spammed with espeak on every gps loop


//this will be set for the gpsLoop if we need to consider the last point for something (ex. speaking)'
//the current use case is to stop the next direction immediately coming out once they make a manuever
//they should pull away a certain distance from the manuever before we tell them their next manuever

let look_at_last = false;

function fakeGPS() {
  //read the data from a file and make applicable portions of the file available
  let fake_gps_data = JSON.parse(fs.readFileSync('data.json'), 'utf8');
  let start_with = 200;
  let end_with = fake_gps_data.length - 1;
  let first_time = new Date(fake_gps_data[start_with].time);
  for (let i = start_with; i < end_with; i++) {
    let start_time = new Date(fake_gps_data[i].time);
    //we actually make all the functions for the whole trip in one go - setting timeouts
    setTimeout(() => {
      let o = {
        lat: fake_gps_data[i].lat,
        lon: fake_gps_data[i].lon,
        time: fake_gps_data[i].time,
        //convert speed to mph from kph
        speed: fake_gps_data[i].speed / 1.609,
        bearing: fake_gps_data[i].track
      }
      mainWindow.webContents.send('gps-update', o);
      current_pos = o;
      if (navigating) {
        gpsLoop();
      }
      //speed divider if needed
    }, (start_time.getTime() - first_time.getTime()) / 5);
  }

}


function gpsLoop() {
  // call this after you send a gps update, and it will calculate the distance between where the GPS is 
  // and where the next direction manuever is
  // this can trigger espeak based on how far away we want certain things said
  // it can also increment what manuever we are going to next

  try { //catch any errors with missing data, and just brush it off for now
    let maneuver = directions[direction_index].step.maneuver;
    let lon = maneuver.location[0];
    let lat = maneuver.location[1];
    console.log(`polydump length:${directions[direction_index - 1].polycoord.length}`);
    console.log(`polydump index: ${poly_index}`);
    let polycoord = directions[direction_index - 1].polycoord[poly_index];

    let poly_lon = polycoord[0];
    let poly_lat = polycoord[1];

    //get the distance (in meters)
    // console.log(`Going from ${current_pos.lat},${current_pos.lon} to ${lat},${lon}`)
    let distance = GPS.Distance(current_pos.lat, current_pos.lon, lat, lon);
    //convert that distance from meters to miles
    distance = convert(distance).from('km').to('mi');
    console.log(`next manuever: ${directions[direction_index].instruction}`);
    console.log(`distance to next manuever: ${distance} mi`);


    let prev_distance;
    if (look_at_last) {
      //calculate the distance to the previous manuever
      let last_maneuver = directions[direction_index - 1].step.maneuver;
      let last_lon = last_maneuver.location[0];
      let last_lat = last_maneuver.location[1];
      prev_distance = GPS.Distance(current_pos.lat, current_pos.lon, last_lat, last_lon);
      prev_distance = convert(prev_distance).from('km').to('mi');
    }

    //calculate the next poly distance
    let poly_distance = GPS.Distance(current_pos.lat, current_pos.lon, poly_lon, poly_lat);
    poly_distance = convert(poly_distance).from('km').to('mi');
    console.log(`distance to next poly: ${poly_distance} mi`);

    if (direction_index >= directions.length - 1) {
      //This was the last direction. They should be at their destination
      speak("You have arrived at your destination.");
      //end the navigation
      navigating = false;
    } else if (distance <= .05) {
      //do the manuever
      if (!spoke.zero) {
        //say the instruction if they should do the manuever
        speak(directions[direction_index].instruction);
        //reset all spokes
        spoke = {
          quarter: false,
          half: false,
          one: false,
          zero: false,
          first: false
        };
        //move to the next manuever - but we need to wait until they're far enough away from the last manuever to
        //give details on the next manuever
        look_at_last = true;
        direction_index += 1;
        poly_index = 0;
      }
    } else if ((distance <= .25 && !look_at_last) || (distance <= .25 && look_at_last && prev_distance >= .05)) {
      //within a quarter mile
      look_at_last = false;
      if (!spoke.quarter) {
        speak(`In a quarter mile, ${directions[direction_index].instruction}`);
        spoke.quarter = true;
      }
    } else if ((distance <= .5 && !look_at_last) || (distance <= .5 && look_at_last && prev_distance >= .05)) {
      //half a mile
      look_at_last = false;
      if (!spoke.half) {
        speak(`In half a mile, ${directions[direction_index].instruction}`);
        spoke.half = true;
      }
    } else if ((distance <= 1 && !look_at_last) || (distance <= 1 && look_at_last && prev_distance >= .05)) {
      //one mile
      look_at_last = false;
      if (!spoke.one) {
        speak(`In one mile, ${directions[direction_index].instruction}`);
        spoke.one = true;
      }
    } else if ((distance > 1 && look_at_last && prev_distance >= .05)) {
      //if they're coming out of a manuever and they're not in range of any of the above statements
      look_at_last = false;
      if (!spoke.first) {
        speak(`In ${Math.round(distance * 10) / 10} miles, ${directions[direction_index].instruction}`);
        spoke.first = true;
      }
    } else {
      //didn't pass our threshold, don't do anything, no need to speak
    }

    //see if we're going away from our next poly (this is used for recalculating)
    if (last_poly_distance == -1) {
      //we don't have a last_distance, don't worry about it
    } else if (poly_distance < .05) {
      //we must have hit the poly - increment the poly counter
      if (poly_index + 1 < directions[direction_index - 1].polycoord.length) {
        poly_index += 1;
      }
      wrong_way = 0;
    } else if (poly_distance > last_poly_distance && Math.abs(last_poly_distance - poly_distance) > .001) {
      //we are farther away from our last point and outside the margin of error. Increment the wrong way counter
      wrong_way += 1;
    } else {
      //We must be getting closer. No issue here. reset wrong_way to 0
      wrong_way = 0;
    }

    //after using distance and last_poly_distance, let's update last_poly_distance to the current poly_distance
    last_poly_distance = poly_distance;

    //if we've been going the wrong way for a while, we can reset the origin to our current gps position
    //and get a new set of directions
    if (wrong_way >= 10) {
      //reset our wrong_way counter
      wrong_way = 0;
      //tell the front-end to generate new directions using our current location
      mainWindow.webContents.send('wrong-way', {
        lat: current_pos.lat,
        lon: current_pos.lon
      });

      /*
      NOTE: doing means the directions array will get cleared, and the current index is reset
      This shouldn't cause any issues for this loop (but this is a weird way of thinking)
      I admit I'm not the best javascript programmer :-)
      I'd have an easier time thinking with theads and queues
        instead of shared variables and an event loop
      */

      look_at_last = false;


    }

  } catch (error) {
    console.log(error);
    // console.log(util.inspect(directions, false, null, true))
  }
}


function gpsSetup() {

  console.log("doing GPS setup");

  //Justin GPS code
  var file = '/dev/ttyS0';

  const SerialPort = require('serialport');
  const parsers = SerialPort.parsers;

  const parser = new parsers.Readline({
    delimiter: '\r\n'
  });

  var gps = new GPS;
  if (!fakegps) {
    const port = new SerialPort(file, {
      baudRate: 9600
    });

    port.pipe(parser);
    gps.on('RMC', function (data) {

      //make sure the checksum is good
      if (data.valid) {
        //write to file
        fs.appendFileSync('data.log', JSON.stringify(data));
        //only pass on what mapbox cares about
        let o = {
          lat: data.lat,
          lon: data.lon,
          time: data.time,
          //convert speed to mph from kph
          speed: data.speed / 1.609,
          bearing: data.track
        }

        // when we get gps data, send it to the client to handle
        mainWindow.webContents.send('gps-update', o);
        //also set this as our current position, so we can have a process calculate the distance to the next manuever
        current_pos = o;
        if (navigating) {
          gpsLoop();
        }
        // console.log(gps.state);
        // console.log(gps.state.lat);
      } else {
        console.log("We got bad data from the GPS (checksum)");
      }
    });

    parser.on('data', function (data) {
      gps.update(data);
    });
  } else {
    fakeGPS();
  }
}

async function speak(message) {
  console.log(`###### espeak should be saying: '${message}' ######`);
  //kill any old espeaks that may still be speaking!
  let kill = spawn("killall", ["espeak"]);
  kill.on('close', code => {
    //use that message as an argument to espeak with quotes around it
    let espeak = spawn('espeak', ["'" + message + "'"]);

    //capture output for espeak (if there are any errors) to the console
    espeak.stdout.on('data', data => {
      // console.log(`stdout: ${data}`);
    });
    espeak.stderr.on('data', data => {
      // console.log(`stderr:${data}`);
    });
    //handle anything that should be done after espeak is done speaking
    espeak.on('close', code => {
      // console.log(`espeak ended with code ${code}`);
    });
  });


}

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      //I know this is bad, but I can't get it to work without this for the clientside, browserify
      //does not play nice with including electron
      //https://github.com/electron/electron/issues/7300
      nodeIntegration: true
    }
  });

  // and load the index.html of the app.
  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    console.log("did-finish-load done");

    //maximize - https://github.com/electron/electron/issues/7779
    mainWindow.maximize();

    gpsSetup();

    ipc.on('get-origin', function (event, dir) {
      //Update our origin
      mainWindow.webContents.send('set-origin', current_pos);
    });

    // let the backend get direction information to act on with system stuff
    ipc.on('osrm', function (event, dir) {
      // see if we got a new set of directions or not
      if (dir.request == directions_request) {
        //It's a continuation (or the first one). Append this onto our object
        //But first, lets decode the polyline here so we don't have to do it every time in the loop
        dir.polycoord = polyline.decode(dir.step.geometry);
        directions.push(dir);
      } else {
        navigating = true;
        //This is a new set of directions, update the number, clean the directions, and append this new one
        directions_request = dir.request;
        directions = [];
        dir.polycoord = polyline.decode(dir.step.geometry);
        directions.push(dir);
        //Since this is the first one in a new set, let's say what the first direction is and prep ourselves
        //to say more when we get close enough to the next point, and the next, etc.

        //This only gets us started, so when we plug in directions, it speaks it
        let sentence = "";
        if (directions_request > 1) {
          sentence += "Recalculating. ";
        }
        sentence += dir.instruction;
        speak(sentence);

        //While that's speaking, we want to be calculating our position and the distance to the next maneuver
        // if we get too far away, we should recalculate a route (which, who knows, might have a u-turn)

        //for this, just set the index back down to 1, and make sure the GPS Loop is running
        direction_index = 1;
        //reset the poly index
        poly_index = 0;

      }
      // console.log(util.inspect(arg, false, null, true /* enable colors */ ));
    });

  });

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindow();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.