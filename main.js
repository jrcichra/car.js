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

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

// Keep a global for the directions we want to keep around - this gets overwritten if we get a new direction request
let directions = [];
let directions_request = 0; //first one should be one
let direction_index = 0; //where we are in the current direction process

// Current state of where we are and where we're going next
let current_pos;

// Wrong way count, incremented when the distance to the next manuever is getting further and further away
//NOTE: this might be flawed - might be better to heavily hit the directions api instead, but we'll see
let wrong_way = 0;
let last_distance = -1;

let gpsLoopId; //for clearInterval inside itself
let gpsDirectionPoll = 1000; //setInterval ms to do a gpsLoop()  


function gpsLoop() {
  // call this on an interval, and it will calculate the distance between where the GPS is 
  // and where the next direction manuever is
  // this can trigger espeak based on how far away we want certain things said
  // it can also increment what manuever we are going to next

  try { //catch any errors with missing data, and just brush it off for now
    let maneuver = directions[direction_index].maneuver;

    let lon = maneuver.location[0];
    let lat = maneuver.location[1];

    //get the distance (in meters)
    let distance = GPS.Distance(current_pos.lat, current_pos.lon, lat, lon);
    //convert that distance from meters to miles
    distance = convert(distance).from('m').to('mi');
    //see if that passes our threshold of when we should speak it
    if (distance <= .02) {
      //do the manuever
      speak(directions[direction_index].name);
      //if they got close enough, we can assume they did the manuever
      if (direction_index >= directions.length - 1) {
        //This was the last direction. They should be at their destination
        speak("You have arrived at your destination.");
        //end the gps loop (with clearinterval) and also clear the variable so new directions can start a new looper
        let temp = gpsLoopId;
        gpsLoopId = undefined;
        clearInterval(temp);
      } else {
        //This was not their last direction. Increment the direction_index to start checking for the next manuever
        direction_index += 1;
      }
    } else if (distance <= .25) {
      //within a quarter mile
      speak(`In a quarter mile, ${directions[direction_index].name}`);
    } else if (distance <= .5) {
      //half a mile
      speak(`In half a mile, ${directions[direction_index].name}`);
    } else if (distance <= 1) {
      //one mile
      speak(`In one mile, ${directions[direction_index].name}`);
    } else {
      //didn't pass our threshold, don't do anything, no need to speak
    }

    //see if we're going away from our next manuever (this is used for recalculating)
    if (last_distance == -1) {
      //we don't have a last_distance, don't worry about it
    } else if (distance > last_distance) {
      //we are farther away from our last point. Incremement the wrong way counter
      wrong_way += 1;
    } else {
      //We must be getting closer. No issue here
    }

    //after using distance and last_distance, let's update last_distance to the current distance
    last_distance = distance;

    //if we've been going the wrong way for a while, we can reset the origin to our current gps position
    //and get a new set of directions
    if (wrong_way >= 3) {
      //reset our wrong_way counter
      wrong_way = 0;
      //tell the front-end to generate new directions using our current location
      mainWindow.webContents.send('wrong-way', {
        lat:lat,
        lon:lon
      });

      /*
      NOTE: doing means the directions array will get cleared, and the current index is reset
      This shouldn't cause any issues for this loop (but this is a weird way of thinking)
      I admit I'm not the best javascript programmer :-)
      I'd have an easier time thinking with theads and queues
        instead of shared variables and an event loop
      */

      //speak that we're recalculating
      speak("Recalculating.");


    }

  } catch (error) {
    console.log(error);
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

  const port = new SerialPort(file, {
    baudRate: 9600
  });

  port.pipe(parser);


  var gps = new GPS;

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
      // console.log(gps.state);
      // console.log(gps.state.lat);
    } else {
      console.log("We got bad data from the GPS (checksum)");
    }
  });

  parser.on('data', function (data) {
    gps.update(data);
  });
}

async function speak(message) {

  //use that message as an argument to espeak with quotes around it
  let espeak = spawn('espeak', ["'" + message + "'"]);

  //capture output for espeak (if there are any errors) to the console
  espeak.stdout.on('data', data => {
    console.log(`stdout: ${data}`);
  });
  espeak.stderr.on('data', data => {
    console.log(`stderr:${data}`);
  });
  //handle anything that should be done after espeak is done speaking
  espeak.on('close', code => {
    // console.log(`espeak ended with code ${code}`);
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

    // let the backend get direction information to act on with system stuff
    ipc.on('osrm', function (event, dir) {
      // see if we got a new set of directions or not
      if (dir.request == directions_request) {
        //It's a continuation (or the first one). Append this onto our object
        directions.push(dir);
      } else {
        //This is a new set of directions, update the number, clean the directions, and append this new one
        directions_request = dir.request;
        directions = [];
        directions.push(dir);
        //Since this is the first one in a new set, let's say what the first direction is and prep ourselves
        //to say more when we get close enough to the next point, and the next, etc.

        //This only gets us started, so when we plug in directions, it speaks it
        speak(dir.instruction);

        //While that's speaking, we want to be calculating our position and the distance to the next maneuver
        // if we get too far away, we should recalculate a route (which, who knows, might have a u-turn)

        //for this, just set the index back down to 0, and make sure the GPS Loop is running
        direction_index = 0;
        if (gpsLoopId == undefined) {
          //we need to start up a gps loop
          gpsLoopId = setInterval(gpsLoop, gpsDirectionPoll);
        }
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